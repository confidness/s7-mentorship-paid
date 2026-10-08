-- A daily allowance for the AI mentor, counted per account.
--
-- `api/mentor.ts` asks who is calling and then spends a provider key for them. That closed the
-- anonymous hole and left the ordinary one: registration is open, so an account costs nothing,
-- and a signed-in loop can run the bill up as fast as the provider will answer. `MAX_TOKENS`
-- and the input cap bound one call, not the total. Something has to count, and it has to count
-- in the database — a Vercel function keeps no memory between invocations, so a counter held
-- there would reset on every cold start and differ across every instance.
--
-- The count lives in one row per account per UTC day, and the route spends one unit before it
-- calls the provider. Over the line, the route does not call it at all and the client answers
-- from its built-in knowledge base instead, so a student who has used their day still gets help.
--
-- ---------------------------------------------------------------------------
-- Why a function, and why it runs with the owner's rights
-- ---------------------------------------------------------------------------
-- "Read the count, compare, write the count" is three steps, and two requests arriving
-- together both read 39 and both pass. The only safe shape is one statement that increments
-- *and* checks — an insert that, on conflict, updates only while the count is under the limit.
-- That statement lives in `consume_ai_quota`.
--
-- It is `security definer` because the table below deliberately lets nobody write it directly:
-- a row an account can update is a counter an account can reset. The function is the single
-- door in, and it takes the account from `auth.uid()` rather than from an argument, so a caller
-- can spend only their own allowance — there is no user id to pass, and so none to forge.
-- `set search_path = ''` and fully qualified names are Supabase's rule for definer functions:
-- with a search path an attacker can write to, a definer function can be made to resolve a
-- name to something else.
--
-- The limit is an argument rather than a constant so it can be tuned from the deployment's
-- environment without a migration. A caller who invokes this directly with a small limit can
-- only use up their own day faster; the route is what passes the real number.

-- ---------------------------------------------------------------------------
-- ai_usage
-- ---------------------------------------------------------------------------
-- UTC, not the student's local midnight: one boundary for everyone, and the same one the
-- function uses, so the row and the reset can never disagree. Old days are history and cost
-- a few bytes each; delete them whenever, nothing reads any day but today's.

create table if not exists ai_usage (
  user_id uuid not null references profiles (id) on delete cascade,
  day     date not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- You can see your own count and nothing else. There is no insert, update or delete policy, and
-- the grants are revoked as well as the policies withheld: RLS is the lock, the revoke is the
-- second lock, and `consume_ai_quota` is the only key.

drop policy if exists ai_usage_read_own on ai_usage;

alter table ai_usage enable row level security;

create policy ai_usage_read_own on ai_usage for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on ai_usage from anon, authenticated;

-- ---------------------------------------------------------------------------
-- consume_ai_quota — spend one unit if there is one left
-- ---------------------------------------------------------------------------
-- True: a unit was spent, go ahead. False: the day is used up, or there is nobody to charge.
--
-- The first call of the day inserts a row with 1. Every later call collides with it and goes to
-- `do update`, whose `where` is the whole limit: when the count has already reached it the
-- update is skipped, no row comes back from `returning`, and `after_count` stays null. A refused
-- call changes nothing, so hammering a spent account does not push the count anywhere.
--
-- `daily_limit < 1` refuses outright. Without that, the insert branch would grant the first
-- call of the day whatever the limit said, and a limit of zero would mean one.

create or replace function public.consume_ai_quota(daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := auth.uid();
  after_count integer;
begin
  if caller is null or daily_limit is null or daily_limit < 1 then
    return false;
  end if;

  insert into public.ai_usage as u (user_id, day, used)
  values (caller, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set used = u.used + 1
    where u.used < daily_limit
  returning u.used into after_count;

  return after_count is not null;
end $$;

-- Signed-in accounts only. Postgres grants execute on a new function to everyone by default, and
-- Supabase additionally grants it to `anon` on its own, so both are revoked by name — dropping
-- `public` alone would leave the anonymous role able to call it.
revoke all on function public.consume_ai_quota(integer) from public, anon;
grant execute on function public.consume_ai_quota(integer) to authenticated;
