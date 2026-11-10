# Demo video script (about 3 minutes)

Check the hackathon rules for the maximum video length before recording. Record with OBS, or Win+Alt+R (Xbox Game Bar), at 1080p.

## Set up before recording

- Set `PAYPAL_BUSINESS_NAME` in `.env.local` (for example `Aditya Designs`) and restart the app, so reminders are signed.
- Tab 1: PayPilot, freshly reloaded so the chat is empty.
- Tab 2: `sandbox.paypal.com`, **logged out**. Have the sandbox *personal* account's email and password ready (developer.paypal.com → Testing Tools → Sandbox Accounts).
- Do one silent practice run first. Don't run the seed script again; it would create duplicate invoices.
- Leave a few seconds between chat messages so the free Gemini limit isn't hit.

## Script

**0:00 – 0:20 · The problem** (show the dashboard)

> "Freelancers don't lose money because nobody wants their work. They lose it between finishing the job and getting paid: writing invoices, tracking who hasn't paid, sending awkward follow-ups. PayPilot is an AI back office that does that paperwork on PayPal for you."

**0:20 – 1:00 · Invoice in one sentence**

Type, or click the mic and say:
`Invoice Sara Khan (sara.khan@example.com) for 5 hours of video editing at $30/hr, due next Friday`

> "I describe the job in plain words. The agent works out the line items and the due date and creates a real draft invoice in PayPal."

Point at the approval card.

> "Notice it hasn't sent anything. The AI can only draft and propose. I review the card and approve it."

Click **Approve & send**. Show the new row with status *sent*.

**1:00 – 1:40 · The client pays**

Click **Payer view** on the new invoice. In the PayPal page, log in as the sandbox personal account and pay.

> "This is what my client sees: PayPal's own invoice page. They pay the way they already trust."

Switch back to PayPilot and wait up to 15 seconds for the green notification.

> "PayPilot notices the payment on its own. The invoice turns paid and my collected total goes up."

**1:40 – 2:25 · Chasing late payers**

Type: `Draft reminders for every overdue invoice`

> "Two clients are late. The agent checks each invoice's real status first, then writes each reminder in a tone that fits: friendly for one week late, firmer for almost four weeks."

Edit a word in one reminder, then click **Approve & send** on it.

> "I can edit the message, and again nothing goes out until I approve."

**2:25 – 2:45 · Cash flow**

Type: `How is my cash flow?`

> "I can also just ask about my money and get real numbers from PayPal: what's outstanding, what's overdue, and which clients pay slowly."

**2:45 – 3:00 · How it works**

> "Under the hood it's a Gemini agent with six tools on the PayPal Invoicing API, and an AG Grid dashboard, hosted on Render. The key design decision: the agent's tools cannot reach PayPal's send, remind or cancel endpoints. Only my approval click can. That's PayPilot: agentic commerce with a human in control."
