// Client requests waiting for the freelancer, newest first, plus recent decisions.
import { connection } from "next/server";
import { listRequests } from "@/lib/store";

export async function GET() {
  // The store is read from disk synchronously; without this the response would be
  // prerendered once at build time and never change.
  await connection();
  const all = listRequests().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Response.json({
    pending: all.filter((r) => r.status === "pending"),
    recent: all.filter((r) => r.status !== "pending").slice(0, 5),
  });
}
