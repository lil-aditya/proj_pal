// Thin, typed wrapper around the PayPal REST APIs used by PayPilot.
// Sandbox by default; set PAYPAL_ENV=live to hit production.

const BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : JSON.stringify(body);
    super(`PayPal API ${status}: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env.local",
    );
  }
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new PayPalError(res.status, json);
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

async function pp<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, json);
  return json as T;
}

// ---------- Types (only the fields PayPilot uses) ----------

type Money = { currency_code: string; value: string };

export type RawInvoice = {
  id: string;
  status: string;
  detail: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code: string;
    note?: string;
    payment_term?: { term_type?: string; due_date?: string };
    metadata?: {
      create_time?: string;
      last_update_time?: string;
      recipient_view_url?: string;
      invoicer_view_url?: string;
    };
  };
  primary_recipients?: {
    billing_info?: {
      name?: { given_name?: string; surname?: string; full_name?: string };
      email_address?: string;
    };
  }[];
  items?: { name: string; quantity: string; unit_amount: Money }[];
  amount?: Money | { currency_code: string; value: string; breakdown?: unknown };
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_date?: string }[] };
};

export type Invoice = {
  id: string;
  number: string;
  status: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  total: number;
  due: number;
  invoiceDate: string;
  dueDate: string;
  paidDate: string;
  daysOverdue: number;
  payerUrl: string;
  items: string;
};

const OPEN_STATUSES = new Set([
  "SENT",
  "UNPAID",
  "PARTIALLY_PAID",
  "PAYMENT_PENDING",
  "SCHEDULED",
]);

export function isOpen(status: string) {
  return OPEN_STATUSES.has(status);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO: string, toISO: string) {
  return Math.floor(
    (Date.parse(toISO) - Date.parse(fromISO)) / (24 * 60 * 60 * 1000),
  );
}

export function normalize(inv: RawInvoice): Invoice {
  const bi = inv.primary_recipients?.[0]?.billing_info;
  const name =
    bi?.name?.full_name ||
    [bi?.name?.given_name, bi?.name?.surname].filter(Boolean).join(" ") ||
    bi?.email_address ||
    "—";
  const total = Number(inv.amount?.value ?? 0);
  const paid = Number(inv.payments?.paid_amount?.value ?? 0);
  const due = inv.due_amount
    ? Number(inv.due_amount.value)
    : isOpen(inv.status)
      ? total - paid
      : 0;
  const dueDate = inv.detail.payment_term?.due_date ?? "";
  const overdue =
    isOpen(inv.status) && dueDate ? Math.max(0, daysBetween(dueDate, today())) : 0;
  return {
    id: inv.id,
    number: inv.detail.invoice_number ?? "",
    status: inv.status,
    clientName: name,
    clientEmail: bi?.email_address ?? "",
    currency: inv.detail.currency_code,
    total,
    due,
    invoiceDate: inv.detail.invoice_date ?? "",
    dueDate,
    paidDate: inv.payments?.transactions?.at(-1)?.payment_date?.slice(0, 10) ?? "",
    daysOverdue: overdue,
    payerUrl: inv.detail.metadata?.recipient_view_url ?? "",
    items: (inv.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(", "),
  };
}

// ---------- Invoicing API ----------

// The list endpoint omits line items and payment transactions, so each invoice's full
// record is fetched once and cached until PayPal reports it changed.
const detailCache = new Map<string, Invoice>();

export async function listInvoices(): Promise<Invoice[]> {
  const summaries: RawInvoice[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await pp<{ items?: RawInvoice[]; total_pages?: number }>(
      `/v2/invoicing/invoices?page=${page}&page_size=100&total_required=true`,
    );
    summaries.push(...(res.items ?? []));
    if (!res.total_pages || page >= res.total_pages) break;
  }
  return Promise.all(
    summaries.map(async (s) => {
      const key = `${s.id}|${s.status}|${s.detail.metadata?.last_update_time ?? ""}|${s.due_amount?.value ?? ""}`;
      const hit = detailCache.get(key);
      if (hit) return hit;
      try {
        const inv = await getInvoice(s.id);
        detailCache.set(key, inv);
        return inv;
      } catch {
        return normalize(s);
      }
    }),
  );
}

export async function getInvoice(id: string): Promise<Invoice> {
  return normalize(await pp<RawInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`));
}

export type DraftInput = {
  recipientName: string;
  recipientEmail: string;
  currency: string;
  /** Defaults to today. */
  invoiceDate?: string;
  dueDate?: string;
  note?: string;
  items: {
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    unit?: "HOURS" | "QUANTITY" | "AMOUNT";
  }[];
};

export async function createDraftInvoice(input: DraftInput): Promise<Invoice> {
  const { invoice_number } = await pp<{ invoice_number: string }>(
    "/v2/invoicing/generate-next-invoice-number",
    { method: "POST" },
  );
  const [given, ...rest] = input.recipientName.trim().split(/\s+/);
  const body = {
    detail: {
      invoice_number,
      invoice_date: input.invoiceDate ?? today(),
      currency_code: input.currency,
      note: input.note ?? "Thank you for your business!",
      ...(input.dueDate
        ? { payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: input.dueDate } }
        : { payment_term: { term_type: "NET_10" } }),
    },
    ...(process.env.PAYPAL_BUSINESS_NAME
      ? { invoicer: { business_name: process.env.PAYPAL_BUSINESS_NAME } }
      : {}),
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: given, ...(rest.length ? { surname: rest.join(" ") } : {}) },
          email_address: input.recipientEmail,
        },
      },
    ],
    items: input.items.map((i) => ({
      name: i.name,
      ...(i.description ? { description: i.description } : {}),
      quantity: String(i.quantity),
      unit_amount: { currency_code: input.currency, value: i.unitPrice.toFixed(2) },
      unit_of_measure: i.unit ?? "QUANTITY",
    })),
  };
  const created = await pp<RawInvoice & { href?: string }>("/v2/invoicing/invoices", {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" },
  });
  // Some API versions return only a link; fetch the full invoice in that case.
  if (!created.id && created.href) {
    return getInvoice(created.href.split("/").pop()!);
  }
  return normalize(created);
}

export async function sendInvoice(id: string) {
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    method: "POST",
    body: { send_to_invoicer: true, send_to_recipient: true },
  });
  return getInvoice(id);
}

export async function remindInvoice(id: string, subject: string, note: string) {
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    method: "POST",
    body: { subject, note, send_to_invoicer: false, send_to_recipient: true },
  });
}

export async function cancelInvoice(id: string, note: string) {
  const inv = await getInvoice(id);
  if (inv.status === "DRAFT") {
    await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: {
      subject: `Invoice ${inv.number} cancelled`,
      note,
      send_to_invoicer: true,
      send_to_recipient: true,
    },
  });
}

/** Record an off-PayPal payment (cash / bank transfer) against an invoice. */
export async function recordPayment(id: string, method = "BANK_TRANSFER") {
  const inv = await getInvoice(id);
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, {
    method: "POST",
    body: {
      method,
      payment_date: today(),
      amount: { currency_code: inv.currency, value: inv.due.toFixed(2) },
    },
  });
  return getInvoice(id);
}

// ---------- Insights (pure functions over invoices) ----------

export function computeInsights(invoices: Invoice[]) {
  const open = invoices.filter((i) => isOpen(i.status));
  const overdue = open.filter((i) => i.daysOverdue > 0);
  const paid = invoices.filter((i) => i.status === "PAID" || i.status === "MARKED_AS_PAID");
  const sum = (xs: Invoice[], f: (i: Invoice) => number) =>
    Math.round(xs.reduce((a, i) => a + f(i), 0) * 100) / 100;

  // Average days-to-pay per client, from invoice date to recorded payment date.
  const byClient = new Map<string, { name: string; days: number[]; outstanding: number; late: number }>();
  for (const inv of invoices) {
    const key = inv.clientEmail || inv.clientName;
    const c = byClient.get(key) ?? { name: inv.clientName, days: [], outstanding: 0, late: 0 };
    if (inv.paidDate && inv.invoiceDate) c.days.push(daysBetween(inv.invoiceDate, inv.paidDate));
    if (isOpen(inv.status)) c.outstanding += inv.due;
    if (inv.daysOverdue > 0) c.late += 1;
    byClient.set(key, c);
  }
  const clients = [...byClient.entries()].map(([email, c]) => ({
    client: c.name,
    email,
    avgDaysToPay: c.days.length
      ? Math.round(c.days.reduce((a, b) => a + b, 0) / c.days.length)
      : null,
    outstanding: Math.round(c.outstanding * 100) / 100,
    overdueInvoices: c.late,
  }));

  return {
    totalInvoices: invoices.length,
    outstanding: sum(open, (i) => i.due),
    overdueAmount: sum(overdue, (i) => i.due),
    overdueCount: overdue.length,
    paidTotal: sum(paid, (i) => i.total),
    drafts: invoices.filter((i) => i.status === "DRAFT").length,
    clients: clients.sort((a, b) => b.outstanding - a.outstanding),
  };
}
