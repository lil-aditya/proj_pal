# PayPilot — AI back office for freelancers

Tell PayPilot about a job in plain words. It creates the PayPal invoice, tracks payment, and chases late clients. **Nothing is sent until you approve it.**

Built for the PayPal AI Hackathon 2026.

## Features

- Natural language → PayPal draft invoice (line items, quantities, due dates)
- Approval cards for every send, reminder and cancellation; reminders are editable
- AI-written payment reminders, with tone matched to how overdue the invoice is
- Cash-flow insights: outstanding, overdue, collected, per-client days-to-pay
- AG Grid invoice dashboard with one-click actions and the payer's PayPal link
- Live "just paid" alerts (the dashboard polls PayPal every 15 seconds)
- Voice input in the chat (browser speech recognition)
- Per-visitor chat rate limit, so a public demo can't drain the free AI quota

## Stack

Next.js 16 · React 19 · Tailwind 4 · AG Grid · Google Gemini via `@google/genai` (Claude also supported) · PayPal Invoicing v2 REST API

## Architecture

```
Browser ──chat──▶ /api/chat ──▶ Gemini / Claude agent (function calling)
                                  ├─ list_invoices / get_invoice / payment_insights ─▶ PayPal (read)
                                  ├─ create_invoice_draft ─▶ PayPal (DRAFT only)
                                  └─ propose_reminder / propose_cancel ─▶ approval card (no PayPal call)
Browser ──Approve──▶ /api/invoices/[id]/send|remind|cancel ─▶ PayPal (write)
```

The agent's tools cannot reach the send, remind or cancel endpoints. Only an approval click in the UI can.

## Run locally

1. Create a PayPal **sandbox** app at developer.paypal.com → Apps & Credentials, and get a free Gemini API key at aistudio.google.com/apikey.
2. `cp .env.example .env.local` and fill in the keys.
3. `npm install && npm run dev`, then open http://localhost:3000.

To test payment end to end, open an invoice's **Payer view** link and pay with your sandbox *personal* account (developer.paypal.com → Sandbox accounts). Then click Refresh.

## Demo data

Fill your **sandbox** with realistic invoices (overdue, paid, open, draft):

```bash
node --env-file=.env.local --experimental-strip-types scripts/seed.ts
```

The script refuses to run when `PAYPAL_ENV=live`.

## Deploy (Render free tier)

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` sets up a free Node web service.
3. Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY` (and optionally `PAYPAL_BUSINESS_NAME`) when prompted.

Free instances sleep when idle, so the first request after a while takes ~30–60 s.
