# S7 Mentorship

A marketplace for mentoring. A verified mentor writes a lesson, prices it, and reviews by hand
what a student hands in. The platform runs identity, payment and access; it does not teach.

That last part is deliberate and it is the main thing to understand about this repository. The
codebase began as a robotics school with five courses and eighteen lessons written in code.
A marketplace that arrives already teaching something has picked a side — every mentor after
the first competes with the platform's own content, on the platform's own shelf — so the
curriculum was retired. `src/lib/curriculum.ts` is still there, typed and empty: the helpers
and the unlock order are the contract the rest of the app is written against, and reviving a
built-in track is a data change rather than a code change.

## First run

There are no seeded accounts, no sample students and no example lessons. The first person to
open it registers the first account.

| Role | How you get it |
| --- | --- |
| Student | Register with name, email and password. Nothing is assigned until a mentor assigns it. |
| Mentor | Register as a student, then apply at **Teach on S7**. A named reviewer checks your documents. |

### Why there is no mentor PIN

There used to be one: an eight-digit code, checked server-side, that turned a registration into
a mentor account. A shared secret answers the wrong question. It tells you someone knows a
number that has been passed around a staff room for a year — not who they are, and not whether
they should be handling children's work or taking their families' money. It also cannot be
revoked for one person without changing it for everyone.

What replaced it is an application: legal name, a description of what you have taught, and at
least one document. A named admin approves or rejects it, and the decision records who made it
and when.

| Stage | What it means |
| --- | --- |
| `none` | never applied — the authoring tools are not shown |
| `pending` | waiting for a reviewer; still a student in every respect |
| `approved` | may write and publish lessons |
| `rejected` | told why, and may apply again with it corrected |

Approval alone does not allow **selling**. A paid lesson also needs a connected Stripe account
with charges enabled, checked at publish time and again at purchase time — see *Money*.

Identity documents live in a private Supabase Storage bucket. They are never public, never
listed, and are shown to a reviewer only through signed links that expire in five minutes.

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

Webhook deliveries are idempotent, keyed on the Checkout Session id — Stripe retries on
purpose, and a redelivery must not grant a second entitlement or count the revenue twice.
A full refund withdraws the entitlement again.

A free lesson is open to anyone who can see it. That sounds obvious and was not: the row level
security policy required an entitlement to submit, entitlements exist only for something
somebody paid for, and so a lesson priced at zero could never be handed in at all.

## The loop

1. A mentor publishes a lesson: their own material as a PDF or Word file, plus up to ten tasks.
2. A student opens it from **Mentor assignments**, paying first if it is priced.
3. Multiple-choice questions mark themselves. Anything written by hand goes to the mentor.
4. The mentor reads it, scores the rubric and writes feedback.
5. **Approve** pays the XP and notifies the student. **Request changes** sends it back, and
   resubmitting does not re-pay what was already earned.

A lesson from a built-in track, if anyone adds one back, runs through four sections — theory,
code, task, challenge. There used to be two more, components and wiring, which assumed the
subject was electronics.

## Languages

Kazakh, Russian and English, switchable from the header at any moment — nothing reloads and
nothing is lost. 962 interface strings, each written three times.

Dates and numbers follow the interface language rather than the operating system. Chrome
resolves `kk-KZ` but ships no Kazakh month or weekday names, so those are assembled in
`i18n/index.tsx` instead of being handed to `Intl`.

Text the app generates and stores — notifications, XP history, a new student's goal — is kept
as a dictionary key plus the ids it refers to, never as a finished sentence. A notification
written in Kazakh therefore reads in Russian the moment the language changes, instead of being
frozen in whatever language was active when it was written.

## Mentor-authored lessons

A PDF or Word file of material, and up to ten questions of three kinds — multiple choice,
write code, or a written answer. The mentor sets how many and what each is worth.

Multiple-choice questions mark themselves, so a lesson made only of them settles the moment it
is handed in and pays out on the spot. Anything written by hand cannot be marked by a machine,
so it goes to the mentor and travels the same review loop projects do.

## Groups

A mentor's timetable: a named class with a room, a slot and a roster drawn from the registered
students. A student sits in one group at a time, so adding them to a second removes them from
the first. Deleting a group never removes its students.

## Competitions

Nothing is seeded. A mentor announces an event from inside the app — name, place, start and end
time, and a running order of slots. Announcing notifies every student once; editing afterwards
does not nag them again.

Teams are created by the mentor and filled from the registered students, one team per student
per event. Points are only ever earned: a team claims a task, submits it, and the mentor scores
it. Un-scoring or deleting a scored task hands the points back, so nothing on the leaderboard
was typed in by hand.

## The AI mentor

`askMentor(question, context)` in `src/lib/ai.ts` is the only thing the UI knows about, and it
has two brains behind it.

When a key is configured, `api/mentor.ts` answers — a serverless function calling OpenRouter or
Anthropic. **The key lives only in the server's environment.** There is deliberately no `VITE_`
prefix: anything carrying one is inlined into the client bundle and readable in devtools.

Without a key — or on a rate limit, a timeout, an outage, or a reply that will not parse — the
built-in knowledge base answers instead, with the same shape and the same teaching rule. Each
reply says which brain produced it.

Fifteen topics in three languages, and they are about learning rather than about any subject:
being stuck, a blank start, a review comment that did not land, work sent back, asking a
question that gets answered, a missed deadline, a broken streak, what belongs in a submission,
what a mentor is actually grading, using help honestly, choosing a mentor, access after paying,
and how to teach here.

The teaching rule is stated in the system prompt as a rule rather than a preference: hint,
explain, ask back, and refuse to hand over the finished work. Asked to do the assignment, it
says no and offers to take the problem apart instead — there are only three ways to be stuck,
and naming which one is usually most of the answer.

OpenRouter is asked for prose; Anthropic is asked for JSON. A small free model handed a strict
JSON contract explains JSON instead of following it, which is how a working key produced an
answer nobody saw. What comes back is cleaned rather than trusted: leaked instructions, schema
fragments and "Sure! Here is" openers are dropped.

## Design

Brutalist, on a liquid-metal field.

The background is `LiquidMetal` from Paper Design's own shader package, so the parameters come
straight from `shaders.paper.design` and no WebGL is written here. It freezes under
`prefers-reduced-motion` and when the tab is hidden — the reduced-motion rule in the stylesheet
reaches CSS animation and nothing driven from JavaScript, which is a gap worth knowing about.

The palette is read off that field rather than invented: the near-black at the centre of a
metaball, the cool slate of its shadow side, the white of the tint, and the molten red running
into signal yellow that the chromatic aberration throws along every edge. There is no green in
that image and none in the app.

Nothing pretends to be glass. No blur, no specular rim, no soft shadow. Depth is a hard offset,
corners are square, and colour is rationed: yellow for the one thing that matters on a screen,
red for what is destructive, and nothing else. Buttons are filled blocks that move into their
own shadow when pressed.

Light, dark, or follow the system — stored per browser and applied before first paint, so there
is no flash. Every colour is a token in `src/index.css`.

Motion is five primitives copied in from Motion Primitives, not a dependency on all thirty:
one entrance per screen on navigation, a stagger where a list is genuinely ordered, a
directional crossfade between a lesson's sections, and a counting XP total. No card fades up on
any grid. `LazyMotion` with only the DOM features, mounted `strict`, keeps the cost down and
makes a stray `motion.div` throw rather than quietly pull the whole library back in.

Student routes audit clean at WCAG AA in both themes, measured over about 1500 text nodes.

## Architecture

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
    ai.ts           the knowledge base and the one function the UI calls
    money.ts        integer minor units, the platform fee, locale-aware formatting
    api.ts          the typed client for everything under api/
    supabase.ts     lazy client; the app degrades to fully local when unconfigured
    store.tsx       React context: session, persistence, toasts. Thin — it calls logic.ts
  i18n/
    index.tsx       t(), LocaleProvider, locale-aware date and number formatting
    ui.ts           962 interface strings, each { en, ru, kk }
    content.ts      merges a translation pack over the English canonical
    ai.ru.ts        the knowledge base in Russian; ai.kk.ts is its Kazakh twin
  components/       design system (ui.tsx), layout chrome, motion primitives, the shader
  pages/            student/*, mentor/* and admin/* screens, one file per screen
api/                Vercel functions: checkout, webhook, lesson content, mentor, Connect
supabase/           the schema, its row level security policies and storage buckets
test/               three files, run by `npm run check` with esbuild and bare node
```

**Business logic never lives in a component.** Every state change goes through a pure function
in `logic.ts`, which is why the tests drive the whole progress chain with no React in sight.

### Data layer

Split along the line of what somebody gains by forging it.

**Local**, in one object persisted to `localStorage`: progress, XP, streaks, projects. Nobody
profits from faking their own streak.

**Server**, in Postgres with row level security: identity, mentor approval, lesson prices,
orders and entitlements. These decide who may teach and who may open paid content, and a value
the browser can edit is not a decision — it is a suggestion. `api/_lib/server.ts` holds two
Supabase clients and the difference between them is the security model: `userClient` acts as
the caller with RLS applied, `adminClient` bypasses RLS and is reserved for the Stripe webhook
and admin review.

One consequence worth knowing before a demo: local progress is per browser and does not follow
an account between devices. Moving it into Postgres is the next piece of work, and the mentor
review loop needs it — a mentor can currently only see projects submitted in their own browser.

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import it in Vercel. The framework preset is **Vite**; `vercel.json` already routes every
   path back to `index.html` so deep links work.
3. Add the environment variables (Production and Preview). The `VITE_` prefix is the line
   between public and secret: anything carrying it is inlined into the browser bundle, so a
   key that must stay secret must never have one.

   Public, and prefixed on purpose:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — safe in the browser; row level
     security is what decides what they can reach.
   - `VITE_STRIPE_PUBLISHABLE_KEY`.

   Secret, and never prefixed:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the service role
     bypasses row level security entirely. It is what lets the webhook write an entitlement
     no user may write. Treat it like a root password.
   - `STRIPE_SECRET_KEY` — creates Checkout Sessions and Connect accounts.
   - `STRIPE_WEBHOOK_SECRET` — without it the webhook cannot tell a real payment notice from
     an anonymous POST, so it refuses everything.
   - `PLATFORM_FEE_BPS` — optional; the platform's cut in basis points, default `2000` (20%).
   - `PUBLIC_SITE_URL` — where Stripe returns people after checkout and onboarding.
   - `OPENROUTER_API_KEY` — the key for the AI mentor. OpenRouter carries free models, so this
     works on an account with no balance; get one at openrouter.ai/keys.
   - `OPENROUTER_MODEL` — optional, and usually left empty. Blank means several free models are
     tried in order and the first that answers is used, which survives a free id going paid
     without notice. Setting it pins one model, tried alone and never substituted.
   - `ANTHROPIC_API_KEY` — an alternative to the above, used when no OpenRouter key is set.
   - `ANTHROPIC_WORKSPACE_ID` — only if that key was created at the organisation level rather
     than inside a workspace. Anthropic refuses such a key with a 400 until a workspace is
     named; **Send a test question** in Settings says so in as many words when it happens.
4. Create the database. Run `supabase/migrations/0001_monetization.sql` against the project —
   it creates eight tables, the row level security policies and two private Storage buckets.
   Grant yourself review rights with
   `update profiles set is_admin = true where id = '<your-user-id>';`, which is deliberately a
   database operation: nothing the client can post sets that flag.
5. Point a Stripe webhook at `https://<your-deployment>/api/webhook`, subscribed to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and
   `account.updated`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/webhook`.
6. Enable Stripe Connect (Express) so mentors can be paid.
7. Deploy. Build command `npm run build`, output `dist`.
8. Sign in as a mentor and open **Settings → Server features**. It reports, for each endpoint,
   whether it is deployed and whether its key is set — without ever revealing the value, and
   **Send a test question** spends one real request to tell a good key from a rejected one.

## Checks

```
npm run check     three files, esbuild-bundled and run with bare node
npx tsc --noEmit  types
npm run build     production bundle
```

`test/flow.test.ts` drives register → submit → review → approve → XP → unlock against a course
fixture it builds itself, because a check that depends on product content breaks every time the
content changes. `test/mentor.test.ts` runs the real AI handler against a stubbed provider and
asserts what leaves and what comes back, without needing a key. `test/monetization.test.ts`
covers the fee arithmetic and the paywall's own decision function.

## Stack

React 18, TypeScript, Vite, Tailwind CSS v4, React Router, Motion, lucide-react,
`@paper-design/shaders-react`. No state library, no chart library, no syntax-highlighting
library — the charts are hand-drawn SVG and the editor is a textarea with a highlighted
overlay. 294 kB gzipped, most of it the Supabase client.
