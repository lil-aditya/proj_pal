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
          <div className="h-48 animate-pulse rounded-lg bg-line/60" />
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
        <div className="rounded-lg border border-line bg-card p-8 text-center">
          <p className="font-serif text-2xl">Invoice not found</p>
          <p className="mt-1 text-sm text-muted">Check the link in your email, or contact the business that sent it.</p>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="h-48 animate-pulse rounded-lg bg-line/60" />
      </Shell>
    );
  }

  const { invoice: inv, instalments, request, business } = data;
  const open = OPEN.includes(inv.status);
  const paid = PAID.includes(inv.status);
  const planLeft = instalments?.reduce((a, i) => a + (OPEN.includes(i.status) ? i.due : 0), 0) ?? 0;

  return (
    <Shell>
      <p className="text-sm text-muted">
        Invoice <span className="num">{inv.number}</span> from <span className="text-ink">{business}</span>
      </p>

      <section className="mt-3 rounded-lg border border-line bg-card p-6">
        <p className="text-sm text-muted">Hi {inv.clientName.split(" ")[0]},</p>
        {instalments ? (
          <>
            <p className="mt-3 text-sm text-muted">Left to pay on your plan</p>
            <p className="num font-serif text-5xl leading-tight">{fmtMoney(planLeft, inv.currency)}</p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">{paid ? "Paid in full" : "Amount owed"}</p>
            <p className={`num font-serif text-5xl leading-tight ${paid ? "text-good" : ""}`}>
              {fmtMoney(paid ? inv.total : inv.due, inv.currency)}
            </p>
            {open && inv.dueDate && (
              <p className="num mt-1 text-sm">
                Due {fmtDate(inv.dueDate)}
                {inv.daysOverdue > 0 && <span className="ml-2 font-medium text-bad">{inv.daysOverdue} days overdue</span>}
              </p>
            )}
          </>
        )}
        <p className="mt-4 border-t border-line pt-3 text-sm text-muted">{inv.items}</p>

        {open && !instalments && (
          <a
            href={inv.payerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block rounded-md bg-brand px-4 py-3 text-center font-medium text-white hover:opacity-90"
          >
            Pay {fmtMoney(inv.due, inv.currency)} with PayPal
          </a>
        )}
        {paid && <p className="mt-4 text-sm font-medium text-good">Thank you. This invoice is paid.</p>}
      </section>

      {instalments && (
        <section className="mt-4 rounded-lg border border-line bg-card px-6 py-4">
          <h2 className="font-serif text-xl">Your payment plan</h2>
          <ul className="mt-1 divide-y divide-line">
            {instalments.map((i, k) => {
              const iPaid = PAID.includes(i.status);
              return (
                <li key={i.number} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="num text-sm">
                      <span className="text-muted">
                        {k + 1} of {instalments.length}
                      </span>
                      <span className="ml-2 font-medium">{fmtMoney(i.total, i.currency)}</span>
                    </p>
                    <p className="num text-xs text-muted">
                      Due {fmtDate(i.dueDate)}
                      {i.daysOverdue > 0 && <span className="ml-1 font-medium text-bad">· {i.daysOverdue} days overdue</span>}
                    </p>
                  </div>
                  {iPaid ? (
                    <span className="text-sm font-medium text-good">Paid</span>
                  ) : (
                    <a href={i.payerUrl} target="_blank" rel="noreferrer" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
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
          className={`mt-4 rounded-lg border border-line border-l-2 bg-card px-4 py-3 text-sm ${
            request.status === "pending" ? "border-l-warn" : request.status === "approved" ? "border-l-good" : "border-l-muted"
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
          {request.kind !== "issue" && <p className="mt-0.5 text-muted">{request.summary}</p>}
        </div>
      )}

      {(open || messages.length > 0) && (
        <section className="mt-4 rounded-lg border border-line bg-card p-6">
          <h2 className="font-serif text-xl">Can&apos;t pay it all right now?</h2>
          <p className="mt-0.5 text-sm text-muted">
            Ask {business}&apos;s assistant about a payment plan or more time. {business} confirms any change.
          </p>

          {messages.length > 0 && (
            <div className="mt-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={`whitespace-pre-wrap text-sm leading-relaxed ${
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-white"
                        : m.error
                          ? "border-l-2 border-bad pl-3 text-bad"
                          : "pr-6"
                    }`}
                  >
                    <RichText text={m.content} />
                  </div>
                </div>
              ))}
              {busy && <p className="animate-pulse text-sm text-muted">Typing…</p>}
              <div ref={endRef} />
            </div>
          )}

          {messages.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button key={c} onClick={() => send(c)} className="rounded-md border border-line px-3 py-1.5 text-[13px] hover:border-brand hover:text-brand">
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-4 flex gap-2"
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
              className="min-w-0 flex-1 rounded-md border border-line bg-paper/50 px-3 py-2 text-sm outline-none focus:border-brand focus:bg-white"
            />
            <button disabled={busy || !input.trim()} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Send
            </button>
          </form>
        </section>
      )}

      <p className="mt-6 text-center text-xs text-muted">Payments are handled by PayPal. This page never sees your card or bank details.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <p className="mb-6 font-serif text-2xl leading-none">PayPilot</p>
      {children}
    </main>
  );
}
