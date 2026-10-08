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

Webhook deliveries are idempotent — Stripe retries on purpose, and a redelivery must not grant a
second entitlement or count the revenue twice. Orders are keyed on the Checkout Session id, and
every event is decided against the order's current status; see [Orders](#orders-and-their-statuses).

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

## Orders and their statuses

An order is one purchase, and its status is what the webhook decides against.

| Status | Meaning | Access |
| --- | --- | --- |
| `pending` | Checkout started, no payment notice yet. An abandoned session stays here. | none |
| `paid` | Stripe confirmed the money. | granted |
| `failed` | An asynchronous payment failed, or the session expired unpaid. A later notice that the session is paid still moves it to `paid`. | none |
| `refunded` | The charge was refunded in full. | withdrawn |
| `disputed` | The student's bank is contesting the payment and has not decided. | withdrawn until it decides |
| `charged_back` | The dispute was lost. | stays shut |

Every event is decided by an exported pure function, `settle(currentStatus, notice, ageSeconds)`,
against the order's current status, and the status write is conditional on that status still
holding. Two things follow. A redelivery changes nothing, because the order is already where the
event would put it. And a payment notice never reopens an order whose money has gone back: a
late `checkout.session.completed` that arrives after a refund does not re-grant the lesson.

A dispute that is won returns the order to `paid` and re-grants access. So does an inquiry that
closes with `warning_closed`. A dispute that is lost leaves the order `charged_back`.

A refund or a dispute can reach the webhook before the payment notice for the same order. The
webhook answers 409 so that Stripe retries, by which time the payment notice has usually landed.
Once the event is three days old, which is the end of Stripe's live retry window, it is
acknowledged with a warning instead, so the retries stop.

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

A full refund marks the order `refunded` and withdraws the entitlement again, so paid content
does not stay unlocked after the money has gone back. `charge.refunded` fires for a partial
refund as well, and the webhook tells them apart by the charge's `refunded` flag: only a full
refund withdraws access, and a partial refund changes nothing.

Refunds are issued from the Stripe dashboard, not from this application. The dashboard is where
you choose, per refund, whether to reverse the transfer to the mentor.

## Disputes

`charge.dispute.created` moves the order to `disputed` and withdraws access until the bank
decides. `charge.dispute.closed` settles it: won, or an inquiry closed with `warning_closed`,
returns the order to `paid` and re-grants access; lost leaves it `charged_back`, which stays
shut. The mechanics, and the 409 for an event that beats its payment notice, are under
[Orders](#orders-and-their-statuses).

## What is not automated

**Transfer reversals.** The sale is a destination charge: the mentor's share is transferred
when the student pays. When a dispute is lost, the platform bears the whole sale plus the dispute
fee, because the transfer to the mentor is not taken back automatically. If policy says the
mentor should bear it, an operator reverses the transfer from the Stripe dashboard. The same
applies to a refund, where reversing the transfer is a choice made on the refund itself.

## Operating it

- [Stripe webhooks runbook](runbooks/stripe-webhooks.md): local testing, which events matter,
  and what to check when an entitlement is missing.
- [Deployment](deployment.md): the keys, and where to put them.
