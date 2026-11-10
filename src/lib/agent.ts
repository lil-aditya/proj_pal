import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { z } from "zod";
import {
  computeInsights,
  createDraftInvoice,
  getInvoice,
  isOpen,
  listInvoices,
  today,
  type Invoice,
} from "./paypal";

/** Money-moving actions the agent proposes; the user approves them in the UI. */
export type Proposal =
  | { kind: "send_invoice"; invoiceId: string; title: string; detail: string }
  | {
      kind: "send_reminder";
      invoiceId: string;
      title: string;
      detail: string;
      subject: string;
      note: string;
    }
  | { kind: "cancel_invoice"; invoiceId: string; title: string; detail: string; note: string };

export type ChatTurn = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are PayPilot, an AI back-office assistant for freelancers and small businesses who get paid through PayPal.

You can read the user's PayPal invoices and payment status, draft new invoices, and propose reminders or cancellations.

Safety rule: you never send money-related communication yourself. Tools that create a draft or propose a reminder or cancellation only queue an approval card in the user's UI. After using one, tell the user what you prepared and ask them to review and approve it. Never claim that something was sent, reminded or cancelled.

How to work:
- Turn casual descriptions ("3 hrs logo work for Rahul at $40/hr, due Friday") into structured invoice line items. Resolve relative dates against today's date, which is given in each request. Default currency is USD unless the user says otherwise.
- If a required detail is missing (the client's email, the price), ask one short question instead of guessing. Never invent an email address.
- Before proposing a reminder, look up the invoice so you know its real status, amount and how overdue it is. Adjust the tone to the situation: friendly when it is just due, firmer when it is well overdue, always professional. Write the reminder note in the user's voice. Sign it with their business name if you know it; otherwise end with a short closing like "Thanks!" and no name or placeholder.
- When asked about cash flow, use payment_insights and give concrete numbers.
- Keep replies short and skimmable, in plain text without markdown tables. Amounts always include the currency.`;

function brief(inv: Invoice) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    client: inv.clientName,
    email: inv.clientEmail,
    total: `${inv.total.toFixed(2)} ${inv.currency}`,
    amountDue: `${inv.due.toFixed(2)} ${inv.currency}`,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate || null,
    daysOverdue: inv.daysOverdue,
    items: inv.items,
  };
}

// ---------- Provider-neutral tool definitions ----------

type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  schema: S;
  run: (args: z.infer<S>) => Promise<string>;
};

const def = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as ToolDef;

function buildTools(proposals: Proposal[], state: { mutated: boolean }): ToolDef[] {
  return [
    def({
      name: "list_invoices",
      description:
        "List the user's PayPal invoices with status, client, amount due, due date and days overdue. Optionally filter.",
      schema: z.object({
        filter: z
          .enum(["all", "open", "overdue", "paid", "draft"])
          .describe("open = sent but not fully paid")
          .default("all"),
      }),
      run: async ({ filter }) => {
        const all = await listInvoices();
        const f = all.filter((i) =>
          filter === "open"
            ? isOpen(i.status)
            : filter === "overdue"
              ? i.daysOverdue > 0
              : filter === "paid"
                ? i.status === "PAID" || i.status === "MARKED_AS_PAID"
                : filter === "draft"
                  ? i.status === "DRAFT"
                  : true,
        );
        return JSON.stringify({ count: f.length, invoices: f.slice(0, 50).map(brief) });
      },
    }),

    def({
      name: "get_invoice",
      description: "Get full details of one invoice by its PayPal invoice id (e.g. INV2-XXXX-...).",
      schema: z.object({ invoice_id: z.string() }),
      run: async ({ invoice_id }) => JSON.stringify(brief(await getInvoice(invoice_id))),
    }),

    def({
      name: "create_invoice_draft",
      description:
        "Create a DRAFT invoice in PayPal and queue a 'Send invoice' approval card for the user. Nothing is emailed until the user approves.",
      schema: z.object({
        recipient_name: z.string().describe("Client's full name or company"),
        recipient_email: z.email().describe("Client's email address, exactly as the user gave it"),
        currency: z.string().length(3).describe("ISO currency code, e.g. USD").default("USD"),
        due_date: z.string().describe("Due date as YYYY-MM-DD").optional(),
        note: z.string().describe("Short thank-you or payment note shown on the invoice").optional(),
        items: z
          .array(
            z.object({
              name: z.string(),
              description: z.string().optional(),
              quantity: z.number().positive(),
              unit_price: z.number().nonnegative(),
              unit: z.enum(["HOURS", "QUANTITY", "AMOUNT"]).default("QUANTITY"),
            }),
          )
          .min(1),
      }),
      run: async (a) => {
        const inv = await createDraftInvoice({
          recipientName: a.recipient_name,
          recipientEmail: a.recipient_email,
          currency: a.currency.toUpperCase(),
          dueDate: a.due_date,
          note: a.note,
          items: a.items.map((i) => ({
            name: i.name,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unit_price,
            unit: i.unit,
          })),
        });
        state.mutated = true;
        proposals.push({
          kind: "send_invoice",
          invoiceId: inv.id,
          title: `Send invoice ${inv.number} to ${inv.clientName}`,
          detail: `${inv.items} — ${inv.total.toFixed(2)} ${inv.currency}${inv.dueDate ? `, due ${inv.dueDate}` : ""} → ${inv.clientEmail}`,
        });
        return JSON.stringify({
          ok: true,
          status: "DRAFT created; awaiting user approval to send",
          invoice: brief(inv),
        });
      },
    }),

    def({
      name: "propose_reminder",
      description:
        "Queue a payment-reminder approval card for an open invoice. Write the subject and note yourself, matching tone to how overdue it is.",
      schema: z.object({
        invoice_id: z.string(),
        subject: z.string().max(120),
        note: z.string().max(1500),
      }),
      run: async ({ invoice_id, subject, note }) => {
        const inv = await getInvoice(invoice_id);
        if (!isOpen(inv.status)) {
          return JSON.stringify({ ok: false, error: `Invoice is ${inv.status}; reminders only apply to open invoices.` });
        }
        proposals.push({
          kind: "send_reminder",
          invoiceId: inv.id,
          title: `Remind ${inv.clientName} about ${inv.number}`,
          detail: `${inv.due.toFixed(2)} ${inv.currency} due${inv.daysOverdue ? ` · ${inv.daysOverdue} days overdue` : ""}`,
          subject,
          note,
        });
        return JSON.stringify({ ok: true, status: "Reminder queued for user approval" });
      },
    }),

    def({
      name: "propose_cancel",
      description: "Queue an approval card to cancel a sent invoice or delete a draft.",
      schema: z.object({ invoice_id: z.string(), reason: z.string() }),
      run: async ({ invoice_id, reason }) => {
        const inv = await getInvoice(invoice_id);
        proposals.push({
          kind: "cancel_invoice",
          invoiceId: inv.id,
          title: `${inv.status === "DRAFT" ? "Delete draft" : "Cancel"} ${inv.number} (${inv.clientName})`,
          detail: reason,
          note: reason,
        });
        return JSON.stringify({ ok: true, status: "Cancellation queued for user approval" });
      },
    }),

    def({
      name: "payment_insights",
      description:
        "Cash-flow summary: outstanding and overdue totals, paid total, and per-client average days-to-pay and outstanding balance.",
      schema: z.object({}),
      run: async () => JSON.stringify(computeInsights(await listInvoices())),
    }),
  ];
}

/** Validate model-supplied args, run the tool, and turn failures into a result the model can read. */
async function execTool(tool: ToolDef | undefined, args: unknown): Promise<string> {
  if (!tool) return JSON.stringify({ ok: false, error: "Unknown tool" });
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    return JSON.stringify({ ok: false, error: `Invalid arguments: ${z.prettifyError(parsed.error)}` });
  }
  try {
    return await tool.run(parsed.data);
  } catch (err) {
    return JSON.stringify({ ok: false, error: (err as Error).message });
  }
}

// ---------- Providers ----------

/** JSON Schema for Gemini: drop keywords its schema subset may reject. */
function toGeminiSchema(schema: z.ZodObject): unknown {
  const clean = (node: unknown, inProperties = false): unknown => {
    if (Array.isArray(node)) return node.map((n) => clean(n));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (!inProperties && (k === "$schema" || k === "format" || k === "pattern")) continue;
      out[k] = clean(v, !inProperties && k === "properties");
    }
    return out;
  };
  return clean(z.toJSONSchema(schema, { io: "input" }));
}

async function runGemini(tools: ToolDef[], history: ChatTurn[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const contents: Content[] = history.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));
  const config = {
    systemInstruction: SYSTEM,
    tools: [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: toGeminiSchema(t.schema),
        })),
      },
    ],
  };

  for (let step = 0; step < 8; step++) {
    const res = await ai.models.generateContent({ model, contents, config });
    const calls = res.functionCalls;
    if (!calls?.length) return res.text ?? "";
    // Keep the model's turn unchanged (it may carry thought signatures).
    contents.push(res.candidates?.[0]?.content ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });
    const parts: Part[] = await Promise.all(
      calls.map(async (c) => ({
        functionResponse: {
          id: c.id,
          name: c.name,
          response: { result: await execTool(tools.find((t) => t.name === c.name), c.args) },
        },
      })),
    );
    contents.push({ role: "user", parts });
  }
  return "I ran out of steps on that one. Could you try a simpler request?";
}

async function runClaude(tools: ToolDef[], history: ChatTurn[]): Promise<string> {
  const client = new Anthropic();
  const final = await client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    tools: tools.map((t) =>
      betaZodTool({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
        run: (args) => execTool(t, args),
      }),
    ),
    messages: history.map((t) => ({ role: t.role, content: t.content })),
  });
  if (final.stop_reason === "refusal") return "Sorry, I can't help with that request.";
  return final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function runAgent(input: ChatTurn[]) {
  const proposals: Proposal[] = [];
  const state = { mutated: false };
  const tools = buildTools(proposals, state);

  const business = process.env.PAYPAL_BUSINESS_NAME;
  const history = input.slice(-20).map((t) => ({ ...t }));
  // Volatile context goes in the latest user turn, so the system prompt stays cacheable.
  const last = history[history.length - 1];
  last.content = `[Today is ${today()}${business ? `; my business name is ${business}` : ""}]\n\n${last.content}`;

  let reply: string;
  if (process.env.GEMINI_API_KEY) reply = await runGemini(tools, history);
  else if (process.env.ANTHROPIC_API_KEY) reply = await runClaude(tools, history);
  else throw new Error("No AI key configured. Add GEMINI_API_KEY (free) to .env.local.");

  reply = reply.trim() || (proposals.length ? "I've prepared the items below for your approval." : "Done.");
  return { reply, proposals, refresh: state.mutated };
}
