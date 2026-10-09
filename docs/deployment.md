# Deploying to Vercel

The app is a static Vite build plus Vercel functions, with Supabase for the database and Stripe
for money. Nothing is needed to run it locally (see the README's Quickstart); everything below
is for a deployment that takes real accounts and real payments.

1. Push the repository to GitHub.
2. Import it in Vercel. The framework preset is **Vite**; `vercel.json` already routes every
   path back to `index.html` so deep links work, and leaves `/api/` alone.
3. Add the environment variables (Production and Preview). The `VITE_` prefix is the line
   between public and secret: anything carrying it is inlined into the browser bundle, so a
   key that must stay secret must never have one.

   Public, and prefixed on purpose:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — safe in the browser; row level
     security is what decides what they can reach.
   - `VITE_STRIPE_PUBLISHABLE_KEY` — optional, and not read by anything today. Checkout is a
     redirect to a URL the server creates, so the browser never needs the publishable key.
     `.env.example` lists it for a future embedded form; leaving it unset changes nothing.

   Secret, and never prefixed:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the service role
     bypasses row level security entirely. It is what lets the webhook write an entitlement
     no user may write. Treat it like a root password.
   - `STRIPE_SECRET_KEY` — creates Checkout Sessions and Connect accounts.
   - `STRIPE_WEBHOOK_SECRET` — without it the webhook cannot tell a real payment notice from
     an anonymous POST, so it refuses everything.
   - `PLATFORM_FEE_BPS` — optional; the platform's cut in basis points, default `2000` (20%).
     A value outside 0 to 10000 is ignored and the default applies.
   - `PUBLIC_SITE_URL` — where Stripe returns people after checkout and onboarding. It falls
     back to the request's own origin, which is usually right; set it when running behind a
     proxy.
   - `OPENROUTER_API_KEY` — the key for the AI mentor. OpenRouter carries free models, so this
     works on an account with no balance; get one at openrouter.ai/keys.
   - `OPENROUTER_MODEL` — optional, and usually left empty. Blank means several free models are
     tried in order and the first that answers is used, which survives a free id going paid
     without notice. Setting it pins one model, tried alone and never substituted.
   - `ANTHROPIC_API_KEY` — an alternative to the above, used when no OpenRouter key is set.
   - `AI_DAILY_LIMIT` — optional; how many questions one signed-in account may put to the model
     per UTC day, default `40`. Registration is open, so without a cap any account can loop and
     run up the provider bill. A whole number from 1 to 100000; blank, zero, negative or
     anything else is ignored and the default applies. `GET /api/mentor` reports the limit in
     force. To switch the model off, remove the keys; a limit of zero is not how. The counter
     needs `0012_ai_usage.sql` applied; see [the AI mentor](ai-mentor.md#a-daily-allowance).
   - `ANTHROPIC_WORKSPACE_ID` — only if that key was created at the organisation level rather
     than inside a workspace. Anthropic refuses such a key with a 400 until a workspace is
     named; **Send a test question** in Settings says so in as many words when it happens.
4. Create the database. Apply every file in `supabase/migrations/` against the project, in
   numeric order, starting at `0001_monetization.sql` — most simply as one script:
   `npm run db:bundle > all-migrations.sql`, pasted into Supabase → SQL Editor and run. The later files change the policies the
   earlier ones created, so a deployment built from `0001` alone is not the one the code is
   written against. See the [migrations runbook](runbooks/supabase-migrations.md) for how, and
   for what each file does.

   Three of them change what the running code does if they are missing. Without
   `0011_disputes.sql` the order statuses a dispute needs do not exist, so a dispute event
   fails and Stripe retries it. Without `0012_ai_usage.sql` the AI mentor's daily limit does
   not exist: the route warns once in its log and answers without a cap. Without
   `0013_lesson_submissions.sql` sending a hand-in back for changes fails, because the status
   does not exist, and the browser keeps write rights on hand-ins and assignment XP that only
   the route should have.

   Optionally, mark yourself an admin with
   `update profiles set is_admin = true where id = '<your-user-id>';`, which is deliberately a
   database operation: nothing the client can post sets that flag. An admin can read every
   order, entitlement and lesson through row level security. There is no admin screen.
5. Point a Stripe webhook at `https://<your-deployment>/api/webhook`, subscribed to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.closed` and `account.updated`. Without the two
   dispute events a chargeback returns the money to the student's bank and leaves them the
   lesson. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/webhook`, with the functions served
   by `vercel dev`. See the [webhook runbook](runbooks/stripe-webhooks.md).
6. Enable Stripe Connect (Express) so mentors can be paid.
7. Deploy. Build command `npm run build`, output `dist`.
8. Sign in as a mentor and open **Settings → Server features**. It reports, for each endpoint,
   whether it is deployed and whether its key is set — without ever revealing the value, and
   **Send a test question** spends one real request to tell a good key from a rejected one.
9. Point an uptime monitor at `https://<your-deployment>/api/health`. It answers 200 with
   `db: 'ok'` when the database answers, 503 with `db: 'down'` when it does not, and 200 with
   `db: 'unconfigured'` when no Supabase keys are set — so a monitor should check the body as
   well as the status. `?payments=1` on the same URL checks Stripe configuration, not uptime.
10. Once the production domain is known, make `og:image` in `index.html` an absolute URL
    (`https://<your-domain>/og.png`). Most link previews ignore a relative one.

## Security headers

`vercel.json` sends `nosniff`, a strict referrer policy, `X-Frame-Options: DENY`, a
permissions policy that switches off the camera, microphone, location, payment and USB, and
HSTS for two years without `preload`. The content security policy ships as
`Content-Security-Policy-Report-Only`: it reports in the browser console and blocks nothing.
Walk the app with the console open — sign-in, a lesson with material, checkout, the shader and
3D skins, realtime notifications — and when it is quiet, rename the header to
`Content-Security-Policy`. Vercel preview deployments inject their toolbar from `vercel.live`
and will report it; a custom Supabase domain must be added to `connect-src` and `img-src`.

The one inline script, in `index.html`, is allowed by its hash. `vite.config.ts` fails the
build if that script changes and the hash in `vercel.json` does not, and prints the new one.

## Checking the keys before you deploy

`node scripts/check-env.mjs` reads `.env.local` and says whether the Supabase keys are in the
right slots. Supabase hands you two keys that look identical, and one of them bypasses row level
security. A key states its own role, so placement can be verified while seeing nothing worth
hiding: the script prints a verdict, the role and an eight-character fingerprint, never a
value, and it shouts first if the service-role key is anywhere the browser would be given it.

## Sign-up and email confirmation

Both settings of Supabase's email confirmation work. With it off, registering signs the person
in. With it on, registering succeeds, the person is told to confirm their email and then sign
in, and the interface does not pretend they are signed in before they are.

With it on, two settings decide whether the email works at all. Supabase → Authentication → URL
Configuration:

- **Site URL**: the production address, e.g. `https://s7-mentorship-paid.vercel.app`. A new
  project sets it to `http://localhost:3000`, and any link Supabase cannot otherwise place goes
  there — to a page that does not exist.
- **Redirect URLs**: add `https://<your-domain>/**` (and a preview pattern such as
  `https://*-<your-team>.vercel.app/**` if you test on previews). Sign-up asks for the link to
  return to `/login` on the site it was made on; Supabase only honours that if the address is
  listed here, and otherwise falls back to the Site URL.

Supabase's built-in mail sender is for testing: it sends a handful of emails an hour and they
often land in spam. For real users, set your own SMTP under Authentication → Emails, or turn
confirmation off.

When sign-in fails the page says why: an unconfirmed email (with a button that sends the link
again), a wrong email or password, too many attempts, or a server it cannot reach. A sign-up for
an email that already has an account says so and moves to the sign-in tab, instead of asking for
a confirmation Supabase never sends.

## Which functions run where

Most functions run on the Node runtime, because they use the Supabase and Stripe SDKs.
`api/mentor.ts` runs on the edge. The rules that keep Node
functions loadable on Vercel are in [architecture](architecture.md#runtime-notes) and are
checked by `npm run check`.
