# Contributing

Anyone may. A fix to something that is plainly broken can go straight to a pull request.
Anything larger — a new screen, a change to how money or access works, a new table — should
start as an issue, so the shape is agreed before anyone writes it. A pull request that arrives
cold with a few hundred lines in it is hard to say yes to and harder to say no to.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). A security problem is not
an issue: report it privately, as described in [SECURITY](SECURITY.md).

Read the [README](README.md) first. It explains what the platform deliberately does not do —
it does not teach, and it has no mentor PIN — and why. A change that cuts against one of those
should start as an issue, not as a pull request.

## Running it locally

```
nvm use          # Node 22, from .nvmrc
npm ci
cp .env.example .env.local
npm run dev
```

The app runs fully local with no backend configured. Accounts, progress and lessons live in the
browser's `localStorage`, sign-in matches an email against local users and checks no password,
and the AI mentor answers from its built-in knowledge base. That is a demo, not a security
boundary. It is how most interface work is done.

The Supabase lines in `.env.example` are empty on purpose. The app counts a backend as
configured as soon as the URL and anon key are non-empty, so a placeholder there would send every
sign-in to a project that does not exist. Keep them empty for local mode, and do not paste
example values into them.

To work on anything behind the server — sign-in, payments, publishing, progress sync — you need
your own Supabase project and, for money, a Stripe account in test mode:

1. Fill `.env.local` from `.env.example`. Run `node scripts/check-env.mjs` to confirm the
   Supabase keys are in the right slots; it prints a verdict and a fingerprint, never a value.
2. Apply every file in `supabase/migrations/` in numeric order
   ([how](docs/runbooks/supabase-migrations.md)).
3. Serve the functions with the Vercel CLI (`vercel dev`), which is not a dependency here.
   `npm run dev` serves the interface only.
4. For the webhook, see [the Stripe runbook](docs/runbooks/stripe-webhooks.md).

Never commit `.env.local` or anything like it. `.gitignore` covers it, and the service-role key
in particular is a root password.

## Before you open a pull request

```
npm run typecheck
npm run lint
npm run check
npm run build
```

Continuous integration runs the same four, so a failure there is one you can reproduce.

`npm run check` bundles the test files with esbuild and runs each with bare node, then runs
`scripts/check-api-imports.mjs`, which loads every function under `api/` the way Vercel does.
The tests are hand-rolled: plain node, a `check(name, cond)` helper, no framework. The list of
files is spelled out in the `check` script in `package.json`, so a new test file has to be added
there or it is never run.

Then click through what you changed, in the browser, signed in. A type check does not tell you
that the page renders. If your change has text, look at it in more than one language.

## What the code depends on

These are the invariants the rest of the code is written against. A change that breaks one is a
defect even if every test passes.

- **Business rules live in `src/lib/logic.ts`, as pure functions `(state) => state`.** A
  component calls `store.tsx`, which calls `logic.ts`; it does not decide anything itself. A
  rule lives in exactly one place, and a second copy of it on the server is a finding.
- **Routes in `api/` run as the caller**, so row level security applies. The service role
  bypasses it, and a route that reaches for it needs a written reason beside the call. The reason
  is nearly always that it writes a row no user may write. Identify the caller from the verified
  token; never take a user id from the request body.
- **Stored text is a dictionary key plus values, never a sentence.** A notification, an XP
  reason or a goal is stored as a key and `TextVars`, so it reads in the reader's language
  rather than the writer's. See [Languages](docs/i18n.md).
- **Every interface string exists in English, Russian and Kazakh** in `src/i18n/ui.ts`. A
  literal user-facing string in a component is a defect.
- **Prices are integer minor units, and never come from the request.** `api/checkout.ts` reads
  the price from the database. Use `src/lib/money.ts` for the fee; do not do money arithmetic in
  floats.
- **The paywall is the server.** Hiding a lesson in the interface is a courtesy.
  `api/lesson-content.ts` decides whether the bytes are sent.
- **The XP ledger is the truth**; the `xp` columns are cached sums kept by trigger.
- **Nothing secret gets a `VITE_` prefix.** Everything with one is inlined into the JavaScript
  every visitor downloads, and so is everything under `src/`.
- **An `api/` file imports with its `.js` extension and exports named HTTP methods** when it
  runs on the Node runtime. See [Architecture](docs/architecture.md#runtime-notes).
  `npm run check` fails on both mistakes.

## Database changes

A change to the schema is a new numbered migration in `supabase/migrations/`. A migration that
has been applied is never edited: fix it with the next one. Start the file with a comment that
says what changes and why, enable row level security on any new table, and write the policies in
the same file. The full rules, and a line on each existing file, are in
[the migrations runbook](docs/runbooks/supabase-migrations.md).

A change to payment or access needs a test in `test/`. `test/monetization.test.ts` is the model:
it checks the decision functions the routes use, not the button.

## Commit messages

Look at `git log --oneline` before writing one. The subject is a plain-English imperative
sentence that says what changes in terms of what a person sees or can do, not which file moved:

```
Stop the dashboard white-screening when there is no course
Let a free assignment be handed in, and pay it from its own account
Give API imports their .js extension so Node functions load on Vercel
```

No type prefix, no scope in brackets. If the sentence needs an "and", that is fine, and if it
needs three, the commit is probably two.

The body, when there is one, says what was wrong, why it was wrong, and why the fix has the
shape it has. It wraps at about 90 columns. A commit that fixes a bug says which input
broke. A commit that decides between alternatives names the one it did not choose.

## Pull requests

One thing per pull request. The template asks what changed and why, how it was checked, and four
things that are easy to forget: no secrets in the diff, database changes as a new migration,
a test for payment and access changes, and strings in all three languages. Answer them honestly;
if something could not be checked, say so.
