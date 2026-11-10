// Human-approved actions. Only these routes move money-related state in PayPal;
// the AI agent can only draft and propose.
import { cancelInvoice, recordPayment, remindInvoice, sendInvoice } from "@/lib/paypal";

export async function POST(req: Request, ctx: RouteContext<"/api/invoices/[id]/[action]">) {
  const { id, action } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    switch (action) {
      case "send":
        return Response.json({ ok: true, invoice: await sendInvoice(id) });
      case "remind":
        await remindInvoice(id, String(body.subject ?? "Payment reminder"), String(body.note ?? ""));
        return Response.json({ ok: true });
      case "cancel":
        await cancelInvoice(id, String(body.note ?? "Cancelled"));
        return Response.json({ ok: true });
      case "record-payment":
        return Response.json({ ok: true, invoice: await recordPayment(id) });
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 404 });
    }
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
