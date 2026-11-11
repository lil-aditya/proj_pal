"use client";

// The client's page for one invoice: see what is owed, pay on PayPal, or talk to the
// business's assistant about a payment plan or more time.
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import RichText from "@/components/RichText";
import { fmtDate, fmtMoney } from "@/lib/format";

type View = {
  number: string;
  status: string;
  clientName: string;
  items: string;
  currency: string;
  total: number;
  due: number;
  dueDate: string;
  daysOverdue: number;
  payerUrl: string;
};

type Portal = {
  business: string;
  invoice: View;
  instalments: View[] | null;
  request: { kind: "payment_plan" | "extension" | "issue"; status: "pending" | "approved" | "declined"; summary: string } | null;
};

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const OPEN = ["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING", "SCHEDULED"];
const PAID = ["PAID", "MARKED_AS_PAID"];

const CHIPS = ["Can I pay in instalments?", "I need a little more time", "I have a question about this invoice"];

export default function Page() {
  // useParams reads the URL, so the page streams in behind a Suspense boundary.
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="h-48 animate-pulse rounded-2xl bg-slate-200/70" />
        </Shell>
      }
    >
      <ClientPage />
    </Suspense>
  );
}

function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Portal | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${id}`, { cache: "no-store" });
      if (res.status === 404) return setNotFound(true);
      if (res.ok) setData(await res.json());
    } catch {
      // keep showing the last known state
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessages((m) => [...m, { role: "assistant", content: json.reply }]);
      if (json.filed) load();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <Shell>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold">Invoice not found</p>
          <p className="mt-1 text-sm text-slate-500">Check the link in your email, or contact the business that sent it.</p>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200/70" />
      </Shell>
    );
  }

  const { invoice: inv, instalments, request, business } = data;
  const open = OPEN.includes(inv.status);
  const paid = PAID.includes(inv.status);
  const planLeft = instalments?.reduce((a, i) => a + (OPEN.includes(i.status) ? i.due : 0), 0) ?? 0;

  return (
    <Shell>
      <p className="text-sm text-slate-500">
        Invoice {inv.number} from <span className="font-medium text-slate-700">{business}</span>
      </p>

      <section className="mt-2 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Hi {inv.clientName.split(" ")[0]},</p>
        {instalments ? (
          <>
            <p className="mt-1 text-sm text-slate-500">Left to pay on your plan</p>
            <p className="text-4xl font-semibold tracking-tight">{fmtMoney(planLeft, inv.currency)}</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">{paid ? "Paid in full" : "Amount owed"}</p>
            <p className={`text-4xl font-semibold tracking-tight ${paid ? "text-emerald-600" : ""}`}>
              {fmtMoney(paid ? inv.total : inv.due, inv.currency)}
            </p>
            {open && inv.dueDate && (
              <p className="mt-1 text-sm">
                Due {fmtDate(inv.dueDate)}
                {inv.daysOverdue > 0 && (
                  <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                    {inv.daysOverdue} days overdue
                  </span>
                )}
              </p>
            )}
          </>
        )}
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">{inv.items}</p>

        {open && !instalments && (
          <a
            href={inv.payerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-xl bg-brand px-4 py-3 text-center font-medium text-white hover:opacity-95"
          >
            Pay {fmtMoney(inv.due, inv.currency)} with PayPal
          </a>
        )}
        {paid && <p className="mt-3 text-sm font-medium text-emerald-700">✓ Thank you. This invoice is paid.</p>}
      </section>

      {instalments && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Your payment plan</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {instalments.map((i, k) => {
              const iPaid = PAID.includes(i.status);
              return (
                <li key={i.number} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      Instalment {k + 1} of {instalments.length} · {fmtMoney(i.total, i.currency)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Due {fmtDate(i.dueDate)}
                      {i.daysOverdue > 0 && <span className="ml-1 font-medium text-rose-600">· {i.daysOverdue} days overdue</span>}
                    </p>
                  </div>
                  {iPaid ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">✓ Paid</span>
                  ) : (
                    <a
                      href={i.payerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Pay with PayPal
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {request && !instalments && (
        <div
          className={`mt-4 rounded-2xl border p-4 text-sm ${
            request.status === "pending"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : request.status === "approved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          <p className="font-medium">
            {request.status === "pending"
              ? `Waiting for ${business} to respond`
              : request.status === "approved"
                ? request.kind === "issue"
                  ? `${business} has seen your message`
                  : "Your request was approved"
                : "Your request was not approved. You can ask for something different below."}
          </p>
          {request.kind !== "issue" && <p className="mt-0.5">{request.summary}</p>}
        </div>
      )}

      {(open || messages.length > 0) && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Can&apos;t pay it all right now?</h2>
          <p className="text-sm text-slate-500">
            Chat with {business}&apos;s assistant about a payment plan or more time. Any change is confirmed by {business}.
          </p>

          {messages.length > 0 && (
            <div className="mt-3 space-y-2">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                      m.role === "user" ? "bg-brand-2 text-white" : m.error ? "bg-rose-50 text-rose-800" : "bg-slate-100"
                    }`}
                  >
                    <RichText text={m.content} />
                  </div>
                </div>
              ))}
              {busy && <div className="w-fit animate-pulse rounded-2xl bg-slate-100 px-3.5 py-2 text-sm text-slate-500">Typing…</div>}
              <div ref={endRef} />
            </div>
          )}

          {messages.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button key={c} onClick={() => send(c)} className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message"
              maxLength={1000}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-2"
            />
            <button disabled={busy || !input.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Send
            </button>
          </form>
        </section>
      )}

      <p className="mt-4 text-center text-xs text-slate-400">Payments are handled by PayPal. This page never sees your card or bank details.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <div className="mb-5 flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-sm font-bold text-white">P</div>
        <span className="text-sm font-semibold">PayPilot</span>
      </div>
      {children}
    </main>
  );
}
