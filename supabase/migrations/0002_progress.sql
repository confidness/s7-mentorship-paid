-- Progress schema.
--
-- 0001 drew the line at money and left progress in the browser, on the grounds that nobody
-- gains by forging their own streak. That is still true of forging. It is not true of losing:
-- a cleared browser is a cleared account, progress on one device is invisible on the next,
-- and a mentor can only see projects submitted from the same browser they are reviewing in.
--
-- Three shapes, because three different questions get asked of this data:
--   student_profiles  one row per learner   — who is this and where are they (boot, leaderboard)
--   lesson_progress   one row per lesson    — what happened and when (cohorts, adaptive paths)
--   xp_ledger         one row per award     — why they have this much, and pay it once
--
-- A single JSONB document was the other candidate. It is rejected on the middle row: the
-- question a mentor dashboard asks is "which lesson is this class stuck on", which against a
-- document is a full scan and a jsonb_array_elements for every question anyone ever asks. The
-- id arrays in StudentProfile also throw away the column analytics wants most — the timestamp.
-- `completedLessonIds` says a lesson was finished. It cannot say it took four days.

-- ---------------------------------------------------------------------------
-- student_profiles
-- ---------------------------------------------------------------------------
-- The summary read on boot: one row, one round trip, and the leaderboard is an index scan
-- rather than an aggregate over the ledger. `xp` is a cache of sum(xp_ledger.amount),
-- maintained by the trigger below and writable by nothing else — see the update policy.
--
-- Course ids are text and not foreign keys: courses live in code, not in rows. A constraint
-- here would mean shipping the curriculum to the database twice.

create table if not exists student_profiles (
  user_id             uuid primary key references profiles (id) on delete cascade,
  xp                  integer not null default 0 check (xp >= 0),
  streak              integer not null default 0 check (streak >= 0),
  last_active_date    timestamptz not null default now(),
  current_course_id   text not null default '',
  enrolled_course_ids text[] not null default '{}',
  goal                text not null default 'goal_complete_first_lesson',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists student_profiles_xp on student_profiles (xp desc);

-- ---------------------------------------------------------------------------
-- lesson_progress
-- ---------------------------------------------------------------------------
-- Three timestamps rather than three booleans, and one row rather than three id arrays on the
-- profile. `passedCheckLessonIds`, `completedLessonIds` and `completedChallengeIds` are the
-- same fact about the same lesson recorded in three places; here they are three columns of
-- one row, each carrying when it happened. When is the entire input to an adaptive path, and
-- a boolean discards it for no saving.
--
-- Curriculum lessons only. A mentor-written lesson's progress is a lesson_submissions row,
-- which 0001 already created.

create table if not exists lesson_progress (
  user_id                uuid not null references profiles (id) on delete cascade,
  lesson_id              text not null,
  course_id              text not null,
  first_seen_at          timestamptz not null default now(),
  check_passed_at        timestamptz,
  completed_at           timestamptz,
  challenge_completed_at timestamptz,
  primary key (user_id, lesson_id)
);

-- The cohort read: how far a class has got through a given lesson.
create index if not exists lesson_progress_by_lesson on lesson_progress (lesson_id) where completed_at is not null;
create index if not exists lesson_progress_by_course on lesson_progress (course_id, user_id);

-- ---------------------------------------------------------------------------
-- xp_ledger
-- ---------------------------------------------------------------------------
-- `awardXp` refuses a second award for the same kind and ref. That guard lives in one function
-- deliberately — guarding each caller separately is how a resubmitted project came to pay
-- twice — but it cannot survive as a client-side check once two devices exist. It moves here,
-- to the only place both devices agree on.
--
-- Two unique keys doing two different jobs, and both are needed:
--   op_id                   a retry after an unknown outcome collides instead of paying twice.
--                           The request that timed out may well have committed.
--   (user_id, kind, ref_id) a second award for the same thing is impossible even from another
--                           device with a different op_id. This is awardXp, in the database.
--
-- `reason` is a dictionary key and `vars` its interpolation, never a finished sentence — the
-- ledger would otherwise be frozen in whatever language was active when it was written.

do $$ begin
  create type xp_kind as enum ('lesson', 'assignment', 'challenge', 'submission', 'approval', 'achievement', 'competition');
exception when duplicate_object then null; end $$;

create table if not exists xp_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  amount     integer not null check (amount >= 0),
  reason     text not null,
  vars       jsonb,
  kind       xp_kind not null,
  ref_id     text,
  op_id      uuid not null unique,
  created_at timestamptz not null default now()
);

create unique index if not exists xp_ledger_paid_once on xp_ledger (user_id, kind, ref_id) where ref_id is not null;
create index if not exists xp_ledger_recent on xp_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- the running total
-- ---------------------------------------------------------------------------
-- `xp` is never sent by a client and never updated by one. It moves only when a ledger row
-- lands, which makes the unique index above the double-count guard for the total as well as
-- for the ledger. One choke point, which is the same argument awardXp makes.

create or replace function xp_ledger_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into student_profiles (user_id) values (new.user_id) on conflict (user_id) do nothing;
  update student_profiles set xp = xp + new.amount, updated_at = now() where user_id = new.user_id;
  return new;
end $$;

drop trigger if exists xp_ledger_totals on xp_ledger;
create trigger xp_ledger_totals after insert on xp_ledger for each row execute function xp_ledger_apply();

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- `selectors.mentorStats` says one academy, one roster: a mentor is responsible for every
-- student unless a group says otherwise. This says the same rather than inventing a cohort
-- boundary the application does not have.

create or replace function is_mentor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'mentor' from profiles p where p.id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- `create policy` has no `if not exists`, so a second run of this file would abort without
-- these drops. 0001 takes the same precaution for the same reason.

drop policy if exists student_profiles_read on student_profiles;
drop policy if exists student_profiles_insert_own on student_profiles;
drop policy if exists student_profiles_update_own on student_profiles;
drop policy if exists lesson_progress_read on lesson_progress;
drop policy if exists lesson_progress_insert_own on lesson_progress;
drop policy if exists lesson_progress_update_own on lesson_progress;
drop policy if exists xp_ledger_read on xp_ledger;
drop policy if exists xp_ledger_insert_own on xp_ledger;

alter table student_profiles enable row level security;
alter table lesson_progress  enable row level security;
alter table xp_ledger        enable row level security;

create policy student_profiles_read on student_profiles for select to authenticated
  using (user_id = auth.uid() or is_mentor() or is_admin());
create policy student_profiles_insert_own on student_profiles for insert to authenticated
  with check (user_id = auth.uid() and xp = 0);

-- `xp` is pinned to its current value, exactly as 0001 pins `is_admin` on profiles. A learner
-- may move their goal and their course. They may not move their score.
create policy student_profiles_update_own on student_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and xp = (select sp.xp from student_profiles sp where sp.user_id = auth.uid()));

create policy lesson_progress_read on lesson_progress for select to authenticated
  using (user_id = auth.uid() or is_mentor() or is_admin());
create policy lesson_progress_insert_own on lesson_progress for insert to authenticated
  with check (user_id = auth.uid());
create policy lesson_progress_update_own on lesson_progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy, deliberately: progress is not un-made.

create policy xp_ledger_read on xp_ledger for select to authenticated
  using (user_id = auth.uid() or is_mentor() or is_admin());

-- A learner records what they did. `approval` and `competition` are absent on purpose: those
-- are somebody else's decision about you, and must arrive through a route holding the service
-- role rather than from the browser of the person being decided about.
create policy xp_ledger_insert_own on xp_ledger for insert to authenticated
  with check (user_id = auth.uid() and kind in ('lesson', 'assignment', 'challenge', 'achievement', 'submission'));

-- No update and no delete policy for anybody, including admins. A ledger that can be edited
-- is not a ledger.
