# Payments

Mentors price their own lessons and keep most of each sale.

| Piece | Where it lives |
| --- | --- |
| Price | `custom_lessons.price_cents`, integer minor units — never a float |
| Purchase | Stripe Checkout, created by `api/checkout.ts` |
| The platform's cut | `PLATFORM_FEE_BPS` basis points, default 2000 = 20% |
| Payout | Stripe Connect Express; Stripe handles KYC and bank details |
| Access | a row in `entitlements`, written **only** by the Stripe webhook |

Two properties are worth stating plainly, because they are what make this real rather than
decorative:

**The price is never taken from the request.** `api/checkout.ts` reads it from the database.
A client that could name its own amount would buy a forty-dollar lesson for one cent. The
request body carries a lesson id and nothing else that touches money.

**The paywall is the server, not the UI.** `api/lesson-content.ts` refuses to send tasks or a
material URL without an entitlement row, and strips the quiz answer key from every student
copy. Editing `localStorage`, or calling the endpoint directly with a valid session, yields the
same 402. The lock icon in the interface is a courtesy; deleting it from the DOM reveals
nothing. `test/monetization.test.ts` asserts exactly this.

Webhook deliveries are idempotent, keyed on the Checkout Session id — Stripe retries on
purpose, and a redelivery must not grant a second entitlement or count the revenue twice.

A free lesson is open to anyone who can see it. That sounds obvious and was not: the row level
security policy required an entitlement to submit, entitlements exist only for something
somebody paid for, and so a lesson priced at zero could never be handed in at all.

## A purchase, in order

1. The student presses buy. `api/checkout.ts` identifies them from the token, reads the lesson
   from the database, and refuses if it is unpublished, free, the student's own, or already
   owned.
2. It checks that the author's connected account still accepts charges. This runs at purchase
   time as well as at publish time, because Stripe can restrict an account in between.
3. It creates a Checkout Session with `application_fee_amount` set to the platform's cut and
   `transfer_data.destination` set to the mentor's account, and writes an `orders` row in the
   `pending` state. The session's metadata carries the lesson id, the student id and the fee.
4. The student pays on Stripe's page and returns to `/assigned/<lesson>?purchased=1`.
5. Stripe calls `api/webhook.ts`. On a paid session the order moves to `paid` and an
   `entitlements` row is upserted. Until then the student has nothing, and an abandoned
   session simply stays `pending` and grants nothing.
6. The next request to `api/lesson-content.ts` finds the entitlement and sends the lesson.

The webhook can arrive a few seconds after the redirect. A student who returns before it has
landed sees the lesson locked and gets it on the next refresh.

## The fee

`platformFee(amount, bps)` in `src/lib/money.ts` is integer arithmetic start to finish, rounded
half-up to a whole minor unit and capped at the amount, so a fee can never exceed the sale. It
is computed once in `api/checkout.ts`, sent to Stripe as `application_fee_amount` and written
to the order, and the two cannot disagree because they are the same number.

`PLATFORM_FEE_BPS` is parsed by `feeBpsFromEnv`: a whole number from 0 to 10000, and anything
else is ignored in favour of the 20% default. The same module formats prices for display in the
interface language, with zero-decimal currencies handled as the exception they are.

## Payouts

Mentors are paid through Stripe Connect Express. Stripe collects the tax and identity details
and carries the KYC obligation; the platform never sees a bank number. It holds an account id
(`mentor_accounts.stripe_account_id`) and whether Stripe is willing to accept charges for it
(`charges_enabled`, `payouts_enabled`).

`charges_enabled` is Stripe's answer, cached. It is refreshed by `api/connect/status.ts` when a
mentor opens the payouts page, and by the `account.updated` webhook when Stripe changes it. It
gates selling: a priced lesson cannot be published, or repriced while published, without it
(`requireSellingMentor`), and a free lesson never reaches that check. Unpublishing is always
allowed, so a payout problem can never stop a mentor withdrawing a lesson.

There is no approval step before this. Anyone signed in may publish; the only thing gated is
taking money, and the gate is Stripe's own verification of the person behind the account.

## Refunds

A refund marks the order `refunded` and withdraws the entitlement again, so paid content does
not stay unlocked after the money has gone back. The handler acts on `charge.refunded`, which
Stripe sends for a partial refund as well as a full one, and it does not distinguish them: any
refund withdraws access.

## What is not handled

Chargebacks. As of this writing the webhook does not react to `charge.dispute.created` or
`charge.dispute.closed`, so a student who disputes a payment keeps their entitlement. Handling
for both is being added; see the [roadmap](../ROADMAP.md).

## Operating it

- [Stripe webhooks runbook](runbooks/stripe-webhooks.md): local testing, which events matter,
  and what to check when an entitlement is missing.
- [Deployment](deployment.md): the keys, and where to put them.
