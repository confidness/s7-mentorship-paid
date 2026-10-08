# Runbook: Stripe webhooks

The webhook, `api/webhook.ts`, is the only thing in this codebase that grants an entitlement.
When a student says they paid and cannot open a lesson, the question is always the same: did a
verified event reach the webhook, and did the write succeed.

## Testing locally

`npm run dev` serves the interface only. The functions under `api/` are served by the Vercel
CLI, which is not a dependency of this repository; install it separately and run `vercel dev`,
with the variables from `.env.local` in place. It listens on port 3000 by default.

Then, with the Stripe CLI signed in to the same Stripe account as `STRIPE_SECRET_KEY`:

```
stripe listen --forward-to localhost:3000/api/webhook
```

`stripe listen` prints a signing secret that starts `whsec_`. Put it in `STRIPE_WEBHOOK_SECRET`
and restart `vercel dev`. That secret belongs to the CLI session; the deployed endpoint has a
different one, and mixing them up is the commonest reason every event is refused.

To exercise a purchase end to end, buy a priced lesson from a second account using a Stripe
test card. To replay an event you already have, `stripe events resend <event id>`.

`stripe trigger charge.refunded` and `stripe trigger charge.dispute.created` will show as failed
deliveries (409) when sent to the endpoint. That is expected: the triggered charge has no
matching order in your database, so the webhook treats it as a refund or dispute that has beaten
its payment notice and asks Stripe to retry. To test refunds and disputes properly, buy a lesson
first, then refund or dispute that payment from the dashboard.

## Which events, and what each does

Subscribe the endpoint to all eight:

| Event | What the webhook does |
| --- | --- |
| `checkout.session.completed` | If the session is `paid`, marks the order `paid` and grants the entitlement. |
| `checkout.session.async_payment_succeeded` | The same, for methods that settle later. |
| `checkout.session.async_payment_failed` | Marks a `pending` order `failed`. |
| `checkout.session.expired` | Marks a `pending` order `failed`. |
| `charge.refunded` | If the charge is fully refunded, marks the order `refunded` and withdraws the entitlement. A partial refund changes nothing. |
| `charge.dispute.created` | Marks the order `disputed` and withdraws the entitlement until the bank decides. |
| `charge.dispute.closed` | Won, or an inquiry closed with `warning_closed`: back to `paid`, access re-granted. Lost: `charged_back`, access stays shut. |
| `account.updated` | Copies `charges_enabled` and `payouts_enabled` onto `mentor_accounts`. |

The order statuses are `pending`, `paid`, `failed`, `refunded`, `disputed` and `charged_back`;
[Payments](../payments.md#orders-and-their-statuses) says what each means.

`checkout.session.completed` also fires for asynchronous methods that have not settled. The
webhook grants only when `payment_status` is `paid`, because granting on the others would hand
over content before the money exists; `async_payment_succeeded` is what closes that case.

Any other event type is acknowledged with a 200 and ignored. Returning an error would make
Stripe redeliver an event the webhook will never act on.

## Idempotency

Stripe retries until it gets a 2xx, and the same event will arrive more than once. Every event
is decided by an exported pure function, `settle(currentStatus, notice, ageSeconds)`, against the
order's current status, and the status write is conditional on that status still holding. So:

- A redelivery changes nothing. The order is already where the event would put it.
- A payment notice never reopens an order whose money has gone back. A late
  `checkout.session.completed` arriving after a refund does not re-grant the lesson, and an
  `expired` event arriving after a successful payment cannot undo a sale.
- `orders.stripe_session_id` is unique, and `entitlements` has a unique
  `(student_id, lesson_id)`, so even a second writer cannot make a second row.

A refund or dispute that reaches the webhook before the payment notice for the same order gets a
409, which makes Stripe retry. Once the event is three days old, which is the end of Stripe's
live retry window, it is acknowledged with a warning in the function log and the retries stop.
A 409 in the delivery log is therefore normal for a few minutes and a problem only if it
persists past the retries.

The signature is verified against the raw request body (`req.text()`, never `req.json()`).
Parsing first re-serialises the JSON, the bytes no longer match what Stripe signed, and every
event fails. An unverified body gets a 400 and nothing is read out of it.

A database fault returns a 500, which asks Stripe to retry. That is what we want, and it is
safe precisely because the writes are idempotent.

## What is not automated

The webhook does not reverse the transfer to the mentor. With destination charges, a lost
dispute costs the platform the whole sale plus the dispute fee. If policy says the mentor
should bear it, reverse the transfer from the Stripe dashboard. Refunds are issued from the
dashboard too, and reversing the transfer is chosen per refund.

## An entitlement is missing

Work down this list. Each step rules out the one before it.

1. **Find the order.** In the Supabase SQL editor:

   ```sql
   select id, status, stripe_session_id, created_at, paid_at
   from orders
   where student_id = '<student id>' and lesson_id = '<lesson id>'
   order by created_at desc;
   ```

   - No row: checkout never created a session. Look at the student's request, not the webhook.
   - `pending`: Stripe has not told us the money arrived, or the event did not get through.
     Go to step 2.
   - `paid`: the order is fine; go to step 4.
   - `refunded`: the charge was refunded in full and access was withdrawn on purpose. A partial
     refund leaves the order `paid`, so a student with a partial refund who lost access has a
     different problem; start at step 4.
   - `disputed`: the student's bank is contesting the payment. Access is withdrawn until it
     decides, and returns by itself if the dispute is won.
   - `charged_back`: the dispute was lost. Access stays shut. Do not grant it by hand.
   - `failed`: the payment failed or the session expired. Check the Stripe dashboard.

2. **Look at Stripe's delivery log.** Dashboard, Developers, Webhooks, the endpoint, then the
   event deliveries for the session id from the order. The response code says where it broke:

   - 400 `invalid_signature`: `STRIPE_WEBHOOK_SECRET` is wrong for this endpoint. It is the
     most common cause. Check it was copied from this endpoint, in the right mode (test or
     live), and that the deployment was redeployed after it changed.
   - 409: a refund or dispute arrived before its payment notice and is being retried. It
     clears once the payment notice lands. If a `checkout.session.completed` for the same
     order is itself failing, fix that one first.
   - 500: a database fault, a missing variable, or an order that changed while the event was
     being applied (the log says `changed while this event was being applied`). Read the
     function's log in Vercel. Stripe retries, and the retry is decided against the order as it
     now stands.
   - No delivery at all: the endpoint is not subscribed to the event, or the URL is wrong.
   - 200 but the order is still `pending`: the session was not `paid` yet. An asynchronous
     method sends `async_payment_succeeded` when it settles.

   `GET /api/health?payments=1` reports whether the Stripe secret key and the webhook secret are
   present (it never returns their values).

3. **Resend the event** from the dashboard, or with `stripe events resend`. Because the writes
   are idempotent, resending is always safe.

4. **Order is `paid` but there is no entitlement.** Check `entitlements` for the pair. A
   session created outside the usual path, with no `lessonId` or `studentId` in its metadata,
   logs `checkout session without metadata` and grants nothing. Search the function log for
   that line and the session id.

5. **Last resort, by hand.** If the payment is confirmed in Stripe and the event cannot be
   replayed, an operator can write the row the webhook would have written:

   ```sql
   insert into entitlements (student_id, lesson_id, order_id)
   values ('<student id>', '<lesson id>', '<order id>')
   on conflict (student_id, lesson_id) do nothing;
   ```

   This is the one place a person grants access, so confirm the payment first, and confirm in
   Stripe that it has not been refunded or disputed. Never do this for an order that is
   `refunded`, `disputed` or `charged_back`. Then find out why the event did not arrive; the
   hand-written row hides the fault, it does not fix it.

If the student has the entitlement and still sees a lock, the problem is on the read side:
`api/lesson-content.ts` decides access on every request from the `entitlements` table, so ask
for a refresh and check the response to that request.
