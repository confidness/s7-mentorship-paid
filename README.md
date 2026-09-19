# S7 Mentorship (Paid)

One system for teaching robotics: courses, interactive lessons, project submission, mentor
review, progress, gamification, an AI mentor and competitions — with verified mentors who
sell their own lessons.

Built on top of the [S7 Robotics Platform](https://github.com/confidness/s7-robotics-platform)
curriculum and interface. Two things are different here, and they are what this repository is
for:

**Mentors are verified, not admitted by a shared secret.** The original gated mentor accounts
behind an 8-digit PIN. A PIN tells you someone knows a number that has been passed around a
staff room; it cannot be revoked for one person, and it says nothing about who is at the
keyboard. It is replaced by an application — legal name, teaching background and documents —
that a named admin approves or rejects on the record.

**Lessons can be sold.** Mentors set a price, students buy through Stripe, and the platform
takes a percentage. Entitlements are written only by the Stripe webhook and checked on every
request for content, so a purchase means something a browser cannot fake.

Both of these needed a server. Identity, approval, prices and entitlements live in Postgres
behind row level security; progress, XP and streaks stay in the browser, because nobody gains
by forging their own streak. See *Data layer* below.

## First run

The platform ships with curriculum, not with people. There are no seeded accounts, no sample
students and no fake projects — the first person to open it registers the first account.

| Role | How you get it |
| --- | --- |
| Student | Register with name, email and password. You start on Arduino lesson one. |
| Mentor | Register as a student, then apply at **Teach on S7**. A reviewer checks your documents. |

### Why there is no mentor PIN any more

There used to be one: an 8-digit code, checked server-side, that turned a registration into a
mentor account. It was removed, because a shared secret answers the wrong question. It tells
you someone knows a number that has been passed around a staff room for a year — not who they
are, and not whether they should be handling children's work or taking their families' money.
It also cannot be revoked for one person without changing it for everyone.

What replaced it is an application. Someone signs up as a student, submits their legal name, a
description of their teaching and at least one document, and a named admin approves or rejects
it. The decision records who made it and when, and can be reversed later.

| Stage | What it means |
| --- | --- |
| `none` | never applied — the authoring tools are not shown |
| `pending` | waiting for a reviewer; still a student in every respect |
| `approved` | may write and publish lessons |
| `rejected` | told why, and may apply again with it corrected |

Approval alone does not allow **selling**. A paid lesson also needs a connected Stripe account
with charges enabled, checked at publish time and again at purchase time — see *Money* below.

Identity documents live in a private Supabase Storage bucket. They are never public, never
listed, and are shown to a reviewer only through signed links that expire in five minutes.

Passwords are no longer stored in the browser. Supabase Auth holds credentials; the old build
kept them in cleartext in `localStorage`, and any state left over from it is cleared on first
load rather than left sitting there.

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
A client that could name its own amount would buy a 40-dollar lesson for one cent.

**The paywall is the server, not the UI.** `api/lesson-content.ts` refuses to send tasks or a
material URL without an entitlement row, and strips the quiz answer key from every student
copy. Editing `localStorage`, or calling the endpoint directly with a valid session, yields the
same 402. The lock icon in the interface is a courtesy; deleting it from the DOM reveals
nothing. `test/monetization.test.ts` asserts exactly this.

Webhook deliveries are idempotent, keyed on the Checkout Session id — Stripe retries on
purpose, and a redelivery must not grant a second entitlement or count the revenue twice.
A refund withdraws the entitlement again.

## The loop

1. **Dashboard** → *Continue lesson*.
2. Work through **Theory → Components → Wiring → Code → Task → Challenge**.
   In *Code*, **Run auto code check** grades the sketch against the lesson's rules; **Example**
   loads the worked version. Lessons with an ultrasonic sensor also get a *Virtual Lab*.
3. **Submit project** — the form opens with whatever is in the editor.
4. A mentor opens it from **Reviews**, which claims it (*Under review*), scores the rubric and
   writes feedback.
5. **Approve** pays the task XP plus a bonus, completes the lesson, unlocks the next one and
   notifies the student. **Request changes** sends it back instead.

## Languages

Kazakh, Russian and English, switchable from the header at any moment — nothing reloads and
nothing is lost. Both the interface and the curriculum translate: lesson theory, components,
wiring notes, tasks, challenges, achievements, the competition season and the AI mentor's
answers. Code listings stay in English, because Arduino and Python are written in English.

Dates and numbers follow the interface language rather than the operating system. Chrome
resolves `kk-KZ` but ships no Kazakh month or weekday names, so those are assembled in
`i18n/index.tsx` instead of being handed to `Intl`.

Text the app generates and stores — notifications, XP history, a new student's goal — is kept
as a dictionary key plus the ids it refers to, never as a finished sentence. A notification
written in Kazakh therefore reads in Russian the moment the language changes, instead of being
frozen in whatever language was active when it was written.

## Mentor-authored lessons

Beside the curriculum that ships in the code, a mentor can write their own: a PDF or Word file
of material, and up to ten questions of three kinds — multiple choice, write code, or a written
answer. The mentor sets how many and what each is worth.

These live beside the shipped courses rather than inside them, so one mentor's material never
renumbers another's course or disturbs the unlock chain. Students find them under **Mentor
assignments**.

Multiple-choice questions mark themselves, so a lesson made only of them settles the moment it
is handed in and pays out on the spot. Anything written by hand cannot be marked by a machine,
so it goes to the mentor and travels the same review loop projects do.

## Talking to a real board

The lesson's Code tab carries a serial terminal that opens a USB port straight from the page —
no driver, no install. What it buys depends on the board:

| | Monitor | Run code from the page |
| --- | --- | --- |
| Arduino (C++) | yes | no — C++ has to be compiled, so uploading stays in the Arduino IDE |
| ESP32 / Pico (MicroPython) | yes | yes — the firmware exposes a REPL on the same port |

Web Serial is Chrome and Edge on desktop only, over HTTPS or localhost, and the port is always
chosen by the person in the browser's own dialog. Where it is missing the terminal says so and
the rest of the lesson, including the Virtual Lab, works untouched.

## Groups

A mentor's timetable: a named class with a room, a slot, a course and a roster drawn from the
registered students. A student sits in one group at a time, so adding them to a second removes
them from the first. Deleting a group never removes its students — they stay in the academy,
just ungrouped, and the mentor's roster still shows everyone.

## Competitions

Nothing is seeded. A mentor announces an event from inside the app — name, place, start and end
date and time, and a running order of slots each with its own day and clock time. Announcing
notifies every student once; editing afterwards does not nag them again.

Teams are created by the mentor and filled from the registered students, one team per student
per event. Points are only ever earned: a team claims a task, submits it, and the mentor scores
it. Un-scoring or deleting a scored task hands the points back, so a mistake is reversible and
nothing on the leaderboard was typed in by hand.

## Themes

The material is matte: panels are a near-uniform fill over a heavily blurred backdrop, with no
specular rim, no white inset lip and only a touch of added saturation. What reads as gloss is a
falling gradient plus a bright top edge, and neither is there.

Light, dark, or follow the system — the switch sits in the header (and in the account menu on
phones). The choice is stored per browser and applied before first paint, so there is no flash.
Every colour is a token in `src/index.css`: `[data-theme='dark']` swaps the ink ramp, thins the
glass and retints the pale surfaces. Components never hardcode a literal white.

The palette is white, the logo's blue and a deep green: `brand` is the blue ramp built around
the mark's own `#1560ec`, `accent` is the green that ends every gradient, and the five courses
sit at five points along the run between them. Amber, rose and emerald survive only as status —
a warning has to look like a warning — and never as decoration.

## Architecture

```
src/
  lib/
    types.ts        every entity: User, Course, Module, Lesson, Project, Feedback,
                    Achievement, XPTransaction, Group, Team, Competition, Notification,
                    CustomLesson, CustomTask, LessonSubmission
    curriculum.ts   5 courses, 12 modules, 18 lessons, hardware platform registry
    seed.ts         the content a fresh install ships with — courses and the season, no people
    logic.ts        ALL business rules as pure functions (state) => state
    selectors.ts    derived reads: progress, unlock chain, review queue, leaderboard
    gamification.ts levels, XP rules, achievement predicates
    codecheck.ts    static Arduino/Python checker behind Lesson.checks
    ai.ts           AI mentor reply layer — one function to swap for a real model
    theme.ts        light / dark / system, persisted per browser
    store.tsx       React context: session, persistence, toasts. Thin — it calls logic.ts
  i18n/
    index.tsx       t(), LocaleProvider, locale-aware date and number formatting
    ui.ts           ~650 interface strings, each { en, ru, kk }
    content.ts      merges a translation pack over the English canonical curriculum
    content.ru.ts   courses, modules, parts, wiring terminals, competitions
    content.kk.ts   the same, in Kazakh
    lessons.ru.ts   all 18 lessons — theory, components, wiring, task, challenge
    lessons.kk.ts   the same, in Kazakh
    ai.ru.ts        AI mentor answers; ai.kk.ts is its Kazakh twin
  components/       design system (ui.tsx), layout chrome, code editor, lesson parts, cards
    Mark.tsx        the S7 mark, drawn as two arcs so it stays crisp at 20px
  pages/            student/* and mentor/* screens, one file per screen
```

English lives in `lib/curriculum.ts` and stays the source of truth: ids, order, code samples
and check rules never move. A pack only replaces the words a learner reads, so adding a
language is one more file per pack and a row in `LOCALES` — no screen changes.

**Business logic never lives in a component.** Every state change goes through a pure function
in `logic.ts`, so the progress chain is one readable path:

```
lesson task → project submitted → mentor approves
  → XP awarded → lesson completed → next lesson unlocked → notification → achievements re-evaluated
```

### Data layer

Split deliberately, along the line of what someone gains by forging it.

**Local**, in one object persisted to `localStorage`: progress, XP, streaks, projects and the
curriculum itself, with course content always re-read from code so editing it never strands a
returning user. Nobody profits from faking their own streak, so this stays where it was.

**Server**, in Postgres with row level security: identity, mentor approval, lesson prices,
orders and entitlements. These decide who may teach and who may open paid content, and a value
the browser can edit is not a decision — it is a suggestion. `api/_lib/server.ts` holds the two
Supabase clients, and the difference between them is the security model: `userClient` acts as
the caller with RLS applied, `adminClient` bypasses RLS and is reserved for the Stripe webhook
and admin review.

One consequence worth knowing before a demo: local progress is still per browser, and it does
not follow an account between devices. Credentials, though, are Supabase Auth's — the browser
no longer holds a password at all, and state left by the build that did is cleared on load.

### Hardware platforms

`PLATFORMS` in `curriculum.ts` carries Arduino, ESP32, Raspberry Pi Pico, LEGO WeDo 2.0,
LEGO SPIKE Prime and plain Python. Adding one is a row in that array plus a `PlatformId`
member; catalog filters, gallery filters and course cards pick it up with no further changes.

### AI mentor

`askMentor(question, context)` in `ai.ts` is the only thing the UI knows about, and it has two
brains behind it.

When `ANTHROPIC_API_KEY` is set, `api/mentor.ts` answers — a Vercel function calling Claude
Haiku 4.5. **The key lives only in the server's environment.** There is deliberately no `VITE_`
prefix: anything with one is inlined into the client bundle and readable in devtools, which is
exactly what must not happen to an API key. The browser sends a question and receives an answer;
it never sees a credential.

Without a key — or on a rate limit, a timeout, an outage, or a reply that will not parse — the
built-in knowledge base answers instead, with the same shape and the same teaching rule. The
student never sees an error where a hint belongs, and each reply says which brain produced it.

The teaching rule is the point, and it is stated in the system prompt as a rule rather than a
preference: hint, explain, ask back, and refuse to hand over the finished project. A fragment
that demonstrates a technique is fine; a working version of the assignment is not.

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import it in Vercel. The framework preset is **Vite**; `vercel.json` already routes every
   path back to `index.html` so deep links like `/learn/arduino/ar-l4` work.
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
   it creates the tables, the row level security policies and the two private Storage buckets.
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
   whether it is deployed and whether its key is set — without ever revealing the value. Both
   variables are read at request time, but a redeploy is still needed for a newly added one.

## Stack

React 18, TypeScript, Vite, Tailwind CSS v4, React Router, lucide-react. No state library, no
chart library, no syntax-highlighting library — the charts are hand-drawn SVG and the editor is
a textarea with a highlighted overlay, which keeps the bundle around 150 kB gzipped.
