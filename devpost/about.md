## Inspiration

Freelancers and very small businesses don't lose money because nobody wants their work. They lose it in the gap between finishing the job and getting paid. Someone has to write the invoice, remember who hasn't paid, work out what's overdue, and send the awkward "just following up…" email. That admin is boring and easy to put off, and every day it waits is a day later that the cash arrives.

PayPal already has the hard pieces: invoicing, hosted payment pages, and payment tracking. What's missing is someone who *does the paperwork for you*. So I built **PayPilot**: an AI back office that turns a plain-language sentence into a real PayPal invoice and then follows the money until it's paid. It never sends anything without your approval.

## What it does

- **Invoice in one sentence.** *"Invoice Priya Sharma (priya@example.com) for 3 hours of logo design at \$40/hr, due Friday."* PayPilot turns that into line items, works out what date "Friday" means, and creates a **draft invoice in PayPal**.
- **Approval before anything goes out.** Every action that reaches a client or changes money state (sending an invoice, a reminder, or a cancellation) appears as an **approval card**. You can edit the reminder text, then click *Approve & send*. The AI can draft and propose. Only you can send.
- **Chases late payers in the right tone.** PayPilot looks up an invoice's real status and how overdue it is before writing a reminder. The tone is friendly when the invoice is just due and firmer when it's weeks late.
- **Cash-flow answers.** *"Who owes me money?"* or *"How's my cash flow?"* returns real numbers: outstanding, overdue, collected, and which clients pay slowly.
- **Live dashboard.** An AG Grid table of every invoice, with status and days-late badges, a totals row, one-click actions, and a link to the client's PayPal payment page.
- **"You just got paid" alerts.** The dashboard checks PayPal every 15 seconds. When a client pays on PayPal's invoice page, the invoice turns green and a notification pops up.
- **Talk instead of type.** A microphone button lets you speak the request, using the browser's built-in speech recognition.

## How I built it

- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind CSS 4. The invoice table uses **AG Grid** with custom cell renderers for status, overdue badges and row actions, a pinned actions column and a pinned totals row.
- **AI agent:** **Google Gemini** (Flash) through the official `@google/genai` SDK, with my own function-calling loop. The agent layer doesn't depend on one provider: the same tool definitions also run on Anthropic's Claude. I gave the agent six tools, each defined once with a Zod schema that is validated on every call: `list_invoices`, `get_invoice`, `create_invoice_draft`, `propose_reminder`, `propose_cancel` and `payment_insights`.
- **PayPal:** a typed client for the **PayPal Invoicing v2 REST API**. It handles OAuth2 client-credentials with token caching, invoice-number generation, draft creation, send, remind, cancel and payment recording. Clients pay on PayPal's own hosted invoice page.
- **Approval by design:** tools that would affect a client never call PayPal's send, remind or cancel endpoints. They return a *proposal* to the UI. Those endpoints sit behind separate API routes that only an approval click can reach. So the safety rule doesn't depend on the model behaving: the agent's tools have no route to them at all.

The insights come from simple, explainable maths over invoice history. For a client $c$ with paid invoices $P_c$, average days to pay is

$$
\bar{d}_c = \frac{1}{|P_c|} \sum_{i \in P_c} \left( t^{\text{paid}}_i - t^{\text{issued}}_i \right)
$$

and the overdue exposure the dashboard shows is

$$
O = \sum_{i \in \text{open}} \text{due}_i \cdot \mathbb{1}\!\left[\, t_{\text{today}} > t^{\text{due}}_i \,\right]
$$

so a freelancer can see both *how much* money is late and *who* is usually late.

## Challenges I ran into

- **Letting the AI handle money safely.** The obvious design lets the agent call PayPal's send endpoint itself. That's the wrong design: an AI should not email a client a bill because it misread "\$400" as "\$4,000". Splitting every action into an AI *proposal* and a human *execution* through separate routes was the key decision of the build.
- **Keeping the model honest about what happened.** After drafting, a language model wants to say "I've sent the invoice!". The tool results and the system prompt both state that an action is only *queued*, and the UI confirms an action only after PayPal's API returns success.
- **Turning casual language into invoice data.** "3 hrs at 40", "due Friday" and "half up front" all have to become exact line items, quantities, units and ISO dates. When something is truly missing, such as an email address, the agent asks one short question instead of guessing.
- **PayPal API details.** The invoice *list* endpoint leaves out line items and payment transactions, so my first dashboard had an empty Items column and no "days to pay" numbers. I now fetch each invoice's full record and cache it until PayPal reports a change. I also had to learn which statuses count as "open" and that a draft must be deleted rather than cancelled.
- **Building on a zero budget.** I could only use free tiers, so the agent runs on Gemini's free Flash tier. That meant handling rate limits gracefully, adding a per-visitor limit so a public demo link can't drain the quota, and pinning a model version after the "latest" alias turned out not to exist on the API version the SDK calls.

## Accomplishments that I'm proud of

- Going from a sentence to a real, payable PayPal invoice in a few seconds, with a person approving it.
- A safety model that is enforced by the architecture, not just requested in the prompt.
- Building it end to end as a solo developer within the hackathon window.

## What I learned

- Agentic commerce is mostly about **trust boundaries**: decide which actions the AI may take on its own and which need a person, then enforce that in code.
- Small, well-described tools beat one giant "do everything" tool. The model picks the right tool far more reliably.
- PayPal's Invoicing API already covers the whole invoicing workflow (drafts, numbering, reminders, hosted payment pages, payment recording). The opportunity is in the experience you build on top of it.

## What's next for PayPilot

- Photos of receipts or timesheets as input.
- Scheduled, automatic follow-ups, approved once per client as a policy.
- PayPal webhooks for real-time "you just got paid" notifications.
- Recurring invoices, deposits and milestone billing for longer projects.
- Multi-currency insights for freelancers with international clients.
