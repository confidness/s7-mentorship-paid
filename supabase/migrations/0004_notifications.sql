-- Notifications that one person causes for another.
--
-- Every notification in this app is created by a pure reducer, in the browser of whoever
-- performed the action. That works exactly once: when the person who acts and the person who
-- is told are the same. "You unlocked an achievement" is written in the browser that unlocked
-- it, and is right there for its only reader.
--
-- The ones that matter most are the other kind. A mentor approves a project and `notify()`
-- writes a row addressed to the student — into the mentor's localStorage, where the student
-- will never be. The review loop is the product's core claim, and its ending was invisible.
--
-- So this table deliberately does not hold every notification. It holds the ones that cross
-- from one account to another, and the client merges them with the local ones on load. Two
-- sources with no overlap and no merge rule: a row lands here only because a route put it
-- here on someone else's behalf, and those are exactly the rows a reducer cannot deliver.

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  -- Dictionary keys, not sentences — the same discipline as the client's Notification type.
  -- The reader's language is not known when the row is written, and may change afterwards.
  title      text not null,
  body       text not null,
  vars       jsonb not null default '{}'::jsonb,
  kind       text not null,
  href       text,
  created_at timestamptz not null default now(),
  -- When, not whether. A timestamp costs the same as a boolean and answers more later.
  read_at    timestamptz
);

-- The only query there is: this person's inbox, newest first.
create index if not exists notifications_inbox on notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

drop policy if exists notifications_read_own on notifications;
drop policy if exists notifications_write_staff on notifications;
drop policy if exists notifications_mark_read on notifications;

alter table notifications enable row level security;

create policy notifications_read_own on notifications for select to authenticated
  using (user_id = auth.uid());

-- Writing a row for somebody else is the whole point, so the check cannot be
-- `user_id = auth.uid()`. It is limited instead to the two roles that act on other people:
-- a mentor deciding on work, an admin deciding on an application. A student has no reason to
-- put anything in anyone's inbox, including their own — their notifications are local.
create policy notifications_write_staff on notifications for insert to authenticated
  with check (is_mentor() or is_admin());

-- Marking your own as read. Postgres cannot pin this to `read_at` alone — policies apply to
-- a row, not a column — so the route is what keeps it to that one field. Rewriting the text
-- of a notification addressed to you is a lie you tell yourself, which is why this is left
-- to the route rather than given a service role.
create policy notifications_mark_read on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No delete policy. An inbox that can be emptied invisibly is worse than one that grows.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- The bell should ring while the page is open, not on the next reload. Realtime replays this
-- table's changes over the socket the client already holds, and it honours the policies above
-- — a subscriber is only sent rows `notifications_read_own` would have let them select — so
-- the feed needs no filter of its own to be safe.
--
-- Wrapped because the publication may already carry the table, and on a project where
-- Realtime was never enabled it may not exist at all. Neither is a reason to fail a
-- migration whose actual work is the table above.
do $$ begin
  alter publication supabase_realtime add table notifications;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'supabase_realtime publication not found; live notifications stay off';
end $$;
