// Public data for one invoice's client page. Returns only what the client already
// sees on PayPal's own invoice page, plus the state of any request or plan.
import { businessName } from "@/lib/clientAgent";
import { POLICY } from "@/lib/negotiation";
import { getInvoice, type Invoice } from "@/lib/paypal";
import { getPlan, listRequests } from "@/lib/store";

const ID = /^INV2(-[A-Z0-9]{4}){4}$/;

const publicView = (inv: Invoice) => ({
  number: inv.number,
  status: inv.status,
  clientName: inv.clientName,
  items: inv.items,
  currency: inv.currency,
  total: inv.total,
  due: inv.due,
  dueDate: inv.dueDate,
  daysOverdue: inv.daysOverdue,
  payerUrl: inv.payerUrl,
});

export async function GET(_req: Request, ctx: RouteContext<"/api/portal/[id]">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Invoice not found." }, { status: 404 });
  try {
    const inv = await getInvoice(id);
    if (inv.status === "DRAFT") return Response.json({ error: "Invoice not found." }, { status: 404 });
    const plan = getPlan(id);
    const instalments = plan
      ? await Promise.all(plan.instalments.map(async (i) => publicView(await getInvoice(i.invoiceId))))
      : null;
    const latest = listRequests()
      .filter((r) => r.invoiceId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return Response.json({
      business: businessName(),
      invoice: publicView(inv),
      instalments,
      request: latest ? { kind: latest.kind, status: latest.status, summary: latest.summary } : null,
      policy: POLICY,
    });
  } catch {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
}
