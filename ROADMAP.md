# Roadmap

What is being done, what is planned, and what is not yet decided. Everything here is a plan, not
a promise and not a description of the code as it stands. Order within a section is not a
ranking. For what has already changed, see the [CHANGELOG](CHANGELOG.md).

## Now

- **Chargeback handling in the Stripe webhook.** `charge.refunded` is handled; a dispute is
  not, so a student who disputes a payment keeps their entitlement. The webhook is being taught
  `charge.dispute.created` and `charge.dispute.closed`. See [payments](docs/payments.md).

## Next

- **A public, indexable catalogue and mentor pages.** Today every route except sign-in is
  behind sign-in, so nothing on the platform can be found by search, and a mentor has nowhere
  to send a prospective student. A published lesson and the mentor who wrote it should each
  have a page anyone can open.
- **Verified-completion testimonials beside the mentor reputation.** `0009_reputation.sql`
  already argues that completion rate persuades better than stars, and publishes how long a
  mentor takes to answer. A testimonial from someone who finished the lesson, and whom the
  platform can show finished it, belongs next to those numbers.
- **Two-sided referrals that pay out on a first paid purchase, not on signup.** A reward for
  signing up pays for accounts. A reward for a first purchase pays for customers.
- **Promo codes.** Open question: who funds the discount. The platform's application fee is a
  fixed share of the sale, and a Stripe promotion would come out of the mentor's transfer, so a
  code would have to be funded by the mentor, by the platform's cut, or by a stated split.
  That is a decision about the marketplace before it is a decision about code.

## Later

- **Bundles of lessons**, sold as one purchase.
- **Mentor office hours with booking.**
- **Certificates, with a public page where anyone can verify one.**

## Open questions

These are not tasks. They decide whether some of the above can be done at all.

- **Payments in Kazakhstan.** Stripe likely requires a legal entity outside Kazakhstan, and
  whether Connect payouts to mentors resident in Kazakhstan are possible is unconfirmed. The
  local acquirers (Halyk ePay, TipTopPay, formerly CloudPayments KZ, Freedom Pay, Kaspi) do not
  advertise marketplace split payouts, which is the thing Connect gives this platform.
- **Where personal data may be stored.** Kazakhstan has a data localisation law for the
  personal data of its citizens. The database and the functions run on Supabase and Vercel.
  Whether that is compatible, and what would have to change, needs legal advice and not a guess.
