# Roadmap

What is being done, what is planned, and what is not yet decided. Now, Next and Later are plans,
not promises and not a description of the code as it stands. Done lists what has shipped. Order
within a section is not a ranking. For the full history, see the [CHANGELOG](CHANGELOG.md).

## Now

- **Project approval XP on the server.** A project's review is on the server, but the XP for
  an approved project is still paid only in the reviewing mentor's browser, and the database
  refuses an `approval` row from a browser anyway, so it never reaches the student. Lesson
  hand-ins already pay from the server; projects should do the same.
- **Hand-in loose ends.** Editing a lesson after answers have arrived re-mints its question
  ids, so earlier answers no longer line up with their questions. Approving overwrites the
  earlier "changes requested" feedback instead of keeping a thread as projects do. The learning
  path counts a hand-in that was sent back as done.

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

## Done

- **Chargeback handling in the Stripe webhook.** A dispute withdraws access while the bank
  decides, and the outcome settles it. Only a full refund withdraws access; a partial one does
  not. Reversing the mentor's transfer after a lost dispute is still done by hand in the Stripe
  dashboard, because who carries a chargeback is a policy before it is code. See
  [payments](docs/payments.md).
- **A daily limit on AI mentor questions per account.** See [the AI mentor](docs/ai-mentor.md).
- **Assignment hand-ins on the server.** Answers to mentor-written lessons, and the author's
  verdict, are in Postgres (`0013`), marked by the server and readable from any device.
- **A public front door** at `/welcome`, before anyone is asked for an account.

## Open questions

These are not tasks. They decide whether some of the above can be done at all.

- **Payments in Kazakhstan.** Stripe likely requires a legal entity outside Kazakhstan, and
  whether Connect payouts to mentors resident in Kazakhstan are possible is unconfirmed. The
  local acquirers (Halyk ePay, TipTopPay, formerly CloudPayments KZ, Freedom Pay, Kaspi) do not
  advertise marketplace split payouts, which is the thing Connect gives this platform.
- **Where personal data may be stored.** Kazakhstan has a data localisation law for the
  personal data of its citizens. The database and the functions run on Supabase and Vercel.
  Whether that is compatible, and what would have to change, needs legal advice and not a guess.
