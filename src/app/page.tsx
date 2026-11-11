"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Proposal } from "@/lib/agent";
import type { Invoice } from "@/lib/paypal";
import type { ClientRequest } from "@/lib/store";
import type { RowAction } from "@/components/InvoiceGrid";
import RichText from "@/components/RichText";

const InvoiceGrid = dynamic(() => import("@/components/InvoiceGrid"), { ssr: false });

type Insights = {
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  paidTotal: number;
  drafts: number;
  totalInvoices: number;
};

type CardState = "pending" | "working" | "done" | "dismissed" | "error";
type Card = Proposal & { state: CardState; error?: string };
type Msg = { role: "user" | "assistant"; content: string; cards?: Card[]; error?: boolean };

const SUGGESTIONS = [
  "Invoice Priya Sharma (priya@example.com) for 3 hours of logo design at $40/hr, due Friday",
  "Who owes me money right now?",
  "Draft reminders for every overdue invoice",
  "How is my cash flow this month?",
];

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Home() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm PayPilot. Tell me about work you've done and I'll draft the PayPal invoice. I can also chase late payers and explain your cash flow. Nothing is sent until you approve it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [deciding, setDeciding] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastStatus = useRef<Map<string, string> | null>(null);
  const seenRequests = useRef<Set<string> | null>(null);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const list: Invoice[] = json.invoices;
      // Announce invoices that became paid since the last poll (e.g. the client just paid on PayPal).
      if (lastStatus.current) {
        for (const inv of list) {
          const before = lastStatus.current.get(inv.id);
          if (before && before !== inv.status && (inv.status === "PAID" || inv.status === "MARKED_AS_PAID")) {
            toast(`💸 ${inv.clientName} just paid invoice ${inv.number}: ${money(inv.total)}`);
          }
        }
      }
      lastStatus.current = new Map(list.map((i) => [i.id, i.status]));
      setInvoices(list);
      setInsights(json.insights);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
    // Requests that clients filed from their invoice pages.
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      if (!res.ok) return;
      const pending: ClientRequest[] = (await res.json()).pending;
      if (seenRequests.current) {
        for (const r of pending) {
          if (!seenRequests.current.has(r.id)) toast(`📩 ${r.clientName} sent a request about invoice ${r.invoiceNumber}`);
        }
      }
      seenRequests.current = new Set(pending.map((r) => r.id));
      setRequests(pending);
    } catch {
      // the inbox is optional; keep the dashboard working without it
    }
  }, [toast]);

  const decide = async (r: ClientRequest, decision: "approve" | "decline") => {
    setDeciding(r.id);
    try {
      const res = await fetch(`/api/requests/${r.id}/${decision}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast(
        decision === "decline"
          ? `Declined ${r.clientName}'s request`
          : r.kind === "payment_plan"
            ? `✅ Payment plan set up for ${r.clientName}: ${r.instalments?.length} instalment invoices sent`
            : r.kind === "extension"
              ? `✅ Due date moved for ${r.clientName}`
              : `Marked ${r.clientName}'s message as handled`,
      );
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeciding("");
      refresh();
    }
  };

  useEffect(() => {
    refresh();
    // Light polling so payments made on PayPal show up live.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognition()));
  }, []);

  const startVoice = () => {
    const SR = getSpeechRecognition();
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.onresult = (e) => setInput(Array.from(e.results).map((r) => r[0].transcript).join(" "));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
      setMessages(next);
      setInput("");
      setBusy(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: json.reply,
            cards: (json.proposals as Proposal[]).map((p) => ({ ...p, state: "pending" as const })),
          },
        ]);
        if (json.refresh) refresh();
      } catch (e) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${(e as Error).message}`, error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, refresh],
  );

  const updateCard = (mi: number, ci: number, patch: Partial<Card>) =>
    setMessages((ms) =>
      ms.map((m, i) => (i !== mi ? m : { ...m, cards: m.cards!.map((c, j) => (j !== ci ? c : { ...c, ...patch } as Card)) })),
    );

  const approve = async (mi: number, ci: number, card: Card) => {
    updateCard(mi, ci, { state: "working" });
    const [path, body] =
      card.kind === "send_invoice"
        ? ["send", {}]
        : card.kind === "send_reminder"
          ? ["remind", { subject: card.subject, note: card.note }]
          : ["cancel", { note: card.note }];
    try {
      const res = await fetch(`/api/invoices/${card.invoiceId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      updateCard(mi, ci, { state: "done" });
      setMessages((m) => [...m, { role: "assistant", content: `✅ Done: ${card.title}.` }]);
      refresh();
    } catch (e) {
      updateCard(mi, ci, { state: "error", error: (e as Error).message });
    }
  };

  const onRowAction = useCallback(
    async (action: RowAction, inv: Invoice) => {
      if (action === "remind-ai") {
        send(`Draft a payment reminder for invoice ${inv.number} (id ${inv.id}) to ${inv.clientName}.`);
        return;
      }
      const label = action === "send" ? `Send invoice ${inv.number} to ${inv.clientEmail}?` : `Record ${inv.number} as paid outside PayPal?`;
      if (!window.confirm(label)) return;
      const res = await fetch(`/api/invoices/${inv.id}/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) alert(json.error);
      refresh();
    },
    [send, refresh],
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 font-bold text-white">P</div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">PayPilot</h1>
            <p className="text-xs text-slate-500">AI back office · powered by PayPal</p>
          </div>
        </div>
        <button onClick={refresh} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
          ↻ Refresh
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Outstanding" value={insights ? money(insights.outstanding) : "—"} />
            <Stat
              label="Overdue"
              value={insights ? money(insights.overdueAmount) : "—"}
              sub={insights ? `${insights.overdueCount} invoice${insights.overdueCount === 1 ? "" : "s"}` : ""}
              tone={insights && insights.overdueCount > 0 ? "bad" : undefined}
            />
            <Stat label="Collected" value={insights ? money(insights.paidTotal) : "—"} tone="good" />
            <Stat label="Drafts" value={insights ? String(insights.drafts) : "—"} sub={insights ? `${insights.totalInvoices} total` : ""} />
          </div>
          {loadError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              Couldn&apos;t load invoices: {loadError}
            </div>
          )}
          {requests.length > 0 && (
            <div className="max-h-[42%] space-y-2 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Client requests · {requests.length} waiting for you
              </p>
              {requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {r.kind === "payment_plan" ? "🗓️" : r.kind === "extension" ? "⏳" : "❓"} {r.clientName} · invoice {r.invoiceNumber}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {r.kind === "payment_plan" ? "asks for a payment plan" : r.kind === "extension" ? "asks for more time" : "has a question or problem"}
                      </span>
                    </p>
                    <p className="text-slate-700">{r.summary}</p>
                    {r.reason && <p className="text-xs italic text-slate-500">Client says: “{r.reason}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={deciding === r.id}
                      onClick={() => decide(r, "approve")}
                      className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {deciding === r.id ? "Working…" : r.kind === "issue" ? "Mark as handled" : "Approve"}
                    </button>
                    {r.kind !== "issue" && (
                      <button
                        disabled={deciding === r.id}
                        onClick={() => decide(r, "decline")}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        Decline
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="min-h-[300px] flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <InvoiceGrid invoices={invoices} onAction={onRowAction} />
          </div>
        </section>

        <aside className="flex min-h-[500px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="font-semibold">Ask PayPilot</h2>
            <p className="text-xs text-slate-500">Drafts invoices and reminders. You approve every send.</p>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, mi) => (
              <div key={mi} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                    m.role === "user" ? "bg-brand-2 text-white" : m.error ? "bg-rose-50 text-rose-800" : "bg-slate-100"
                  }`}
                >
                  <RichText text={m.content} />
                </div>
                {m.cards?.map((c, ci) => (
                  <ApprovalCard
                    key={ci}
                    card={c}
                    onChange={(patch) => updateCard(mi, ci, patch)}
                    onApprove={() => approve(mi, ci, c)}
                  />
                ))}
              </div>
            ))}
            {busy && <div className="w-fit animate-pulse rounded-2xl bg-slate-100 px-3.5 py-2 text-sm text-slate-500">PayPilot is working…</div>}
          </div>
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1 text-left text-xs hover:bg-slate-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2 border-t border-slate-200 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "e.g. Bill Acme $500 for the website audit"}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-2"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={startVoice}
                title="Speak your request"
                aria-label="Speak your request"
                className={`rounded-lg border px-3 py-2 text-sm ${listening ? "animate-pulse border-rose-400 bg-rose-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}
              >
                🎤
              </button>
            )}
            <button disabled={busy || !input.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Send
            </button>
          </form>
        </aside>
      </main>

      <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
};

function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ApprovalCard({ card, onChange, onApprove }: { card: Card; onChange: (p: Partial<Card>) => void; onApprove: () => void }) {
  const icon = card.kind === "send_invoice" ? "📨" : card.kind === "send_reminder" ? "🔔" : "🗑️";
  const editable = card.state === "pending" || card.state === "error";
  return (
    <div className="mt-2 max-w-[95%] rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm">
      <p className="font-medium">
        {icon} {card.title}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">{card.detail}</p>
      {card.kind === "send_reminder" && (
        <div className="mt-2 space-y-1.5">
          <input
            disabled={!editable}
            value={card.subject}
            onChange={(e) => onChange({ subject: e.target.value } as Partial<Card>)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          />
          <textarea
            disabled={!editable}
            value={card.note}
            rows={5}
            onChange={(e) => onChange({ note: e.target.value } as Partial<Card>)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {editable && (
          <>
            <button onClick={onApprove} className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-white">
              Approve &amp; send
            </button>
            <button onClick={() => onChange({ state: "dismissed" })} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs">
              Dismiss
            </button>
          </>
        )}
        {card.state === "working" && <span className="text-xs text-slate-500">Sending…</span>}
        {card.state === "done" && <span className="text-xs font-medium text-emerald-700">✓ Approved and sent</span>}
        {card.state === "dismissed" && <span className="text-xs text-slate-500">Dismissed</span>}
        {card.state === "error" && <span className="text-xs text-rose-700">{card.error}</span>}
      </div>
    </div>
  );
}
