-- The demand board: what people want taught, before anybody has taught it.
--
-- Every marketplace starts empty, and the usual way out is to buy the first courses. This
-- platform cannot, so it inverts the order instead: a student publishes what they want to
-- learn, other people vote on it, and a mentor answers a brief that already has an audience
-- attached. A request with forty votes is a course with forty people waiting for it.
--
-- Deliberately not an escrow. `budget_cents` is what the asker says they would pay, and no
-- money is held against it — a pledge would need live Stripe, refunds, and a policy for the
-- mentor who delivers something nobody wanted after all. Stating a budget costs nothing and
-- tells a mentor most of what they need to decide.

do $$ begin
  create type request_status as enum ('open', 'fulfilled', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- course_requests
-- ---------------------------------------------------------------------------
-- There is no `direction` column. `directionOf()` in `src/lib/discovery.ts` reads a subject
-- off a title and a summary, and works on a request unchanged — so the board filters by the
-- same derivation the catalogue does. A stored field would be a second answer to the same
-- question, free text that never quite matches a `DirectionId`, and the file that derives it
-- says why: a filter nobody populates is a filter that returns nothing.
--
-- `votes` is a cached count maintained by trigger, exactly as `student_profiles.xp` caches
-- the ledger. The vote rows are the truth; this column exists so the board can be ordered
-- without counting a join on every read.

create table if not exists course_requests (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references profiles (id) on delete cascade,
  title        text not null check (char_length(title) between 4 and 140),
  body         text not null default '' check (char_length(body) <= 2000),
  -- Minor units, like every other amount here. 0 means "no budget stated", not "free".
  budget_cents integer not null default 0 check (budget_cents >= 0 and budget_cents <= 100000000),
  currency     char(3) not null default 'usd',
  deadline     date,
  status       request_status not null default 'open',
  votes        integer not null default 0 check (votes >= 0),
  created_at   timestamptz not null default now()
);

-- The board: what is still open, loudest first.
create index if not exists course_requests_board on course_requests (votes desc, created_at desc) where status = 'open';
create index if not exists course_requests_by_author on course_requests (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- course_request_votes
-- ---------------------------------------------------------------------------
-- One row per person per request, and the primary key is what enforces that — a second vote
-- collides rather than counting twice. Votes can be taken back, so unlike the XP ledger this
-- one allows delete; what it does not allow is update, because there is nothing in a vote to
-- change and an updatable row is a row that can be moved to somebody else's request.

create table if not exists course_request_votes (
  request_id uuid not null references course_requests (id) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

-- Recomputed, not incremented. A counter that adds and subtracts drifts the first time a
-- path is missed; a count over a table with a two-column primary key cannot disagree with
-- itself, and at board-sized row counts the subquery is free. `security definer` because the
-- voter does not own the request row and must not be able to write it directly — the grant
-- below revokes exactly that.
create or replace function course_request_votes_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.request_id, old.request_id);
begin
  update course_requests
     set votes = (select count(*) from course_request_votes v where v.request_id = target)
   where id = target;
  return coalesce(new, old);
end $$;

drop trigger if exists course_request_votes_count on course_request_votes;
create trigger course_request_votes_count
  after insert or delete on course_request_votes
  for each row execute function course_request_votes_apply();

-- ---------------------------------------------------------------------------
-- request_fulfilments
-- ---------------------------------------------------------------------------
-- A join table rather than a `fulfilled_lesson_id` column on the request, because both sides
-- are many: one course can answer several requests that were asking for the same thing, and
-- one request can be answered by more than one mentor — which is competition, and good.

create table if not exists request_fulfilments (
  request_id  uuid not null references course_requests (id) on delete cascade,
  lesson_id   uuid not null references custom_lessons (id) on delete cascade,
  mentor_id   uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Set the first time the voters are told. Non-null means: never again.
  announced_at timestamptz,
  primary key (request_id, lesson_id)
);

create index if not exists request_fulfilments_by_lesson on request_fulfilments (lesson_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

drop policy if exists requests_read on course_requests;
drop policy if exists requests_insert_own on course_requests;
drop policy if exists requests_update_own on course_requests;
drop policy if exists request_votes_read on course_request_votes;
drop policy if exists request_votes_insert_own on course_request_votes;
drop policy if exists request_votes_delete_own on course_request_votes;
drop policy if exists fulfilments_read on request_fulfilments;
drop policy if exists fulfilments_insert_own_lesson on request_fulfilments;

alter table course_requests      enable row level security;
alter table course_request_votes enable row level security;
alter table request_fulfilments  enable row level security;

-- The board is public to signed-in users. A demand board nobody can read is a suggestion box.
create policy requests_read on course_requests for select to authenticated using (true);

create policy requests_insert_own on course_requests for insert to authenticated
  with check (author_id = auth.uid() and status = 'open' and votes = 0);

-- The author may edit their own wording and withdraw it. They may not touch `votes`, and
-- the column grant below is what actually stops them — a policy applies to a row, not to a
-- column, so `with check` cannot express "every field but this one".
create policy requests_update_own on course_requests for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

revoke update on course_requests from authenticated;
-- `status` is absent on purpose: withdrawing goes through the route, which is also where a
-- request stops being announced. `votes` is absent because it is the trigger's, and
-- `author_id` and `created_at` because they are the row's identity.
grant update (title, body, budget_cents, deadline) on course_requests to authenticated;

-- Votes are readable so the interface can show what you already voted for. Who voted for
-- what is not sensitive here; that a request has support is the entire point of it.
create policy request_votes_read on course_request_votes for select to authenticated using (true);

create policy request_votes_insert_own on course_request_votes for insert to authenticated
  with check (user_id = auth.uid());

create policy request_votes_delete_own on course_request_votes for delete to authenticated
  using (user_id = auth.uid());

-- No update policy, and the right is revoked outright. There is nothing in a vote to change
-- — the whole row is its primary key — and an updatable vote is a vote that can be moved to
-- somebody else's request.
revoke update on course_request_votes from authenticated;

create policy fulfilments_read on request_fulfilments for select to authenticated using (true);

-- No insert policy for the browser at all.
--
-- Answering a request is not just a row: it notifies everyone who voted, with a link to the
-- answerer's lesson. That is a broadcast primitive with a marketing incentive attached, and
-- `notifications` has no delete policy — an announcement cannot be recalled. So it goes
-- through `api/requests.ts`, which holds the service role, checks `author_id` and
-- `published` on the lesson itself, and announces a given request exactly once.
--
-- `announced_at` is what makes "exactly once" a property of the data rather than of the
-- route: publish, unpublish and republish is otherwise an unlimited megaphone.
