# Security policy

This platform takes people's money and decides who may open what they paid for. A weakness in
it is worth reporting even when it looks small.

## Supported versions

Only `main`. There are no release branches and no backported fixes; a fix lands on `main` and
the deployment is redeployed from it.

## Reporting a vulnerability

Report it privately, as a GitHub security advisory:

<https://github.com/confidness/s7-mentorship-paid/security/advisories/new>

**Do not open a public issue for a vulnerability.** An issue is readable by everyone the moment
it is filed, including by whoever would use it. If you are unsure whether something counts,
report it privately anyway; it is easy to move a report into the open later and impossible to
take one back.

Include what you did, what you expected, what happened, and the commit or deployment you tried
it on. A request or a few lines of SQL that reproduce it are worth more than a description. Do
not include real keys or real student data; blank the values out.

## What is in scope

These are the places where a mistake costs someone money, access or privacy:

- **The Stripe webhook and checkout.** `api/webhook.ts` is the only thing that grants an
  entitlement, and `api/checkout.ts` must read the price from the database and never from the
  request. Anything that mints access without a payment, grants it twice, keeps it after a
  refund, or lets a client choose its own amount.
- **Supabase row level security and the service-role key.** A policy that lets one account
  read or write a row, or a column, that belongs to another. Any path by which the service
  role is reachable without the server deciding to use it.
- **Authentication.** Identifying a caller from anything other than a verified token, and
  acting as another account.
- **The paywall in `api/lesson-content.ts`.** Receiving tasks or a material link without an
  entitlement, or receiving the quiz answer key as a student.
- **Private Storage and signed links.** The buckets are private and are meant to stay so.
  Lesson material is reachable only through a signed link the server mints after checking
  entitlement. The `mentor-docs` bucket was created for identity documents by the retired
  application desk; it is private, admin-read only, and nothing should ever make it public.
- **Secrets reaching the client bundle.** Anything with a `VITE_` prefix is inlined into the
  JavaScript every visitor downloads. A secret that gains the prefix, or a build that carries
  a server-side value into `src/`, is a vulnerability.

## What is out of scope

- Findings that need a stolen device, a compromised account or a malicious browser extension.
- Missing rate limits on routes that spend nothing and write nothing.
- The offline mode. With no backend configured the app runs as a local demo, and it says so;
  its accounts are not a security boundary.
- Anything in a dependency that has no reachable path from this code. Report that upstream.

## What to expect

We will acknowledge a report within 3 business days. After that you will hear what was found
and what is going to be done about it. A confirmed issue is fixed on `main`.

There is no bounty. This is a small project and has nothing to pay one from.
