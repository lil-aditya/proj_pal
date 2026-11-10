# Devpost submission pack

Copy each block into the matching Devpost field. The hackathon form may have extra questions of its own; answer those from the "Short answers" section at the bottom.

## Project name

```
PayPilot — AI Back Office for Freelancers
```

## Elevator pitch

```
Tell PayPilot about a job in plain words. It creates the PayPal invoice, tracks payment, and chases late clients, and nothing is sent until you approve it.
```

## About the project

Paste the whole of `devpost/about.md`.

## Built with

```
next.js, react, typescript, tailwindcss, ag-grid, paypal-invoicing-api, paypal-sandbox, google-gemini, zod, render, node.js
```

## Try it out links

- Live app: `https://<your-render-name>.onrender.com` (add after deploying)
- Code: `https://github.com/lil-aditya/paypilot` (add after pushing)

## Image gallery

Upload 3–5 screenshots, in this order:

1. The dashboard with invoices and overdue badges (`devpost/screenshots/dashboard.png` is ready).
2. The chat after "Invoice Priya…", showing the approval card.
3. The two reminder cards from "Draft reminders for every overdue invoice".
4. PayPal's payment page for an invoice (the Payer view).
5. The green "just paid" notification.

Take 2–5 yourself with Win+Shift+S while recording the demo.

## Video demo link

Upload the video to YouTube as **Unlisted** or **Public** and paste the link. See `devpost/video-script.md`.

## Short answers (for any extra form questions)

**How does it use PayPal?**
PayPilot is built on the PayPal Invoicing v2 REST API: OAuth2 client credentials, invoice-number generation, draft creation, send, remind, cancel, and payment recording. Clients pay on PayPal's own hosted invoice page, and the dashboard polls PayPal so a payment shows up within seconds.

**How does it use AI?**
A Gemini agent with six function-calling tools turns plain language into structured invoices, reads live PayPal data to answer cash-flow questions, and writes payment reminders whose tone depends on how overdue the invoice is.

**What makes it agentic commerce, and how is it safe?**
The agent takes real commerce actions (it creates invoices in PayPal), but it can only draft and propose. Sending, reminding and cancelling run through separate endpoints that only a human approval click can reach, so the rule is enforced by the architecture rather than by the prompt.

**Who is it for?**
Freelancers and very small businesses who get paid through PayPal and lose time and cash to invoicing admin and late payments.

**Sponsor technology used**
- AG Grid: the invoice dashboard (custom cell renderers, pinned actions column, pinned totals row, sorting and filtering).
- Render: hosting, defined in `render.yaml`.

## Before you submit

- [ ] Live link opens and the chat answers
- [ ] GitHub repo is public and has no `.env.local`
- [ ] Video is under the length limit in the hackathon rules and is not private
- [ ] Added one personal line to "Inspiration" in the story
- [ ] Clicked **Submit** on Devpost, not only "Save" (aim for the evening of 12 Nov IST; the deadline is 1:30 AM IST on 13 Nov)
