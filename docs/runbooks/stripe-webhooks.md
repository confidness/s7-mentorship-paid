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

## Which events, and what each does

| Event | What the webhook does |
| --- | --- |
| `checkout.session.completed` | If the session is `paid`, marks the order paid and upserts the entitlement. |
| `checkout.session.async_payment_succeeded` | The same, for methods that settle later. |
| `checkout.session.async_payment_failed` | Marks a `pending` order `failed`. |
| `checkout.session.expired` | Marks a `pending` order `failed`. |
| `charge.refunded` | Marks the order `refunded` and deletes the entitlement. |
| `account.updated` | Copies `charges_enabled` and `payouts_enabled` onto `mentor_accounts`. |
| `charge.dispute.created`, `charge.dispute.closed` | Not handled yet. Dispute handling is being added; subscribe to both when it lands. |

`checkout.session.completed` also fires for asynchronous methods that have not settled. The
webhook grants only when `payment_status` is `paid`, because granting on the others would hand
over content before the money exists; `async_payment_succeeded` is what closes that case.

Any other event type is acknowledged with a 200 and ignored. Returning an error would make
Stripe redeliver an event the webhook will never act on.

## Idempotency

Stripe retries until it gets a 2xx, and the same event will arrive more than once. Every write
is safe to repeat:

- `orders.stripe_session_id` is unique. A redelivery updates the same row to the same values.
- `entitlements` has a unique `(student_id, lesson_id)`, and the grant is an upsert that
  ignores a duplicate.
- A failed or expired event only moves an order that is still `pending`, so an `expired` event
  arriving after a successful payment cannot undo a sale.

The signature is verified against the raw request body (`req.text()`, never `req.json()`).
Parsing first re-serialises the JSON, the bytes no longer match what Stripe signed, and every
event fails. An unverified body gets a 400 and nothing is read out of it.

A database fault returns a 500, which asks Stripe to retry. That is what we want, and it is
safe precisely because the writes are idempotent.

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
   - `refunded` or `failed`: the system did what it was meant to. Check the Stripe dashboard
     for the refund or the failed payment.

2. **Look at Stripe's delivery log.** Dashboard, Developers, Webhooks, the endpoint, then the
   event deliveries for the session id from the order. The response code says where it broke:

   - 400 `invalid_signature`: `STRIPE_WEBHOOK_SECRET` is wrong for this endpoint. It is the
     most common cause. Check it was copied from this endpoint, in the right mode (test or
     live), and that the deployment was redeployed after it changed.
   - 500: a database fault or a missing variable. Read the function's log in Vercel.
   - No delivery at all: the endpoint is not subscribed to the event, or the URL is wrong.
   - 200 but the order is still `pending`: the session was not `paid` yet. An asynchronous
     method sends `async_payment_succeeded` when it settles.

   `GET /api/payments-health` reports whether the Stripe secret key and the webhook secret are
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

   This is the one place a person grants access, so confirm the payment first. Then find out
   why the event did not arrive; the hand-written row hides the fault, it does not fix it.

If the student has the entitlement and still sees a lock, the problem is on the read side:
`api/lesson-content.ts` decides access on every request from the `entitlements` table, so ask
for a refresh and check the response to that request.
