# 0003. Anyone may teach; money still has a gate

## Status

Accepted on 2026-09-27. Supersedes the reviewed application in
[0001](0001-application-over-mentor-pin.md); the PIN stays gone.

## Context

The application desk was built for a robotics academy, where a named adult with documents was
approved by a reviewer before handling children's work. That was a real answer to a real
question, and the wrong shape for an open marketplace, where the platform's job is to carry
other people's courses, not to vet them first.

Removing the desk had a second cost, found afterwards. `api/connect/onboard.ts` required an
approved application before it would create a Connect account, and nothing wrote such a row
once the desk was gone, so no mentor could ever have `charges_enabled`, and every paid publish
was refused. The gate outlived the thing it was gating and quietly closed the whole
marketplace, which is why the check was removed rather than left to be satisfied.

## Decision

Drop the application desk. Anyone signed in may switch teaching on (**Settings → Teach on S7 →
Start teaching**) and publish under their own name. What replaces vetting is what every open
marketplace actually relies on: a name on the lesson, a review loop students can see, and
public numbers the author cannot write (see `0009_reputation.sql`).

Money keeps a gate, and it is a fact about money rather than a judgement about a person: a
priced lesson needs a connected Stripe account with charges enabled, checked at publish time
and at purchase time. Identity is still checked, just not by this platform: an Express account
cannot take money until Stripe has completed its own KYC on the person behind it.

`profiles.role` may now be set by its owner, to `student` or `mentor`. `is_admin` stays pinned.
Admin decides who is admin; anyone decides whether they teach.

## Consequences

- `is_mentor()` is a capability, not authority. It says a person writes and publishes courses;
  it grants nothing over anybody else's row. Two policies written as if it did had to go
  (`0007`, `0010`): browser-written notifications, which made the inbox an open relay, and
  browser-written review feedback.
- Anything that acts on another person's behalf runs in `api/` with the service role, after
  identifying the caller from a verified token and checking the relationship itself.
  `published`, `price_cents` and `currency` are not browser-writable; `api/lessons.ts` writes
  them after checking Stripe.
- `mentor_applications` and the `mentor-docs` bucket remain, unread. Nothing deletes history to
  tidy up an interface. Some interface strings and a knowledge-base answer still describe the
  application; they are leftovers, not behaviour.
