-- Repairs two things that `0006_open_teaching.sql` quietly broke.
--
-- Letting anyone make themselves a mentor was the right product decision and the wrong
-- security one, because `is_mentor()` was being used for two different jobs. As a
-- *capability* — may this person write and publish a course — it is still exactly right, and
-- now costs one click, as intended. As *authority over somebody else's row* it has become
-- meaningless: a predicate any signed-in account can switch on for itself grants nothing.
--
-- Every policy written as `is_mentor()` for the second purpose therefore has to go. There
-- were two, and one of them was a hole with a name.

-- ---------------------------------------------------------------------------
-- notifications: nobody writes into somebody else's inbox from a browser
-- ---------------------------------------------------------------------------
-- `notifications_write_staff` allowed an insert by anyone `is_mentor()`, on the reasoning
-- that mentors act on other people. After 0006 that is everyone, so the table was an open
-- relay: arbitrary title, arbitrary body, arbitrary `href`, delivered into any account's
-- inbox and rendered as if the platform had sent it. "Your payment failed, click here" is
-- two lines from devtools.
--
-- It is not fixable with a narrower predicate, because there is no honest one: mentorship is
-- self-declared by design now. So the browser loses the right entirely. The three places
-- that legitimately notify somebody else — a review decided, a mentor application answered,
-- a demand request fulfilled — all run in `api/`, where a service role is available and its
-- use is already the documented pattern for "writes rows no user may write".
--
-- Note there is still no delete policy, deliberately: an inbox that can be emptied invisibly
-- is worse than one that grows. That is precisely why nothing arbitrary may be put in it.
drop policy if exists notifications_write_staff on notifications;

-- ---------------------------------------------------------------------------
-- custom_lessons: publishing is not a column the author may write
-- ---------------------------------------------------------------------------
-- `lessons_write_own` is `for all`, so an author holds update on every column of their own
-- lesson — including `published`. `api/lessons.ts` guards a priced publish behind
-- `requireSellingMentor`, but a guard in a route is advice when the browser can write the
-- same column directly:
--
--   supabase.from('custom_lessons').update({ published: true }).eq('id', mine)
--
-- — and the lesson is in the storefront at whatever price, with no Stripe account behind it
-- and no way for the money to arrive. The `0005` treatment applies: keep the row policy,
-- narrow the columns, and let the route own the one field it actually gates.
revoke update on custom_lessons from authenticated;
grant update (title, summary, material_path, material_name, material_mime, material_size, price_cents, currency, updated_at)
  on custom_lessons to authenticated;

-- `published` is deliberately absent from that list, and so are `id`, `author_id` and
-- `created_at`. Publishing now happens only through `api/lessons.ts`, which holds the
-- service role and checks Stripe first.
