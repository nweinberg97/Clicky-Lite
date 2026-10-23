# Fernbill Help Center

Fernbill is invoicing for freelancers and small studios: send invoices, get paid by card or bank transfer, and let reminders do the chasing. Everyone and every business in this guide is fictional.

## Feature: Invoices

An invoice has a client, one or more line items, payment terms and a due date. Sent invoices show as Sent, Paid or Overdue in the **Invoices** list. Your client pays with the payment link in the email.

## Feature: Payments

The **Payments** page lists every payment your clients have tried to make, including failed ones. Fernbill pays money out to your payout account two business days after a payment succeeds.

## How to send an invoice

Prerequisites: At least one client with a billing email.

1. Open **Invoices** from the sidebar.
2. Click **New invoice** at the top of the Invoices page.
3. Choose a **Client** from your client list.
4. Type what you did in **Description**, for example "Brand refresh, round 2".
5. Enter the **Amount** for that line.
6. Pick **Payment terms**, such as Net 30. The due date updates to match.
7. Click **Send invoice**. Your client gets an email with a link to pay.

## How to add a client

1. Open **Clients** from the sidebar.
2. Click **Add client**.
3. Enter the **Client name** as it should appear on invoices.
4. Enter the **Billing email** where invoices should go.
5. Click **Save client**.

## How to set up payment reminders

Turn on automatic reminders and Fernbill emails clients about late invoices for you, so you don't have to chase.

1. Open **Settings** from the sidebar.
2. Switch on **Automatic reminders**.
3. Pick an interval in **Remind every**, such as 7 days.
4. Click **Save settings**. Reminders go out for every unpaid invoice past its due date.

## How to resend a payment link

1. Open **Payments** from the sidebar.
2. Click **Resend payment link** on the failed payment. Your client gets a fresh link and can pay with another card.

## Troubleshooting: Payment failed: card declined (PAYMENT_DECLINED)

This shows on a payment when your client's bank declined their card. No money was taken and the invoice is still open, so nothing is lost.

Resolution: Click **Resend payment link** so your client can try again with another card or a bank transfer. If they say the card is fine, their bank is the one to call; Fernbill can't see why a bank declined a card.

## Troubleshooting: This client has no billing email (CLIENT_EMAIL_MISSING)

This shows when you click **Send invoice** for a client that has no billing email, so Fernbill has nowhere to send it. The invoice is saved as a draft.

Resolution: Choose a different **Client**, or open **Clients**, add a billing email to this client, and send the invoice again.

## Glossary

- **Net 30** — Payment is due 30 days after the invoice date. Net 15 means 15 days.
- **Due on receipt** — Payment is due as soon as the client gets the invoice.
- **Payment terms** — How long your client has to pay: Due on receipt, Net 15 or Net 30.
- **Payment link** — The secure link in each invoice email where your client pays by card or bank transfer.
- **Payout account** — The bank account Fernbill sends your money to.
- **Overdue** — An invoice that is past its due date and still unpaid.
