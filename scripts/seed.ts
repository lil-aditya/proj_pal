// Creates realistic demo invoices in your PayPal SANDBOX: overdue, paid, open and draft.
// Run: node --env-file=.env.local --experimental-strip-types scripts/seed.ts
import { createDraftInvoice, recordPayment, sendInvoice, type DraftInput } from "../src/lib/paypal.ts";

if (process.env.PAYPAL_ENV === "live") {
  console.error("Refusing to seed demo data into a LIVE PayPal account.");
  process.exit(1);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

type Seed = { input: DraftInput; then: "send" | "send+pay" | "draft" };

const seeds: Seed[] = [
  {
    then: "send",
    input: {
      recipientName: "Rahul Verma",
      recipientEmail: "rahul.verma@example.com",
      currency: "USD",
      invoiceDate: daysAgo(40),
      dueDate: daysAgo(26),
      items: [{ name: "Website redesign", quantity: 1, unitPrice: 850, unit: "AMOUNT" }],
    },
  },
  {
    then: "send",
    input: {
      recipientName: "Acme Studio",
      recipientEmail: "billing@acmestudio.example.com",
      currency: "USD",
      invoiceDate: daysAgo(21),
      dueDate: daysAgo(7),
      items: [{ name: "October social media retainer", quantity: 1, unitPrice: 400, unit: "AMOUNT" }],
    },
  },
  {
    then: "send+pay",
    input: {
      recipientName: "Meera Iyer",
      recipientEmail: "meera.iyer@example.com",
      currency: "USD",
      invoiceDate: daysAgo(30),
      dueDate: daysAgo(16),
      items: [{ name: "Brand guidelines document", quantity: 1, unitPrice: 300, unit: "AMOUNT" }],
    },
  },
  {
    then: "send+pay",
    input: {
      recipientName: "Northwind Cafe",
      recipientEmail: "owner@northwindcafe.example.com",
      currency: "USD",
      invoiceDate: daysAgo(12),
      dueDate: daysAgo(2),
      items: [
        { name: "Menu design", quantity: 6, unitPrice: 25, unit: "HOURS" },
        { name: "Print-ready files", quantity: 1, unitPrice: 50, unit: "AMOUNT" },
      ],
    },
  },
  {
    then: "send",
    input: {
      recipientName: "Kabir Mehta",
      recipientEmail: "kabir.mehta@example.com",
      currency: "USD",
      invoiceDate: daysAgo(3),
      dueDate: daysAhead(11),
      items: [{ name: "Podcast cover art", quantity: 2, unitPrice: 75, unit: "QUANTITY" }],
    },
  },
  {
    then: "draft",
    input: {
      recipientName: "Leo Chen",
      recipientEmail: "leo.chen@example.com",
      currency: "USD",
      dueDate: daysAhead(14),
      items: [{ name: "Instagram launch kit", quantity: 1, unitPrice: 220, unit: "AMOUNT" }],
    },
  },
];

for (const { input, then } of seeds) {
  try {
    let inv = await createDraftInvoice(input);
    if (then !== "draft") inv = await sendInvoice(inv.id);
    if (then === "send+pay") inv = await recordPayment(inv.id);
    console.log(`✓ ${inv.number.padEnd(5)} ${inv.status.padEnd(15)} ${inv.clientName}`);
  } catch (err) {
    console.error(`✗ ${input.recipientName}: ${(err as Error).message}`);
  }
}
