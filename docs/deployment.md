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
   - `ANTHROPIC_WORKSPACE_ID` — only if that key was created at the organisation level rather
     than inside a workspace. Anthropic refuses such a key with a 400 until a workspace is
     named; **Send a test question** in Settings says so in as many words when it happens.
4. Create the database. Apply every file in `supabase/migrations/` against the project, in
   numeric order, starting at `0001_monetization.sql`. The later files change the policies the
   earlier ones created, so a deployment built from `0001` alone is not the one the code is
   written against. See the [migrations runbook](runbooks/supabase-migrations.md) for how, and
   for what each file does.

   Optionally, mark yourself an admin with
   `update profiles set is_admin = true where id = '<your-user-id>';`, which is deliberately a
   database operation: nothing the client can post sets that flag. An admin can read every
   order, entitlement and lesson through row level security. There is no admin screen.
5. Point a Stripe webhook at `https://<your-deployment>/api/webhook`, subscribed to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and
   `account.updated`. Dispute handling is being added to the webhook: when it lands, also
   subscribe to `charge.dispute.created` and `charge.dispute.closed`. Subscribing early is
   harmless, since an event the webhook does not act on is acknowledged and not retried.
   Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/webhook`, with the functions served
   by `vercel dev`. See the [webhook runbook](runbooks/stripe-webhooks.md).
6. Enable Stripe Connect (Express) so mentors can be paid.
7. Deploy. Build command `npm run build`, output `dist`.
8. Sign in as a mentor and open **Settings → Server features**. It reports, for each endpoint,
   whether it is deployed and whether its key is set — without ever revealing the value, and
   **Send a test question** spends one real request to tell a good key from a rejected one.

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

## Which functions run where

Most functions run on the Node runtime, because they use the Supabase and Stripe SDKs.
`api/mentor.ts` and `api/payments-health.ts` run on the edge. The rules that keep Node
functions loadable on Vercel are in [architecture](architecture.md#runtime-notes) and are
checked by `npm run check`.
