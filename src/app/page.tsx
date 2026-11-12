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

const KIND_LABEL: Record<ClientRequest["kind"], string> = {
  payment_plan: "Payment plan",
  extension: "More time",
  issue: "Question",
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Home() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Tell me about a job you've finished and I'll draft the PayPal invoice. I can also chase late payers and explain where your money is. Nothing goes out until you approve it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [deciding, setDeciding] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
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
            toast(`${inv.clientName} just paid invoice ${inv.number}: ${money(inv.total)}`);
          }
        }
      }
      lastStatus.current = new Map(list.map((i) => [i.id, i.status]));
      setInvoices(list);
      setInsights(json.insights);
      setSyncedAt(new Date());
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
          if (!seenRequests.current.has(r.id)) toast(`${r.clientName} sent a request about invoice ${r.invoiceNumber}`);
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
            ? `Payment plan set up for ${r.clientName}: ${r.instalments?.length} instalment invoices sent`
            : r.kind === "extension"
              ? `Due date moved for ${r.clientName}`
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
        setMessages((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
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
      setMessages((m) => [...m, { role: "assistant", content: `Done: ${card.title}.` }]);
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
      <header className="flex items-baseline justify-between px-6 pb-3 pt-5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[28px] leading-none tracking-tight">PayPilot</h1>
          <p className="hidden text-sm text-muted sm:block">Invoices and follow-ups on PayPal</p>
        </div>
        <button onClick={refresh} className="num text-sm text-muted hover:text-ink">
          {syncedAt ? `Synced ${syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Syncing…"}
          <span className="ml-2 underline underline-offset-2">Refresh</span>
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-6 pb-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-0 flex-col gap-5">
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-card md:grid-cols-4">
            <Stat label="Outstanding" value={insights ? money(insights.outstanding) : "—"} />
            <Stat
              label="Overdue"
              value={insights ? money(insights.overdueAmount) : "—"}
              sub={insights ? `${insights.overdueCount} invoice${insights.overdueCount === 1 ? "" : "s"}` : ""}
              tone={insights && insights.overdueCount > 0 ? "bad" : undefined}
            />
            <Stat label="Collected" value={insights ? money(insights.paidTotal) : "—"} tone="good" />
            <Stat label="Drafts" value={insights ? String(insights.drafts) : "—"} sub={insights ? `of ${insights.totalInvoices} invoices` : ""} />
          </div>

          {loadError && (
            <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-2 text-sm text-bad">Couldn&apos;t load invoices: {loadError}</div>
          )}

          {requests.length > 0 && (
            <div className="max-h-[42%] overflow-y-auto rounded-lg border border-line bg-card">
              <p className="border-b border-line px-4 py-2.5 text-sm font-medium">
                Waiting on you <span className="num text-muted">({requests.length})</span>
              </p>
              {requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line border-l-2 border-l-warn px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1 text-sm">
                    <p>
                      <span className="font-medium">{r.clientName}</span>
                      <span className="text-muted"> · invoice {r.invoiceNumber} · </span>
                      <span className="text-warn">{KIND_LABEL[r.kind]}</span>
                    </p>
                    <p className="mt-0.5">{r.summary}</p>
                    {r.reason && <p className="mt-0.5 text-[13px] text-muted">&ldquo;{r.reason}&rdquo;</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {r.kind !== "issue" && (
                      <button
                        disabled={deciding === r.id}
                        onClick={() => decide(r, "decline")}
                        className="rounded-md border border-line px-3 py-1.5 text-[13px] hover:bg-paper disabled:opacity-50"
                      >
                        Decline
                      </button>
                    )}
                    <button
                      disabled={deciding === r.id}
                      onClick={() => decide(r, "approve")}
                      className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {deciding === r.id ? "Working…" : r.kind === "issue" ? "Mark handled" : "Approve"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-[300px] flex-1 overflow-hidden rounded-lg border border-line bg-card">
            <InvoiceGrid invoices={invoices} onAction={onRowAction} />
          </div>
        </section>

        <aside className="flex min-h-[500px] flex-col overflow-hidden rounded-lg border border-line bg-card">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-serif text-xl leading-tight">Assistant</h2>
            <p className="text-[13px] text-muted">Drafts invoices and reminders. You approve every send.</p>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((m, mi) => (
              <div key={mi} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={`whitespace-pre-wrap text-sm leading-relaxed ${
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-white"
                      : m.error
                        ? "border-l-2 border-bad pl-3 text-bad"
                        : "pr-4"
                  }`}
                >
                  <RichText text={m.content} />
                </div>
                {m.cards?.map((c, ci) => (
                  <ApprovalCard key={ci} card={c} onChange={(patch) => updateCard(mi, ci, patch)} onApprove={() => approve(mi, ci, c)} />
                ))}
              </div>
            ))}
            {busy && <p className="animate-pulse text-sm text-muted">Working on it…</p>}
          </div>
          {messages.length <= 1 && (
            <div className="px-4 pb-3">
              <p className="mb-1 text-xs text-muted">Try</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full border-t border-line py-2 text-left text-[13px] text-ink/80 hover:text-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "Bill Acme $500 for the website audit"}
              className="min-w-0 flex-1 rounded-md border border-line bg-paper/50 px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-brand focus:bg-white"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={startVoice}
                title="Speak your request"
                aria-label="Speak your request"
                className={`grid w-10 place-items-center rounded-md border ${
                  listening ? "animate-pulse border-bad text-bad" : "border-line text-muted hover:text-ink"
                }`}
              >
                <MicIcon />
              </button>
            )}
            <button disabled={busy || !input.trim()} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
              Send
            </button>
          </form>
        </aside>
      </main>

      <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-center gap-2.5 rounded-md bg-ink px-4 py-3 text-sm text-white shadow-lg">
            <span className="h-2 w-2 rounded-full bg-[#7fc6a0]" />
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

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="border-line px-5 py-4 [&:not(:last-child)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={`num mt-1 font-serif text-[30px] leading-none ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</p>
      <p className="num mt-1.5 h-4 text-xs text-muted">{sub}</p>
    </div>
  );
}

function ApprovalCard({ card, onChange, onApprove }: { card: Card; onChange: (p: Partial<Card>) => void; onApprove: () => void }) {
  const editable = card.state === "pending" || card.state === "error";
  return (
    <div className="mt-3 rounded-md border border-line bg-paper/60 p-3 text-sm">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Needs your approval</p>
      <p className="mt-1 font-medium">{card.title}</p>
      <p className="mt-0.5 text-[13px] text-muted">{card.detail}</p>
      {card.kind === "send_reminder" && (
        <div className="mt-2 space-y-1.5">
          <input
            disabled={!editable}
            value={card.subject}
            onChange={(e) => onChange({ subject: e.target.value } as Partial<Card>)}
            className="w-full rounded border border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-brand"
          />
          <textarea
            disabled={!editable}
            value={card.note}
            rows={5}
            onChange={(e) => onChange({ note: e.target.value } as Partial<Card>)}
            className="w-full rounded border border-line bg-white px-2 py-1 text-[13px] leading-relaxed outline-none focus:border-brand"
          />
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3">
        {editable && (
          <>
            <button onClick={onApprove} className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
              Approve &amp; send
            </button>
            <button onClick={() => onChange({ state: "dismissed" })} className="text-[13px] text-muted hover:text-ink">
              Dismiss
            </button>
          </>
        )}
        {card.state === "working" && <span className="text-[13px] text-muted">Sending…</span>}
        {card.state === "done" && <span className="text-[13px] font-medium text-good">Approved and sent</span>}
        {card.state === "dismissed" && <span className="text-[13px] text-muted">Dismissed</span>}
        {card.state === "error" && <span className="text-[13px] text-bad">{card.error}</span>}
      </div>
    </div>
  );
}
