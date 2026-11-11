import { runClientAgent } from "@/lib/clientAgent";
import { errorMessage, rateLimited, readTurns } from "@/lib/http";

export const maxDuration = 120;

const ID = /^INV2(-[A-Z0-9]{4}){4}$/;

export async function POST(req: Request, ctx: RouteContext<"/api/portal/[id]/chat">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Invoice not found." }, { status: 404 });
  if (rateLimited(req, "portal")) {
    return Response.json({ error: "Too many messages. Please wait a few minutes and try again." }, { status: 429 });
  }
  const history = await readTurns(req);
  if (!history) return Response.json({ error: "Expected { messages: [...] } ending with a user turn" }, { status: 400 });
  try {
    return Response.json(await runClientAgent(id, history));
  } catch (err) {
    console.error(err);
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
