// The freelancer's decision on a client request. Approving is the only path that
// changes an invoice in PayPal on a client's behalf.
import { errorMessage } from "@/lib/http";
import { decide } from "@/lib/negotiation";

export const maxDuration = 120;

export async function POST(_req: Request, ctx: RouteContext<"/api/requests/[id]/[decision]">) {
  const { id, decision } = await ctx.params;
  if (decision !== "approve" && decision !== "decline") {
    return Response.json({ error: `Unknown decision: ${decision}` }, { status: 404 });
  }
  try {
    return Response.json(await decide(id, decision));
  } catch (err) {
    console.error(err);
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
