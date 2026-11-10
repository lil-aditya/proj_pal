import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { runAgent, type ChatTurn } from "@/lib/agent";
import { PayPalError } from "@/lib/paypal";

export const maxDuration = 120;

export async function POST(req: Request) {
  let history: ChatTurn[];
  try {
    const body = await req.json();
    history = (body.messages ?? []).filter(
      (m: ChatTurn) =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content,
    );
    if (!history.length || history[history.length - 1].role !== "user") throw new Error();
  } catch {
    return Response.json({ error: "Expected { messages: [...] } ending with a user turn" }, { status: 400 });
  }

  try {
    return Response.json(await runAgent(history));
  } catch (err) {
    console.error(err);
    let message = "Something went wrong.";
    if (err instanceof GeminiApiError) {
      message =
        err.status === 429
          ? "Gemini free-tier limit reached. Wait a minute and try again."
          : err.status === 400 || err.status === 403
            ? `Gemini rejected the request (${err.status}). Check GEMINI_API_KEY / GEMINI_MODEL. ${err.message}`
            : `Gemini API error ${err.status}: ${err.message}`;
    } else if (err instanceof Anthropic.AuthenticationError) message = "Claude API key is missing or invalid (ANTHROPIC_API_KEY).";
    else if (err instanceof Anthropic.RateLimitError) message = "Claude is rate-limited right now. Try again in a moment.";
    else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status}: ${err.message}`;
    else if (err instanceof PayPalError || err instanceof Error) message = err.message;
    return Response.json({ error: message }, { status: 500 });
  }
}
