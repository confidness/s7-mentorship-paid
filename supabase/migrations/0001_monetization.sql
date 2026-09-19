-- Monetization schema for S7 Robotics Platform.
--
-- The app was local-first: every user, lesson and submission lived in one localStorage key.
-- That is fine for progress and XP, which nobody gains by forging. It is not fine for money.
-- Anything that decides whether a student may open paid content, or whether an adult may
-- teach on the platform, lives here instead — where the browser can read but never write.
--
-- The rule this file enforces throughout: the client may cache a decision, never make one.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Mirrors the client's User type minus the password. Auth owns credentials now;
-- the old model kept them in cleartext in the browser, which must not survive this change.

do $$ begin create type user_role as enum ('student', 'mentor'); exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null,
  role          user_role not null default 'student',
  avatar        text not null default '',
  title         text,
  bio           text,
  city          text,
  -- Admin is set by a database operator, never by anything the client can post.
  is_admin      boolean not null default false,
  joined_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- mentor_applications  (replaces the shared admin PIN)
-- ---------------------------------------------------------------------------
-- A PIN is one secret shared by everyone who has ever been a mentor: it cannot be revoked
-- for one person, and it says nothing about who is behind the keyboard. An application is
-- reviewed once, per person, and can be withdrawn.
--
-- The document columns hold Storage object paths, never file bytes and never URLs.

do $$ begin create type application_status as enum ('pending', 'approved', 'rejected'); exception when duplicate_object then null; end $$;

create table if not exists mentor_applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles (id) on delete cascade,
  status              application_status not null default 'pending',
  legal_name          text not null,
  bio                 text not null,
  credential_doc_path text,
  id_doc_path         text,
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewer_id         uuid references profiles (id),
  rejection_reason    text
);

-- One live application per person. A rejected one may be replaced; a pending or approved
-- one may not be duplicated to get a second reviewer's opinion.
create unique index if not exists mentor_applications_one_live
  on mentor_applications (user_id)
  where status in ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- mentor_accounts  (Stripe Connect)
-- ---------------------------------------------------------------------------
-- charges_enabled is Stripe's answer, cached. It is refreshed from the API rather than
-- trusted from a client, because it gates whether a lesson may be sold at all.

create table if not exists mentor_accounts (
  user_id           uuid primary key references profiles (id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- custom_lessons
-- ---------------------------------------------------------------------------
-- Money is integer minor units throughout. Floats do not represent 0.1 exactly, and a
-- rounding drift in a fee calculation is somebody's missing cent.

create table if not exists custom_lessons (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references profiles (id) on delete cascade,
  title         text not null,
  summary       text not null,
  -- Storage path in the private lesson-materials bucket. The old build inlined the whole
  -- file as a data: URL in client state, which hands a paid PDF to anyone who looks.
  material_path text,
  material_name text,
  material_mime text,
  material_size integer,
  price_cents   integer not null default 0 check (price_cents >= 0 and price_cents <= 100000000),
  currency      text not null default 'usd' check (char_length(currency) = 3),
  published     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists custom_lessons_author on custom_lessons (author_id);
create index if not exists custom_lessons_published on custom_lessons (published) where published;

-- ---------------------------------------------------------------------------
-- custom_tasks
-- ---------------------------------------------------------------------------
-- answer_index is the answer key. It is server-only: no student-facing query selects it,
-- and RLS below never exposes this table to a student directly.

do $$ begin create type task_kind as enum ('quiz', 'code', 'open'); exception when duplicate_object then null; end $$;

create table if not exists custom_tasks (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references custom_lessons (id) on delete cascade,
  position     integer not null,
  kind         task_kind not null,
  prompt       text not null,
  points       integer not null default 0 check (points >= 0 and points <= 100),
  options      jsonb,
  answer_index integer,
  starter      text
);

create index if not exists custom_tasks_lesson on custom_tasks (lesson_id, position);

-- ---------------------------------------------------------------------------
-- orders / entitlements
-- ---------------------------------------------------------------------------
-- stripe_session_id is unique so a webhook redelivery — which Stripe does on purpose —
-- collides instead of granting a second entitlement or double-counting revenue.

do $$ begin create type order_status as enum ('pending', 'paid', 'failed', 'refunded'); exception when duplicate_object then null; end $$;

create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),
  stripe_session_id  text not null unique,
  stripe_payment_intent text,
  student_id         uuid not null references profiles (id) on delete cascade,
  lesson_id          uuid not null references custom_lessons (id) on delete restrict,
  amount_cents       integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  currency           text not null,
  status             order_status not null default 'pending',
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  constraint fee_not_above_amount check (platform_fee_cents <= amount_cents)
);

create index if not exists orders_student on orders (student_id);

-- The row that unlocks content. Written by the Stripe webhook and by nothing else.
create table if not exists entitlements (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles (id) on delete cascade,
  lesson_id  uuid not null references custom_lessons (id) on delete cascade,
  order_id   uuid references orders (id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (student_id, lesson_id)
);

-- ---------------------------------------------------------------------------
-- lesson_submissions
-- ---------------------------------------------------------------------------

do $$ begin create type submission_status as enum ('submitted', 'reviewed'); exception when duplicate_object then null; end $$;

create table if not exists lesson_submissions (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references custom_lessons (id) on delete cascade,
  student_id   uuid not null references profiles (id) on delete cascade,
  answers      jsonb not null default '[]'::jsonb,
  quiz_score   integer not null default 0,
  quiz_total   integer not null default 0,
  status       submission_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewer_id  uuid references profiles (id),
  feedback     text,
  awarded_xp   integer,
  unique (lesson_id, student_id)
);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- profiles are created by Auth, not by the client
-- ---------------------------------------------------------------------------
-- Every policy below reads profiles, and so does the admin check, so a signed-in
-- person without a row here can do nothing at all. Letting the browser insert its
-- own row would mean letting it choose its own `role` and `is_admin`, which is the
-- one thing that must never be client-supplied — so a trigger does it instead.
--
-- role is hardcoded to 'student'. Becoming a mentor happens through an approved
-- application, and nothing a person types at signup can shortcut that.

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, avatar, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data ->> 'name', new.email), 2)),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

create or replace function owns_lesson(lesson uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from custom_lessons l where l.id = lesson and l.author_id = auth.uid())
$$;

create or replace function has_entitlement(lesson uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entitlements e where e.lesson_id = lesson and e.student_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Every table is locked by default. Note what is absent as much as what is present:
-- there is no insert/update policy on entitlements or orders for any normal role, so even
-- a leaked anon key cannot mint an entitlement. Only the service role, used solely by the
-- Stripe webhook, bypasses RLS.

-- Dropped first so the whole file can be run again after a correction, rather than
-- aborting on the first policy that already exists.
drop policy if exists profiles_read on profiles;
drop policy if exists profiles_update_self on profiles;
drop policy if exists applications_read_own on mentor_applications;
drop policy if exists applications_insert_own on mentor_applications;
drop policy if exists applications_review on mentor_applications;
drop policy if exists accounts_read_own on mentor_accounts;
drop policy if exists lessons_read_published on custom_lessons;
drop policy if exists lessons_write_own on custom_lessons;
drop policy if exists tasks_author_only on custom_tasks;
drop policy if exists orders_read_own on orders;
drop policy if exists entitlements_read_own on entitlements;
drop policy if exists submissions_read on lesson_submissions;
drop policy if exists submissions_insert_own on lesson_submissions;
drop policy if exists submissions_grade on lesson_submissions;

alter table profiles             enable row level security;
alter table mentor_applications  enable row level security;
alter table mentor_accounts      enable row level security;
alter table custom_lessons       enable row level security;
alter table custom_tasks         enable row level security;
alter table orders               enable row level security;
alter table entitlements         enable row level security;
alter table lesson_submissions   enable row level security;

-- profiles: readable by signed-in users (names appear on lessons and reviews);
-- writable only by the owner, and never to grant themselves admin or mentor.
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from profiles p where p.id = auth.uid())
              and role = (select p.role from profiles p where p.id = auth.uid()));

-- mentor_applications: an applicant sees and files their own; admins see all.
create policy applications_read_own on mentor_applications for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy applications_insert_own on mentor_applications for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
-- Only an admin may move an application out of pending. An applicant approving themselves
-- is the whole failure this table exists to prevent.
create policy applications_review on mentor_applications for update to authenticated
  using (is_admin()) with check (is_admin());

create policy accounts_read_own on mentor_accounts for select to authenticated
  using (user_id = auth.uid() or is_admin());

-- custom_lessons: a published lesson is discoverable by anyone signed in — that is the
-- storefront, and price and title must be visible before purchase. material_path is a
-- Storage key, useless without a signed URL, which the server issues only on entitlement.
create policy lessons_read_published on custom_lessons for select to authenticated
  using (published or author_id = auth.uid() or is_admin());
create policy lessons_write_own on custom_lessons for all to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- custom_tasks: authors and admins only. Students never read this table; they receive
-- tasks through /api/lesson-content, which strips answer_index and checks entitlement.
create policy tasks_author_only on custom_tasks for all to authenticated
  using (owns_lesson(lesson_id) or is_admin()) with check (owns_lesson(lesson_id));

-- orders and entitlements: readable by the buyer, writable by no one. The webhook uses
-- the service role, which is not subject to these policies.
create policy orders_read_own on orders for select to authenticated
  using (student_id = auth.uid() or is_admin());
create policy entitlements_read_own on entitlements for select to authenticated
  using (student_id = auth.uid() or is_admin());

-- submissions: a student writes their own; the lesson's author reads and grades.
create policy submissions_read on lesson_submissions for select to authenticated
  using (student_id = auth.uid() or owns_lesson(lesson_id) or is_admin());
-- Entitlements are only ever written for a lesson somebody paid for, so requiring one here
-- made a FREE mentor lesson impossible to submit: there is no row and there never will be.
-- A lesson priced at zero is open to anyone who can see it, which is what published means.
create policy submissions_insert_own on lesson_submissions for insert to authenticated
  with check (
    student_id = auth.uid()
    and (
      has_entitlement(lesson_id)
      or exists (select 1 from custom_lessons l where l.id = lesson_id and l.published and l.price_cents <= 0)
    )
  );
create policy submissions_grade on lesson_submissions for update to authenticated
  using (owns_lesson(lesson_id)) with check (owns_lesson(lesson_id));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Both buckets are private. mentor-docs holds identity documents: it is readable only by
-- admins reviewing an application, through short-lived signed URLs, and never listed.

insert into storage.buckets (id, name, public) values
  ('lesson-materials', 'lesson-materials', false),
  ('mentor-docs', 'mentor-docs', false)
on conflict (id) do nothing;

-- Storage policies are wrapped for two reasons.
--
-- Re-running: `create policy` has no `if not exists`, so a second run of this file would
-- abort partway through. Dropping first makes the migration idempotent, which matters
-- because the usual way to apply it is pasting into the SQL editor and running it again
-- after fixing something.
--
-- Ownership: storage.objects belongs to the storage extension, and on some projects the
-- SQL editor's role cannot add policies to it. That failure is recoverable — the buckets
-- are already private, so the only loss is per-user path isolation, which can be set from
-- Dashboard > Storage > Policies. Raising a notice beats aborting the whole migration and
-- leaving the database half-built.

do $$
begin
  drop policy if exists material_upload on storage.objects;
  drop policy if exists material_manage_own on storage.objects;
  drop policy if exists material_delete_own on storage.objects;
  drop policy if exists docs_upload_own on storage.objects;
  drop policy if exists docs_read_admin on storage.objects;

  -- Mentors upload material under their own user id prefix.
  create policy material_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'lesson-materials' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy material_manage_own on storage.objects for update to authenticated
    using (bucket_id = 'lesson-materials' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy material_delete_own on storage.objects for delete to authenticated
    using (bucket_id = 'lesson-materials' and (storage.foldername(name))[1] = auth.uid()::text);

  -- Identity documents: the applicant may upload, only an admin may read.
  create policy docs_upload_own on storage.objects for insert to authenticated
    with check (bucket_id = 'mentor-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy docs_read_admin on storage.objects for select to authenticated
    using (bucket_id = 'mentor-docs' and is_admin());
exception
  when insufficient_privilege then
    raise notice 'Could not create storage policies (insufficient privilege). The buckets are still private; add the policies from Dashboard > Storage > Policies.';
end $$;
