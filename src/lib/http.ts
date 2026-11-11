// Small helpers shared by the API routes.
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.CHAT_LIMIT_PER_10_MIN) || 30;
const hits = new Map<string, number[]>();

/** Per-IP limiter so a public demo link can't drain the free AI quota. */
export function rateLimited(req: Request, bucket = "chat") {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

/** Public base URL of this app, for links that are sent to clients. */
export function baseUrl(req: Request) {
  const fixed = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export function errorMessage(err: unknown) {
  if (err instanceof GeminiApiError) {
    return err.status === 429
      ? "The AI's free-tier limit was reached. Wait a minute and try again."
      : err.status === 503 || err.status === 500
        ? "The AI service is busy right now. Please try again in a moment."
        : err.status === 400 || err.status === 403
        ? `Gemini rejected the request (${err.status}). Check GEMINI_API_KEY / GEMINI_MODEL. ${err.message}`
        : `Gemini API error ${err.status}: ${err.message}`;
  }
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key is missing or invalid (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a moment.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export type Turn = { role: "user" | "assistant"; content: string };

/** Parse `{ messages }` from a chat request; null when it is malformed. */
export async function readTurns(req: Request): Promise<Turn[] | null> {
  try {
    const body = await req.json();
    const turns = (body.messages ?? []).filter(
      (m: Turn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content,
    );
    return turns.length && turns[turns.length - 1].role === "user" ? turns : null;
  } catch {
    return null;
  }
}
