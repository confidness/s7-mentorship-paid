-- Numbers about a course that the course's author did not write.
--
-- Every marketplace sells on stars, and stars have a known problem: the seller's own
-- customers write them, which is why every platform that uses them also runs a fraud filter
-- on them. The conversion research points somewhere else anyway — completion rate persuades
-- better than a rating — and completion rate is buried in instructor analytics everywhere,
-- while how long a teacher takes to answer is published nowhere at all.
--
-- This platform can publish both, because the review loop means somebody other than the
-- seller leaves a row behind. What follows is only what survives that test. An earlier draft
-- also showed "approved first time", and it is cut: the mentor writes the decision, so it is
-- the subject's own claim about themselves wearing a statistic's clothes.
--
-- ---------------------------------------------------------------------------
-- Why these are views, and why they run with the owner's rights
-- ---------------------------------------------------------------------------
-- Not cached columns on `custom_lessons`: `lessons_write_own` is `for all`, so an author can
-- update any column of their own lesson, and a reputation the subject can write is not one.
-- 0007 narrows that grant, but a view avoids the question entirely — there is no column to
-- protect, no trigger, no backfill and nothing to drift.
--
-- Both views run with definer semantics, which is deliberate and is the thing to review
-- here. `security_invoker = on` would compute each number over the rows the *caller* may
-- select — `entitlements` only shows you your own — so a public statistic would come out
-- different for every viewer, which is not a statistic. Running as the owner is only safe
-- because these views expose aggregates and nothing else: no user ids, no row-level detail,
-- and a `having` floor so a count of one cannot be read back as a fact about one person.

-- ---------------------------------------------------------------------------
-- lesson_stats — how many people this course actually reached
-- ---------------------------------------------------------------------------
-- Two different numbers wearing one name would be dishonest, so they stay separate.
--
--   `buyers`  comes from `entitlements`, which only the Stripe webhook writes. Nothing on
--             the client can forge it. It is zero for a free course, by definition.
--   `starters` counts accounts that have an assignment XP row for this lesson. Those are
--             minted in the browser — `0002` says so out loud — so this is an upper bound
--             and the interface must never call it an achievement.

create or replace view lesson_stats as
select
  l.id as lesson_id,
  (select count(*) from entitlements e where e.lesson_id = l.id) as buyers,
  (select count(distinct x.user_id) from xp_ledger x where x.kind = 'assignment' and x.ref_id = l.id::text) as starters
from custom_lessons l
where l.published;

-- ---------------------------------------------------------------------------
-- mentor_reputation — how long this person takes to read your work
-- ---------------------------------------------------------------------------
-- The median, not the mean: one project reviewed after a fortnight away drags an average
-- somewhere it will stay for months, and punishing a good mentor for taking a week off once
-- is exactly the kind of number that makes people stop trusting the number.
--
-- Ninety days, not lifetime, for the same reason in the other direction — a fast first month
-- should not carry somebody through a slow year, and a bad quarter has to be recoverable.
--
-- The floor of five is the honesty rule. Below it there is no row at all, so the interface
-- shows "new" rather than a percentage drawn from two data points. A blank where other cards
-- have numbers reads as bad, and that is a penalty aimed squarely at the newest mentors.
--
-- `reviewed_at > submitted_at` guards a negative interval. Until the fix in `api/projects.ts`
-- that shipped alongside this migration, `submitted_at` was rewritten on every save, so rows
-- created before it can be reviewed earlier than they were submitted.

create or replace view mentor_reputation as
select
  p.reviewer_id as mentor_id,
  count(*) as reviews,
  percentile_cont(0.5) within group (
    order by extract(epoch from (p.reviewed_at - p.submitted_at)) / 3600.0
  ) as median_review_hours
from projects p
where p.reviewer_id is not null
  and p.submitted_at is not null
  and p.reviewed_at is not null
  and p.reviewed_at > p.submitted_at
  and p.reviewed_at > now() - interval '90 days'
group by p.reviewer_id
having count(*) >= 5;

grant select on lesson_stats to authenticated;
grant select on mentor_reputation to authenticated;

-- ---------------------------------------------------------------------------
-- student_profiles.learning_path — the advisor's suggestion, kept
-- ---------------------------------------------------------------------------
-- An ordered list of lesson ids, and `text[]` rather than jsonb on purpose. `progress.ts`
-- syncs by diffing two states and its operations are grow-only inserts or monotonic writes,
-- which is what makes replay safe and two devices order-independent. An array compares with
-- a join, exactly as `enrolled_course_ids` already does; a jsonb document compares with
-- `!==`, which is never equal for an object literal — every sync would emit a profile
-- operation forever.
--
-- Ceiling, stated: a path is last-writer-wins, like the enrolment list beside it. Two tabs
-- reordering the same path at the same moment lose one of the orders. For a suggestion a
-- person can regenerate in one click that is the right trade; it would not be for progress.

alter table student_profiles add column if not exists learning_path text[] not null default '{}';
