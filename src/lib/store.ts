// Tiny JSON-file store for client requests and agreed payment plans.
// Invoices themselves always come from PayPal; this only holds negotiation state.
import fs from "node:fs";
import path from "node:path";

export type Instalment = { amount: number; dueDate: string };

export type ClientRequest = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  currency: string;
  kind: "payment_plan" | "extension" | "issue";
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt?: string;
  /** The client's own words. Untrusted text: display only. */
  reason: string;
  /** One-line description built by the server, not by the model. */
  summary: string;
  instalments?: Instalment[];
  newDueDate?: string;
};

export type Plan = {
  originalInvoiceId: string;
  originalNumber: string;
  createdAt: string;
  instalments: (Instalment & { invoiceId: string; number: string })[];
};

type Db = { requests: ClientRequest[]; plans: Record<string, Plan> };

const FILE = path.join(process.cwd(), ".data", "paypilot.json");
// Used when the filesystem is read-only; state then lasts until the process restarts.
let memory: Db = { requests: [], plans: {} };

function load(): Db {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, "utf8")) as Db;
    return { requests: db.requests ?? [], plans: db.plans ?? {} };
  } catch {
    return memory;
  }
}

function save(db: Db) {
  memory = db;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch {
    // keep the in-memory copy
  }
}

export function listRequests(): ClientRequest[] {
  return load().requests;
}

export function getRequest(id: string) {
  return load().requests.find((r) => r.id === id);
}

/** Add a request; a newer request replaces an older pending one of the same kind on the same invoice. */
export function addRequest(req: ClientRequest) {
  const db = load();
  db.requests = db.requests.filter(
    (r) => !(r.invoiceId === req.invoiceId && r.kind === req.kind && r.status === "pending"),
  );
  db.requests.push(req);
  save(db);
}

export function updateRequest(id: string, patch: Partial<ClientRequest>) {
  const db = load();
  db.requests = db.requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
  save(db);
}

export function getPlan(originalInvoiceId: string): Plan | undefined {
  return load().plans[originalInvoiceId];
}

export function savePlan(plan: Plan) {
  const db = load();
  db.plans[plan.originalInvoiceId] = plan;
  save(db);
}
