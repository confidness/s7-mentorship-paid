# Architecture

How the repository is laid out, where each kind of rule lives, and what is stored where. The
argument for the product is in the [README](../README.md); this page is the map.

## Layout

```
src/
  lib/
    types.ts        every entity: User, Course, Module, Lesson, Project, Feedback,
                    Achievement, XPTransaction, Group, Team, Competition, Notification,
                    CustomLesson, CustomTask, LessonSubmission
    curriculum.ts   empty and typed — see the note at the top of this file
    seed.ts         what a fresh install ships with: achievements, and nothing else
    logic.ts        ALL business rules as pure functions (state) => state
    selectors.ts    derived reads: progress, unlock chain, review queue, leaderboard
    gamification.ts levels, XP rules, achievement predicates
    codecheck.ts    static checker behind Lesson.checks
    discovery.ts    finding a course without a model: direction, price, length, format
    ai.ts           the knowledge base and the one function the UI calls
    money.ts        integer minor units, the platform fee, locale-aware formatting
    progress.ts     progress as operations: the diff, the replay, the merge
    outbox.ts       the queue of operations waiting to reach the server
    api.ts          the typed client for everything under api/
    supabase.ts     lazy client; the app degrades to fully local when unconfigured
    theme.ts        light or dark, and the skin
    store.tsx       React context: session, persistence, toasts. Thin — it calls logic.ts
  i18n/
    index.tsx       t(), LocaleProvider, locale-aware date and number formatting
    ui.ts           the interface strings, each { en, ru, kk }
    content.ts      merges a translation pack over the English canonical
    ai.ru.ts        the knowledge base in Russian; ai.kk.ts is its Kazakh twin
  components/       design system (ui.tsx), layout chrome, motion primitives, the shader
  pages/            student/* and mentor/* screens, one file per screen, plus Login
api/                Vercel functions: checkout, webhook, lesson content, lessons, mentor,
                    progress, projects, requests, notifications, Connect
supabase/           numbered migrations: the schema, row level security and storage buckets
test/               six files, run by `npm run check` with esbuild and bare node
scripts/            check-api-imports.mjs (part of `npm run check`) and check-env.mjs
```

There is no `admin` directory under `src/pages`. `profiles.is_admin` exists and row level
security reads it, but nothing in the interface is built on it; it is set by a database
operation and by nothing a client can post.

## The rules that hold the rest up

**Business logic never lives in a component.** Every state change goes through a pure function
in `logic.ts`, which is why the tests drive the whole progress chain with no React in sight.
A rule lives in exactly one place. A second copy of a rule on the server is the thing most
likely to drift, so `api/progress.ts` upserts and expresses no rules of its own.

**Routes run as the caller.** `api/_lib/server.ts` holds two Supabase clients and the
difference between them is the security model: `userClient` acts as the caller with RLS
applied, `adminClient` bypasses RLS. Reach for the first by default. A route that reaches for
the service role needs a reason written next to it, and the reason is always the same shape:
it writes a row no user may write.

**Stored text is a dictionary key, not a sentence.** Notifications, XP history and a new
student's goal are kept as a key plus the ids they refer to (`TextVars`), so they render in the
reader's language at the time of reading. See [i18n](i18n.md).

**Money is integer minor units, and the price is never from the request.** See
[payments](payments.md).

**The paywall is the server.** The interface may hide a lesson; only `api/lesson-content.ts`
decides whether the bytes are sent.

**The XP ledger is the truth.** The `xp` columns are cached sums maintained by trigger.

## Data layer

Split along the line of what somebody gains by forging it.

**Local**, in one object persisted to `localStorage`: progress, XP, streaks. Nobody profits
from faking their own streak. The storage key is still `s7-robotics-platform.v1`, deliberately:
it is a key, not a label, and renaming it would orphan every browser's saved state.

**Server**, in Postgres with row level security: identity, lesson prices, orders and
entitlements. These decide who may open paid content, and a value the browser can edit is not a
decision — it is a suggestion. The service role is reserved for the places where the server
must write rows no user is allowed to write — the Stripe webhook above all.

Progress is on the server as well as in the browser. `supabase/migrations/0002_progress.sql`
adds three tables and the client is wired to them: a mutation is diffed into operations,
queued, and flushed to `api/progress.ts`, which upserts and expresses no rules of its own.
Without a backend the app keeps working exactly as before, because an unconfigured backend is
the same code path as being offline.

Operations rather than a snapshot, because a snapshot lets a stale tab overwrite a fresh one.
Every one is a grow-only insert or a monotonic write, so replaying a queue is free and two
devices converge whichever order they merge in — `test/progress.test.ts` asserts both, with
no database. The streak is the single exception, being the only field that goes down, so an
older operation is ignored rather than allowed to walk it back.

The outbox is the only impure part, and two failure modes shaped it. An unbounded queue is a
silent failure, so it is capped and the oldest operation is dropped first. A poisoned queue is
worse than a lost operation: one operation the server will refuse forever would block every
one behind it, so an attempt counter drops it after five, counting only 4xx responses. A
transport failure spends no attempt.

Projects and their reviews are on the server too, from `0003_projects.sql`. A project is a
document two people take turns writing to, so it is not synced as operations: `api/projects.ts`
separates POST (the student writes the body of the work) from PATCH (a mentor claims it or
decides on it, and PATCH writes `status`, `reviewer_id` and `reviewed_at` and nothing else).
Postgres policies apply to a row and not to a column, which is why the mentor's update right
was removed entirely in `0005` and the decision is written with the service role. Feedback is
append-only for everyone. Notifications that cross from one account to another are in
`notifications` (`0004`), written by the routes that cause them and read by `api/notifications.ts`.

**Still local:** the answers a student hands in to a mentor-written lesson and the mentor's
review of them (the `lesson_submissions` table exists from `0001` and no route reads or writes
it), groups, competitions and teams, and the notifications a reducer writes for its own user.
Until the first of those moves, a mentor reviewing a lesson hand-in can only see what was
submitted in the browser they are reviewing in.

## Server routes

| Route | Runtime | Acts as | What it does |
| --- | --- | --- | --- |
| `api/checkout.ts` | Node | service role | Creates a Stripe Checkout Session and a pending order. Price from the database. |
| `api/webhook.ts` | Node | service role | Verifies Stripe's signature, grants and withdraws entitlements, syncs Connect accounts. |
| `api/lesson-content.ts` | Node | service role | The paywall. Sends tasks and a material link only to someone entitled. |
| `api/lessons.ts` | Node | service role | The catalogue, and authoring: save, publish, delete. Checks Stripe before a priced publish. |
| `api/connect/onboard.ts` | Node | service role | Creates an Express account and returns an onboarding link. |
| `api/connect/status.ts` | Node | service role | Asks Stripe whether the account may take charges, and caches the answer. |
| `api/progress.ts` | Node | caller | Reads a snapshot, applies a batch of operations. |
| `api/projects.ts` | Node | caller; service role for a mentor's decision | Projects and their reviews. |
| `api/requests.ts` | Node | caller; service role to withdraw or answer | The demand board. |
| `api/notifications.ts` | Node | caller | The inbox: list, mark read. |
| `api/mentor.ts` | Edge | none (identifies the caller, then calls a model) | The AI mentor. See [ai-mentor](ai-mentor.md). |
| `api/payments-health.ts` | Edge | none | Says whether the Stripe keys are present, never what they are. |

The service role is used by the routes in the top half of that table because they write rows
that no browser may write, or read rows that no student may read (`custom_tasks` carries the
answer key). Each one identifies the caller from a verified token first and takes the user id
from it, never from the request body.

## Runtime notes

`package.json` is `"type": "module"` and Vercel compiles each Node function on its own, so two
rules apply to everything under `api/`:

- A relative import needs its `.js` extension. Vite and esbuild resolve `./_lib/server` happily,
  so the build and the tests pass while the function fails on Vercel with `ERR_MODULE_NOT_FOUND`.
- A Node function must export named HTTP methods (`GET`, `POST`, ...). A default export is
  called as `(req, res)` and the returned `Response` is dropped, so the request hangs until it
  times out.

`scripts/check-api-imports.mjs` loads each function the way Vercel does and fails on either
mistake. It is the last step of `npm run check`. Edge functions (`mentor`, `payments-health`)
are bundled, which is why they were not affected by the first rule.
