// Rules for what a client may ask for, and how an approved request is applied in PayPal.
// The limits are enforced here in code. The client-facing AI only fills in a request form;
// it cannot grant anything, and it cannot exceed these limits however it is asked.
import {
  cancelInvoice,
  createDraftInvoice,
  deleteDraft,
  getInvoice,
  isOpen,
  nextInvoiceNumber,
  sendInvoice,
  today,
  updateDueDate,
  type Invoice,
} from "./paypal";
import {
  addRequest,
  getPlan,
  getRequest,
  savePlan,
  updateRequest,
  type ClientRequest,
  type Instalment,
} from "./store";

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export const POLICY = {
  /** Most instalments a plan may have. */
  maxInstalments: num(process.env.PLAN_MAX_INSTALMENTS, 3),
  /** First instalment must be at least this share of the amount owed. */
  minFirstPct: num(process.env.PLAN_MIN_FIRST_PCT, 30),
  /** First instalment is due this many days from today. */
  firstDueDays: 3,
  /** Final instalment must fall within this many days from today. */
  maxPlanDays: num(process.env.PLAN_MAX_DAYS, 45),
  /** A simple extension may move the due date at most this many days from today. */
  maxExtensionDays: num(process.env.EXTENSION_MAX_DAYS, 14),
  /** Plans are only offered for at least this much owed. */
  minPlanAmount: num(process.env.PLAN_MIN_AMOUNT, 50),
};

export function addDays(iso: string, days: number) {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const money = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Build an instalment schedule, or explain which limit the request breaks. */
export function buildSchedule(
  due: number,
  currency: string,
  count: number,
  firstAmount: number | undefined,
  finalDate: string,
): Result<{ instalments: Instalment[] }> {
  if (due < POLICY.minPlanAmount) {
    return { ok: false, error: `Payment plans are only available for ${money(POLICY.minPlanAmount, currency)} or more.` };
  }
  if (!Number.isInteger(count) || count < 2 || count > POLICY.maxInstalments) {
    return { ok: false, error: `A plan can have 2 to ${POLICY.maxInstalments} instalments.` };
  }
  const cents = Math.round(due * 100);
  const minFirst = Math.ceil((cents * POLICY.minFirstPct) / 100);
  const first = firstAmount === undefined ? Math.max(minFirst, Math.round(cents / count)) : Math.round(firstAmount * 100);
  if (first < minFirst) {
    return {
      ok: false,
      error: `The first payment must be at least ${POLICY.minFirstPct}% of the amount owed (${money(minFirst / 100, currency)}).`,
    };
  }
  if (first >= cents) return { ok: false, error: "The first payment must be less than the full amount owed." };

  const firstDate = addDays(today(), POLICY.firstDueDays);
  const latest = addDays(today(), POLICY.maxPlanDays);
  if (!isDate(finalDate)) return { ok: false, error: "The final payment date must be a date in YYYY-MM-DD form." };
  if (finalDate <= firstDate) return { ok: false, error: `The final payment date must be after ${firstDate}.` };
  if (finalDate > latest) {
    return { ok: false, error: `The final payment must be made by ${latest} (${POLICY.maxPlanDays} days from today).` };
  }

  const rest = cents - first;
  const each = Math.floor(rest / (count - 1));
  const span = Math.round((Date.parse(finalDate) - Date.parse(firstDate)) / 86_400_000);
  const instalments: Instalment[] = [];
  for (let k = 0; k < count; k++) {
    const amount = k === 0 ? first : k === count - 1 ? rest - each * (count - 2) : each;
    instalments.push({ amount: amount / 100, dueDate: addDays(firstDate, Math.round((span * k) / (count - 1))) });
  }
  return { ok: true, instalments };
}

function eligibility(inv: Invoice): string | null {
  if (getPlan(inv.id)) return "This invoice already has an agreed payment plan.";
  if (!isOpen(inv.status)) return `This invoice is ${inv.status.toLowerCase().replace(/_/g, " ")}, so there is nothing to change.`;
  return null;
}

function file(inv: Invoice, fields: Pick<ClientRequest, "kind" | "reason" | "summary" | "instalments" | "newDueDate">) {
  const req: ClientRequest = {
    id: crypto.randomUUID(),
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    clientName: inv.clientName,
    currency: inv.currency,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...fields,
    reason: fields.reason.slice(0, 500),
  };
  addRequest(req);
  return req;
}

export function requestPlan(
  inv: Invoice,
  count: number,
  firstAmount: number | undefined,
  finalDate: string,
  reason: string,
): Result<{ request: ClientRequest }> {
  const blocked = eligibility(inv);
  if (blocked) return { ok: false, error: blocked };
  if (inv.reference.startsWith("Plan ")) {
    return { ok: false, error: "This invoice is already an instalment of a payment plan, so it cannot be split again." };
  }
  const s = buildSchedule(inv.due, inv.currency, count, firstAmount, finalDate);
  if (!s.ok) return s;
  const summary = `Pay ${money(inv.due, inv.currency)} in ${count} instalments: ${s.instalments
    .map((i) => `${money(i.amount, inv.currency)} by ${i.dueDate}`)
    .join(", ")}`;
  return { ok: true, request: file(inv, { kind: "payment_plan", reason, summary, instalments: s.instalments }) };
}

export function requestExtension(inv: Invoice, newDueDate: string, reason: string): Result<{ request: ClientRequest }> {
  const blocked = eligibility(inv);
  if (blocked) return { ok: false, error: blocked };
  const latest = addDays(today(), POLICY.maxExtensionDays);
  if (!isDate(newDueDate)) return { ok: false, error: "The new due date must be a date in YYYY-MM-DD form." };
  if (newDueDate <= today()) return { ok: false, error: "The new due date must be in the future." };
  if (inv.dueDate && newDueDate <= inv.dueDate) return { ok: false, error: `The invoice is already due on ${inv.dueDate}.` };
  if (newDueDate > latest) {
    return { ok: false, error: `An extension can go to ${latest} at the latest (${POLICY.maxExtensionDays} days from today).` };
  }
  const summary = `Move the due date of ${money(inv.due, inv.currency)} from ${inv.dueDate || "unset"} to ${newDueDate}`;
  return { ok: true, request: file(inv, { kind: "extension", reason, summary, newDueDate }) };
}

export function reportIssue(inv: Invoice, summaryText: string): ClientRequest {
  return file(inv, { kind: "issue", reason: summaryText, summary: "The client raised a question or problem with this invoice" });
}

/** Apply the freelancer's decision. Approving is the only path that changes anything in PayPal. */
export async function decide(requestId: string, decision: "approve" | "decline") {
  const req = getRequest(requestId);
  if (!req) throw new Error("Request not found.");
  if (req.status !== "pending") throw new Error(`This request was already ${req.status}.`);
  const done = (status: "approved" | "declined") => updateRequest(req.id, { status, decidedAt: new Date().toISOString() });

  if (decision === "decline" || req.kind === "issue") {
    done(decision === "decline" ? "declined" : "approved");
    return { ok: true };
  }

  const inv = await getInvoice(req.invoiceId);
  if (!isOpen(inv.status)) throw new Error(`Invoice ${inv.number} is now ${inv.status}; the request no longer applies.`);

  if (req.kind === "extension") {
    await updateDueDate(inv.id, req.newDueDate!);
    done("approved");
    return { ok: true };
  }

  // Payment plan: replace the invoice with one invoice per instalment.
  const parts = req.instalments!;
  const total = Math.round(parts.reduce((a, p) => a + p.amount, 0) * 100);
  if (total !== Math.round(inv.due * 100)) {
    throw new Error(`The amount owed on ${inv.number} changed since this plan was requested. Ask the client to request it again.`);
  }
  const base = Number(await nextInvoiceNumber());
  const drafts: Invoice[] = [];
  try {
    for (let k = 0; k < parts.length; k++) {
      drafts.push(
        await createDraftInvoice({
          recipientName: inv.clientName,
          recipientEmail: inv.clientEmail,
          currency: inv.currency,
          dueDate: parts[k].dueDate,
          number: String(base + k).padStart(4, "0"),
          reference: `Plan ${inv.number} ${k + 1}/${parts.length}`,
          note: `Instalment ${k + 1} of ${parts.length} of the payment plan agreed for invoice ${inv.number}. Thank you!`,
          items: [
            {
              name: `Instalment ${k + 1} of ${parts.length} · invoice ${inv.number}`,
              description: inv.items.slice(0, 900),
              quantity: 1,
              unitPrice: parts[k].amount,
              unit: "AMOUNT",
            },
          ],
        }),
      );
    }
  } catch (err) {
    // Nothing has reached the client yet: remove the drafts and leave the original untouched.
    await Promise.allSettled(drafts.map((d) => deleteDraft(d.id)));
    throw err;
  }
  for (const d of drafts) await sendInvoice(d.id);
  await cancelInvoice(
    inv.id,
    `Replaced by an agreed payment plan of ${parts.length} instalments (invoices ${drafts.map((d) => d.number).join(", ")}).`,
  );
  savePlan({
    originalInvoiceId: inv.id,
    originalNumber: inv.number,
    createdAt: new Date().toISOString(),
    instalments: drafts.map((d, k) => ({ ...parts[k], invoiceId: d.id, number: d.number })),
  });
  done("approved");
  return { ok: true };
}
