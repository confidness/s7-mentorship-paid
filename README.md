# S7 Mentorship

[![CI](https://github.com/confidness/s7-mentorship-paid/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/confidness/s7-mentorship-paid/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-Checkout%20%2B%20Connect-635BFF?logo=stripe&logoColor=white)
![Languages](https://img.shields.io/badge/languages-en%20%7C%20ru%20%7C%20kk-informational)

A marketplace for mentoring. A mentor writes a lesson, prices it, and reads by hand what a
student hands in. Anyone may teach; only an account Stripe has verified may sell. The platform
runs identity, payment and access; it does not teach.

## Quickstart

```
nvm use      # Node 22, from .nvmrc
npm ci
cp .env.example .env.local
npm run dev
```

That is all of it. The example file leaves Supabase empty, and with no backend configured the
app runs fully local: accounts, progress and lessons live in the browser, and the AI mentor
answers from its built-in knowledge base. To connect Supabase and Stripe, fill in
`.env.local` and see [CONTRIBUTING](CONTRIBUTING.md) and [Deployment](docs/deployment.md).

### Checks

```
npm run typecheck types
npm run lint      ESLint; errors fail, warnings are a list to work down
npm run check     six test files, esbuild-bundled and run with bare node, then
                  scripts/check-api-imports.mjs
npm run build     production bundle
```

`test/flow.test.ts` drives register → submit → review → approve → XP → unlock against a course
fixture it builds itself, because a check that depends on product content breaks every time the
content changes. `test/mentor.test.ts` runs the real AI handler against a stubbed provider and
asserts what leaves and what comes back, without needing a key, including the daily limit.
`test/monetization.test.ts` covers the fee arithmetic, the paywall's own decision function and
the webhook's decision table for payments, refunds and disputes. `test/progress.test.ts`
asserts that progress syncs safely with no database, and `test/discovery.test.ts` and
`test/demand.test.ts` cover the offline course search and the demand board.
`scripts/check-api-imports.mjs` loads every function under `api/` the way Vercel does.

## Why the platform teaches nothing

The platform does not teach, and that is deliberate. It is the main thing to understand about
this repository. The codebase began as a robotics school with five courses and eighteen lessons written in code.
A marketplace that arrives already teaching something has picked a side — every mentor after
the first competes with the platform's own content, on the platform's own shelf — so the
curriculum was retired. `src/lib/curriculum.ts` is still there, typed and empty: the helpers
and the unlock order are the contract the rest of the app is written against, and reviving a
built-in track is a data change rather than a code change.
([Decision 0002](docs/decisions/0002-curriculum-retired.md).)

## First run

There are no seeded accounts, no sample students and no example lessons. The first person to
open it registers the first account.

| Role | How you get it |
| --- | --- |
| Student | Register with name, email and password. Nothing is assigned until a mentor assigns it. |
| Mentor | Register, then open **Settings → Teach on S7** and choose **Start teaching**. There is no application and no waiting. |

### Why there is no mentor PIN

There used to be one: an eight-digit code, checked server-side, that turned a registration into
a mentor account. A shared secret answers the wrong question. It tells you someone knows a
number that has been passed around a staff room for a year — not who they are, and not whether
they should be handling children's work or taking their families' money. It also cannot be
revoked for one person without changing it for everyone.

The first replacement was an application: legal name, a description of what you have taught,
and at least one document, approved or rejected by a named admin on the record. That was itself
retired, because vetting is the wrong shape for an open marketplace whose job is to carry other
people's courses. What stands now is publishing under your own name, a review loop students can
see, and one gate that is about money rather than merit: a paid lesson needs a connected Stripe
account with charges enabled, checked at publish time and again at purchase time. Identity is
still checked, just not by this platform — an Express account cannot take money until Stripe
has completed its own KYC on the person behind it. See
[decision 0001](docs/decisions/0001-application-over-mentor-pin.md) and
[decision 0003](docs/decisions/0003-open-teaching.md).

## Money

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
A client that could name its own amount would buy a forty-dollar lesson for one cent.

**The paywall is the server, not the UI.** `api/lesson-content.ts` refuses to send tasks or a
material URL without an entitlement row, and strips the quiz answer key from every student
copy. Editing `localStorage`, or calling the endpoint directly with a valid session, yields the
same 402. The lock icon in the interface is a courtesy; deleting it from the DOM reveals
nothing. `test/monetization.test.ts` asserts exactly this.

Webhook deliveries are idempotent. Stripe retries on purpose, and every event is decided
against the order's current status, so a redelivery changes nothing and a late payment notice
never reopens an order whose money has gone back. A full refund withdraws the entitlement
again, and so does a dispute while the bank decides; a partial refund does not. The rest — the
fee, payouts, the order of a purchase, and what is not automated — is in
[Payments](docs/payments.md).

## The loop

1. A mentor publishes a lesson: their own material as a PDF or Word file, plus up to ten tasks.
2. A student opens it from **Mentor assignments**, paying first if it is priced.
3. Multiple-choice questions mark themselves. Anything written by hand goes to the mentor.
4. The mentor reads it, scores the rubric and writes feedback.
5. **Approve** pays the XP and notifies the student. **Request changes** sends it back, and
   resubmitting does not re-pay what was already earned.

Both halves run through the server, so the mentor and the student need not share a browser:
projects since `0003`, and answers to mentor-written lessons since `0013`. The server marks the
multiple-choice questions against a key the student's copy never contains, and a lesson is paid
at most once. See [Architecture](docs/architecture.md#data-layer).

A lesson from a built-in track, if anyone adds one back, runs through four sections — theory,
code, task, challenge. There used to be two more, components and wiring, which assumed the
subject was electronics.

## What else is in it

**Mentor-authored lessons.** A PDF or Word file of material, and up to ten questions of three
kinds — multiple choice, write code, or a written answer. The mentor sets how many and what
each is worth. Multiple-choice questions mark themselves, so a lesson made only of them settles
the moment it is handed in and pays out on the spot.

**Groups.** A mentor's timetable: a named class with a room, a slot and a roster drawn from the
registered students. A student sits in one group at a time, so adding them to a second removes
them from the first. Deleting a group never removes its students.

**Competitions.** Nothing is seeded. A mentor announces an event from inside the app — name,
place, start and end time, and a running order of slots. Teams are created by the mentor and
filled from the registered students, one team per student per event. Points are only ever
earned: a team claims a task, submits it, and the mentor scores it. Un-scoring or deleting a
scored task hands the points back, so nothing on the leaderboard was typed in by hand.

**The demand board.** A student publishes what they want to learn, others vote, and a mentor
answers with a course that already has an audience.

**The AI mentor.** It helps a student choose a course from the real catalogue, and get unstuck.
It answers from a model when a key is configured and from a built-in knowledge base otherwise,
and each account has a daily allowance of questions that reach a model. See
[the AI mentor](docs/ai-mentor.md).

**Three languages.** Kazakh, Russian and English, switchable at any moment from the account
menu, or the corner of the front door and sign-in — nothing reloads and nothing is lost. Over a
thousand interface strings, each written three times. See [Languages](docs/i18n.md).

## Stack

React 18, TypeScript, Vite, Tailwind CSS v4, React Router, Motion, lucide-react,
`@paper-design/shaders-react`, Three.js for the default skin's world and one optional scene,
both loaded lazily after the first paint, and three backgrounds written in WebGL2 by hand. Vercel
functions for the server, Supabase for Auth, Postgres and Storage, Stripe for money. No state
library, no chart library, no syntax-highlighting library — the charts are hand-drawn SVG and
the editor is a textarea with a highlighted overlay.

## Documentation

- [Architecture](docs/architecture.md): the layout, the rules the code depends on, the data
  layer and the server routes.
- [Payments](docs/payments.md): prices, the fee, Checkout, Connect, entitlements and refunds.
- [The AI mentor](docs/ai-mentor.md): the two brains, the course advisor and the teaching rule.
- [Languages](docs/i18n.md): how a string is stored, and how to add one.
- [Design](docs/design.md): theme and skin, the orbit world, the menu bar, the backgrounds,
  the brutal look, motion and accessibility.
- [Deployment](docs/deployment.md): Vercel, environment variables, the database, the webhook.
- [Stripe webhooks runbook](docs/runbooks/stripe-webhooks.md)
- [Supabase migrations runbook](docs/runbooks/supabase-migrations.md)
- [Decision records](docs/decisions/): why there is no mentor PIN, why the platform teaches
  nothing, and why anyone may teach.
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), [Roadmap](ROADMAP.md) and
  [Changelog](CHANGELOG.md).
