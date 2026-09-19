-- Projects and the reviews of them.
--
-- The review loop is the product's core claim — a real person reads your work — and until now
-- it ran entirely in one browser. A mentor could only see projects submitted from the same
-- browser they were reviewing in, which is to say: never, since the student uses their own.
--
-- This is shaped differently from 0002 on purpose. Progress is a grow-only set belonging to
-- one learner, so it syncs as idempotent operations. A project is a document that two people
-- take turns writing to: the student submits and resubmits it, the mentor claims it and
-- decides on it. Operations would need a merge rule for every field; rows with a clear owner
-- per column do not.

do $$ begin
  create type project_status as enum ('draft', 'submitted', 'under_review', 'approved', 'needs_changes');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
-- `course_id` and `lesson_id` are text and not foreign keys for the same reason as in 0002:
-- lessons live in code or in custom_lessons, and a constraint here would have to choose one.
--
-- Attachments are jsonb rather than a table. They are read only as a whole, always with their
-- project, and never queried across projects — a join would buy nothing.

create table if not exists projects (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references profiles (id) on delete cascade,
  title        text not null,
  description  text not null default '',
  code         text not null default '',
  notes        text not null default '',
  course_id    text not null default '',
  lesson_id    text not null default '',
  attachments  jsonb not null default '[]'::jsonb,
  tags         text[] not null default '{}',
  status       project_status not null default 'draft',
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  reviewer_id  uuid references profiles (id),
  likes        integer not null default 0 check (likes >= 0),
  views        integer not null default 0 check (views >= 0)
);

-- The review queue: what is waiting, oldest first.
create index if not exists projects_queue on projects (submitted_at) where status in ('submitted', 'under_review');
create index if not exists projects_by_author on projects (author_id, created_at desc);
-- The public gallery only ever shows approved work.
create index if not exists projects_approved on projects (reviewed_at desc) where status = 'approved';

-- ---------------------------------------------------------------------------
-- project_feedback
-- ---------------------------------------------------------------------------
-- Append-only, and deliberately so. A review is a record of what somebody said at a moment,
-- and a student who has read it should not find it edited afterwards. Requesting changes and
-- then approving leaves two rows, which is the history of the project rather than a mistake.

do $$ begin
  create type review_decision as enum ('approved', 'needs_changes', 'comment');
exception when duplicate_object then null; end $$;

create table if not exists project_feedback (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  mentor_id  uuid not null references profiles (id) on delete cascade,
  decision   review_decision not null,
  message    text not null,
  -- Three axes any subject can be scored on. It used to be wiring, code and documentation,
  -- which assumed the subject was electronics.
  rubric     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists project_feedback_by_project on project_feedback (project_id, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

drop policy if exists projects_read on projects;
drop policy if exists projects_insert_own on projects;
drop policy if exists projects_update_own on projects;
drop policy if exists projects_review on projects;
drop policy if exists feedback_read on project_feedback;
drop policy if exists feedback_write_mentor on project_feedback;

alter table projects         enable row level security;
alter table project_feedback enable row level security;

-- Your own work, anything approved, and — for a mentor — everything. The gallery shows
-- approved work to everyone, which is what makes it a gallery.
create policy projects_read on projects for select to authenticated
  using (author_id = auth.uid() or status = 'approved' or is_mentor() or is_admin());

create policy projects_insert_own on projects for insert to authenticated
  with check (author_id = auth.uid() and status in ('draft', 'submitted') and reviewer_id is null and reviewed_at is null);

-- A student may edit their own work and hand it in. They may not decide on it: `status` is
-- pinned to the states they are allowed to put it in, and the reviewer columns to null.
-- Approving your own project would otherwise be one PATCH away.
create policy projects_update_own on projects for update to authenticated
  using (author_id = auth.uid() and status in ('draft', 'submitted', 'needs_changes'))
  with check (author_id = auth.uid() and status in ('draft', 'submitted') and reviewer_id is null and reviewed_at is null);

-- A mentor may claim and decide, and nothing else. The work itself is not theirs to rewrite,
-- but Postgres has no per-column update policy — so the route, not this policy, is what keeps
-- a mentor off the body of the work, and the route is the only thing holding a service role.
create policy projects_review on projects for update to authenticated
  using (is_mentor() and status in ('submitted', 'under_review'))
  with check (is_mentor());

create policy feedback_read on project_feedback for select to authenticated
  using (
    is_mentor()
    or is_admin()
    or exists (select 1 from projects p where p.id = project_id and p.author_id = auth.uid())
  );

-- Only a mentor writes a review, and only under their own name.
create policy feedback_write_mentor on project_feedback for insert to authenticated
  with check (mentor_id = auth.uid() and is_mentor());

-- No update and no delete on feedback, for anybody. See the note above the table.
