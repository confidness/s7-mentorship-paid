# Documentation

The [README](../README.md) is the argument for the product and how to run it. These pages are
the depth behind it.

## How it is built

| Page | What it covers |
| --- | --- |
| [Architecture](architecture.md) | The layout, the rules the rest of the code depends on, what is stored where, and what each server route does. |
| [Payments](payments.md) | Prices, the platform's fee, Checkout, Connect payouts, entitlements and refunds. |
| [The AI mentor](ai-mentor.md) | Two brains behind one function, the course advisor, the teaching rule, and what the key can and cannot reach. |
| [Languages](i18n.md) | Kazakh, Russian and English, how a string is stored and why, and how to add one. |
| [Design](design.md) | Theme and skin, the brutal look and its shader, motion, and accessibility. |

## Running it

| Page | What it covers |
| --- | --- |
| [Deployment](deployment.md) | Vercel, the environment variables, the database, the Stripe webhook. |
| [Stripe webhooks](runbooks/stripe-webhooks.md) | Testing locally, which events matter, idempotency, and what to check when an entitlement is missing. |
| [Supabase migrations](runbooks/supabase-migrations.md) | Applying them in order, never editing an applied one, and what each existing file does. |

## Decisions

Short records of choices that are easy to second-guess later. Each has a status, the context it
was made in, the decision, and what follows from it.

| Record | Status |
| --- | --- |
| [0001. An application, not a mentor PIN](decisions/0001-application-over-mentor-pin.md) | Superseded in part by 0003 |
| [0002. The built-in curriculum is retired](decisions/0002-curriculum-retired.md) | Accepted |
| [0003. Anyone may teach; money still has a gate](decisions/0003-open-teaching.md) | Accepted |

## Elsewhere in the repository

- [CONTRIBUTING](../CONTRIBUTING.md): how to propose and make a change.
- [SECURITY](../SECURITY.md): how to report a vulnerability, and what counts.
- [ROADMAP](../ROADMAP.md): what is being done, what is planned, and what is not decided.
- [CHANGELOG](../CHANGELOG.md): what changed, by date.
