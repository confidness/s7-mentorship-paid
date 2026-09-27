-- Takes away two write rights the browser should never have had.
--
-- Three places in this schema justified a wide `update` policy by saying that the API route
-- restricts which columns are written. That is true of the route and false of the database.
-- `src/lib/supabase.ts` hands the browser an authenticated client on purpose — it is how the
-- app reads profiles and signs in — so anyone can open devtools and issue the update the
-- route would have refused to write. The route is one client, not the boundary.
--
-- Postgres has no per-column update policy. It does have two other tools, and each fits one
-- of these cases exactly.

-- ---------------------------------------------------------------------------
-- projects: the mentor's update right goes away entirely
-- ---------------------------------------------------------------------------
-- `projects_review` allowed `update` to any mentor on any submitted project, checking only
-- that the writer is a mentor. Every column was in reach:
--
--   supabase.from('projects').update({ code: '…', author_id: <mine>, status: 'approved' })
--
-- — rewrite a student's submission, take the authorship, approve it into the public gallery.
-- Nothing in the schema said no.
--
-- There is no narrower policy to write, because the distinction is per column and policies
-- are per row. So the decision moves out of the browser's reach: `api/projects.ts` PATCH now
-- writes with the service role, having identified the caller as a mentor from `profiles`.
-- A mentor's browser keeps its read rights and loses its write rights.
drop policy if exists projects_review on projects;

-- Students keep theirs. `projects_update_own` is already column-safe by construction: its
-- `with check` pins `status` to the two states a student may set and both reviewer columns
-- to null, so there is no column left to abuse.

-- ---------------------------------------------------------------------------
-- notifications: read_at and nothing else
-- ---------------------------------------------------------------------------
-- Here the right tool is a column privilege rather than a policy. Only one party ever updates
-- a notification — its owner — so the grant can be narrowed for everybody at once, which is
-- what `authenticated` being a single role otherwise makes impossible.
--
-- RLS still decides *which* rows (`notifications_mark_read`, unchanged); this decides which
-- columns, and now the comment on that policy is a fact rather than a promise about a route.
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;

-- ---------------------------------------------------------------------------
-- lesson_submissions: the same treatment, before anything depends on it
-- ---------------------------------------------------------------------------
-- Nothing reads this table yet — submissions still live in the student's browser — which is
-- the only reason these were not exploitable. Two holes, both from 0001:
--
--   `submissions_insert_own` lets a student insert their own row with any `status` and any
--   `awarded_xp`, so `{status: 'reviewed', awarded_xp: 99999}` was one call away.
--   `submissions_grade` lets the lesson's author update the row, including `answers` and
--   `student_id` — a mentor could rewrite what a student submitted, or reassign it.
--
-- Column privileges split it cleanly: a student writes the answer columns, a mentor writes
-- the grading columns, and the row policies keep deciding whose rows either may touch.
do $$ begin
  revoke insert, update on lesson_submissions from authenticated;
  grant insert (lesson_id, student_id, answers, quiz_total, submitted_at) on lesson_submissions to authenticated;
  grant update (status, quiz_score, awarded_xp, feedback, reviewed_at, reviewer_id) on lesson_submissions to authenticated;
exception when undefined_table then raise notice 'lesson_submissions not found; skipped';
end $$;
