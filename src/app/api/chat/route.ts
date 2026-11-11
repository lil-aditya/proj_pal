import { runAgent } from "@/lib/agent";
import { baseUrl, errorMessage, rateLimited, readTurns } from "@/lib/http";

export const maxDuration = 120;

export async function POST(req: Request) {
  if (rateLimited(req)) {
    return Response.json({ error: "Demo limit reached. Please wait a few minutes and try again." }, { status: 429 });
  }
  const history = await readTurns(req);
  if (!history) {
    return Response.json({ error: "Expected { messages: [...] } ending with a user turn" }, { status: 400 });
  }
  try {
    return Response.json(await runAgent(history, { baseUrl: baseUrl(req) }));
  } catch (err) {
    console.error(err);
    return Response.json({ error: errorMessage(err) }, { status: 500 });
  }
}
