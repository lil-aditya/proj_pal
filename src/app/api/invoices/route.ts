import { computeInsights, listInvoices } from "@/lib/paypal";

export async function GET() {
  try {
    const invoices = await listInvoices();
    return Response.json({ invoices, insights: computeInsights(invoices) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
