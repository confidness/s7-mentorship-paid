-- Chargebacks: two more things an order can be.
--
-- 0001 gave an order four states, and one of them is about money going back: `refunded`, the
-- platform returning it. A chargeback is the buyer's bank taking it back without asking, and
-- until now the webhook did not listen for one — the bank returned the money and the student
-- kept the lesson as well. `api/webhook.ts` now withdraws access when a dispute opens and
-- decides what happens when it closes, and the order needs two words to say which:
--
--   disputed      the bank is contesting the payment. Access is withdrawn until it decides.
--   charged_back  the dispute closed against the sale. The money is gone, the lesson stays shut.
--
-- A dispute that closes in the sale's favour needs no word of its own: the order goes back to
-- `paid`, which is what it is again.
--
-- `add value` rather than recreating the type, because every row in `orders` holds it, and
-- `if not exists` so the file can be run twice like the others. Postgres will not let a value
-- added here be used in the same transaction; nothing below uses one.

alter type order_status add value if not exists 'disputed';
alter type order_status add value if not exists 'charged_back';

-- ---------------------------------------------------------------------------
-- orders: refunds and disputes find their order by payment intent
-- ---------------------------------------------------------------------------
-- A charge and a dispute both name the payment intent and never the Checkout Session, so that
-- is the column every refund and every dispute looks its order up by. Without an index each
-- of those is a scan of every sale the platform has ever made.

create index if not exists orders_payment_intent on orders (stripe_payment_intent);
