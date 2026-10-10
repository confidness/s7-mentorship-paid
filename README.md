# Brandyzer

Two products for small businesses, one account.

**Studio** turns a description of a business into a brand kit — a palette, two fonts, the
rules of its voice and the style of its photos — and then writes captions and draws images in
that brand, without the robot voice.

**Bazaar** is where a business hires a freelancer. The client pays through Stripe, Brandyzer
keeps 5%, and the client's brand kit opens to the freelancer for as long as the job is open,
so the work starts from the brand instead of a guess.

This codebase grew out of a mentorship marketplace and kept its spine: Supabase Auth and row
level security, Vercel functions that re-identify every caller, integer money, Stripe Connect,
the design system and its skins, and the hand-rolled checks. The mentorship domain is gone.

## First run

1. **Create a Supabase project** (Postgres 15 or newer — every new project is). Run
   `supabase/migrations/0001_brandyzer.sql` in the SQL editor. It creates four tables, their
   row level security and column grants, the signup trigger and the public `brand-assets`
   bucket. It is safe to run again.
2. **Set the environment** (below) in Vercel, or in `.env.local` for `vercel dev`.
   `node scripts/check-env.mjs` says whether the Supabase keys are in the right slots
   without printing them.
3. **Stripe**: enable Connect, then add two destinations under Developers → Webhooks /
   Event destinations (see *Payments*).
4. Deploy, sign up, and open **Settings → Server features**: it reports which keys each
   feature has, never their values.

Nothing is seeded. The first person to sign up chooses whether they are a business, a
freelancer, or both, and can change it in Settings at any time.

## Environment

The `VITE_` prefix is the line between public and secret: anything carrying it is compiled
into the JavaScript every visitor downloads.

| Variable | Where | What |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | public | The browser's client. Row level security decides what it can reach. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server | The same project, for routes acting as the caller. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Bypasses RLS. Writes contracts, Stripe ids and Storage files. Treat it like a root password. |
| `GEMINI_API_KEY` | server | Brand kits and copy. Free tier at aistudio.google.com. |
| `GEMINI_MODEL` | server, optional | Pins one model. Empty means the built-in list, newest first. |
| `RECRAFT_API_KEY` | server, optional | Paid. First choice for images: logos on Recraft V4.1, photos on V4.1 Flash. |
| `POLLINATIONS_API_KEY` | server, optional | `sk_…` from enter.pollinations.ai; works on free Quest Pollen. Logos on GPT Image, photos on Z-Image. |
| `HF_TOKEN` | server, optional | Hugging Face token; FLUX.1-schnell on the serverless router. |
| `POLLINATIONS_LEGACY=off` | server, optional | Turn off the anonymous, watermarked fallback. |
| `STRIPE_SECRET_KEY` | server | Prefer a restricted key (`rk_…`) with Checkout Sessions, Customers, Accounts v2 and Account Links. |
| `STRIPE_WEBHOOK_SECRET` | server | Signing secret of the snapshot webhook at `/api/webhook`. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | server | Signing secret of the Accounts v2 event destination at `/api/connect/events`. |
| `PUBLIC_SITE_URL` | server | Where Stripe sends people back to. |

## Studio

### Brand kits

`POST /api/studio/brand-kit` asks Gemini for a kit against a `responseSchema`, then runs the
reply through `normalizeBrandKit` in `src/lib/brand.ts` before anything is saved. The model's
output is untrusted input: a colour that is not a hex code is dropped, a font name that could
break a stylesheet or a Google Fonts URL falls back to a safe default, and the house list of
banned words is always merged in. The kit is saved *as the caller*, through RLS — no service
role is needed to write your own row.

Kits are locked in: generated once, then read. A new direction is a new kit beside the old
one, so the brand a freelancer was handed last week is still the brand they have. The logo is
the exception, because the first drawing often is not the one.

### Copy, without the slop

`POST /api/studio/copy` sends the spec's directive word for word —

> You are the Brandyzer Copy Engine. Strip robotic transitions, corporate buzzwords
> ('delve', 'tapestry', 'synergy'), and excessive emojis. Output conversational, grounded,
> small-business marketing text.

— followed by the kit's own tone, example lines and banned words. That is the polite half.
The other half is `slopCheck`, which reads every variant back against the same list plus the
tells no list catches (more than two emoji, rows of exclamation marks, em dashes). Flagged
copy earns exactly one rewrite with the offending words named; anything still flagged is
returned marked, never silently hidden. Copy can be written in English, Russian or Kazakh.

### Models

Gemini 1.5 Flash, which this was first specified against, has been retired, and 2.5 Flash is
closed to new projects. `api/_lib/gemini.ts` tries a list of current Flash models in order,
stepping to the next on a 404, a per-model free-tier 429 or an overload, and stopping at once
on a bad key. The key travels in a header, never the URL.

### Images

Pollinations moved to `gen.pollinations.ai` and now wants a secret key, so the browser can no
longer be handed a Pollinations URL to load. The server fetches the image, checks it really is
one (a 200 carrying an HTML page is skipped), and stores it in the `brand-assets` bucket under
`<user id>/<uuid>`. The bucket is public but not listable.

Every photo prompt has the kit's `image_style` directives and palette folded in by
`buildImagePrompt` — the owner types "sourdough on the counter", the model is told the rest.
A kit with no style gets the spec's default: natural lighting, 35mm film grain, photorealistic
product style. Logos are asked for without lettering, because image models still cannot spell.

## Bazaar

### Hiring and the 5%

`POST /api/bazaar/hire` reads the price from the database — the body names a service, never
an amount — asks Stripe, right then, whether the freelancer can receive transfers, writes a
`pending` contract, and opens a Stripe Checkout Session whose PaymentIntent is a destination
charge:

```ts
payment_intent_data: {
  application_fee_amount: split.feeCents, // platformFee(total, 500) — Math.round(total * 0.05), in integers
  transfer_data: { destination: freelancer.stripe_connect_id },
}
```

This is the PaymentIntent the spec describes, created through Checkout so Stripe's hosted
page handles cards, wallets, 3-D Secure and receipts. `test/money.test.ts` checks that the
integer fee equals `Math.round(total * 0.05)` for every amount it tries.

**Two consequences of destination charges worth deciding about before launch:**

- **The freelancer is paid when the payment clears, not when the work is accepted.**
  `funded → in_review → completed` is the working agreement between two people, not escrow.
  Holding money until acceptance means switching to separate charges and transfers, with the
  transfer made on `accept`.
- **Brandyzer pays Stripe's processing fee.** At 5% the platform's cut is below Stripe's
  fee on any job under roughly $14 (US card pricing). Services have a $5 floor as a sanity
  check, not as pricing advice.

### Contracts

| Status | Means | Moved by |
| --- | --- | --- |
| `pending` | checkout started, nothing paid | hire route |
| `funded` | Stripe confirmed the money | webhook (or the client asking for changes) |
| `in_review` | the freelancer delivered | freelancer |
| `completed` | the client accepted | client |
| `canceled` | checkout expired or the payment failed | webhook |
| `refunded` | a full refund | webhook |

Browsers have no write right on contracts at all. Payment states are the webhook's alone;
people move contracts through `PATCH /api/bazaar/contracts`, which asks `decideTransition` and
updates only if the status is still the one it decided against.

### Sharing the brand kit

The spec's "active contract" is `funded` or `in_review`: paid for and not yet finished. A
freelancer can read the client's kit — and write copy and draw images in it — exactly then,
enforced by the `brand_kits_shared` policy. Not while the hire is merely pending, and not
after completion or a refund.

A composite foreign key, `(brand_kit_id, client_id) → brand_kits (id, user_id)`, means a
contract can only ever share a kit that belongs to its client. Without it, a client and a
freelancer working together could name somebody else's kit id and the read rule would hand it
over.

## Payments setup

- **Connected accounts** are Accounts v2 recipients with the Express dashboard: Brandyzer is
  merchant of record, collects fees and carries negative balances, and asks for exactly one
  capability, `stripe_balance.stripe_transfers`. Whether a freelancer can be paid is read from
  that capability's status, not from the v1 `charges_enabled` field.
- **Snapshot webhook** → `https://<site>/api/webhook`, subscribed to
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`.
- **Accounts v2 event destination** (thin events) → `https://<site>/api/connect/events`,
  subscribed to `v2.core.account[configuration.recipient].capability_status_updated`,
  `v2.core.account[configuration.recipient].updated` and `v2.core.account[requirements].updated`.
  It keeps the directory's "taking payments" badge current; the hire route checks Stripe live
  either way.
- Refunds come out of Brandyzer's balance unless made with *reverse transfer*, which also pulls
  back the freelancer's share. The Dashboard asks; the answer is a business decision.

## Where this differs from the spec

| Spec | Here | Why |
| --- | --- | --- |
| `price_usd`, `total_amount`, … | `price_usd_cents`, `total_amount_cents`, … | Integer cents, unit in the name. A float does not hold 0.1 exactly. |
| `status` with four values | plus `canceled` and `refunded` | An expired checkout and a refund have to end the contract, or a refunded freelancer keeps the kit. |
| `stripe.paymentIntents.create` | Checkout Session with `payment_intent_data` | Same destination-charge PaymentIntent and fee; Stripe's hosted page instead of a card form to build and keep compliant. |
| Gemini 1.5 Flash | current Flash models, tried in order | 1.5 is retired. |
| Pollinations URL in the browser | fetched and stored by the server | Pollinations now needs a secret key. The original anonymous URL is the last fallback. |
| — | `stripe_transfers_active` on profiles | The directory needs to show who can be hired; the Stripe ids themselves are not readable from a browser. |
| — | `business_json`, `delivery_note`, `delivery_url`, `brief` | Copy needs to know what the business sells; review needs something to review. |

## Architecture

```
src/
  lib/
    brand.ts      what a kit is: types, normalising, slopCheck, buildImagePrompt
    bazaar.ts     the 5% split, decideHire, decideTransition — the rules, as pure functions
    money.ts      integer minor units and platformFee
    api.ts        every read and call the interface makes
    store.tsx     the session and the toasts, nothing else
  pages/          studio/, bazaar/, contracts/, sell/, Settings, Login
  components/     design system (ui.tsx), kit previews, chrome, skins and the 3D scene
api/
  _lib/           server.ts (callers and clients), stripe.ts, gemini.ts, images.ts, studio.ts
  studio/         brand-kit, copy, image
  bazaar/         hire, contracts
  connect/        onboard, status, events
  webhook.ts, health.ts
supabase/migrations/0001_brandyzer.sql
test/             money, bazaar, brand, studio
```

Ten serverless functions, inside a Vercel Hobby project's limit of twelve. The Studio routes
are given 60 seconds in `vercel.json`; image generation can take thirty.

The interface is English for now. The Kazakh and Russian machinery is all still in
`src/i18n` — adding a language is writing its strings and listing it in `LOCALES`.

## Checks

```
npm run check     four test files, every api/ function loaded the way Vercel loads it,
                  and every interface string present in the dictionary
npx tsc --noEmit  types
npm run build     production bundle
```

`test/studio.test.ts` runs the real copy and brand-kit routes against stubbed Gemini and
Supabase endpoints and asserts what leaves: the schema, the directive, the kit's banned words,
the key in a header and never the URL, one rewrite for slop, a model fallthrough on 404 but
not on a bad key, and a model-written kit repaired and saved under the caller's verified id.

## Not done yet

- The 3D scene's centrepiece is still the old S-curve mark.
- No per-user rate limit on the Studio routes. Signed-in only, but a determined account can
  spend the free-tier quota.
- No dispute handling (`charge.dispute.created`), no Express dashboard login link for
  freelancers, no notifications when a contract moves.
- Generated images are not kept in a gallery; each lives in Storage and in the page that made it.
