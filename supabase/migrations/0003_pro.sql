-- Pro, and monthly limits per plan.
--
-- memberships says who is Pro and until when. Only the Lemon Squeezy webhook writes it, with
-- the service role; a person may read their own row, to see their plan.
--
-- usage_monthly replaces usage_daily (0002): the plans are sold per month, so they are counted
-- per month. take_quota reads the plan and takes a unit in one call, and says which plan the
-- unit came from, or that the plan's month is used up.

create table if not exists memberships (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  status             text not null,
  -- Pro while this is in the future. Null when the subscription gives nothing.
  pro_until          timestamptz,
  ls_subscription_id text unique,
  updated_at         timestamptz not null default now()
);

alter table memberships enable row level security;
revoke all on memberships from anon, authenticated;
grant select (user_id, status, pro_until) on memberships to authenticated;
drop policy if exists memberships_own on memberships;
create policy memberships_own on memberships for select to authenticated using (user_id = auth.uid());

create table if not exists usage_monthly (
  user_id uuid    not null references auth.users (id) on delete cascade,
  month   date    not null,
  kind    text    not null check (kind in ('kit', 'copy', 'image')),
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, month, kind)
);

alter table usage_monthly enable row level security;
revoke all on usage_monthly from anon, authenticated;
grant select (user_id, month, kind, used) on usage_monthly to authenticated;
drop policy if exists usage_monthly_own on usage_monthly;
create policy usage_monthly_own on usage_monthly for select to authenticated using (user_id = auth.uid());

-- One unit of `what` for this month (UTC). Returns 'free' or 'pro' when taken, and
-- 'free_full' or 'pro_full' when that plan's month is used up. One upsert, so two requests at
-- the same moment cannot both take the last unit.
create or replace function take_quota(who uuid, what text, free_cap integer, pro_cap integer)
returns text language plpgsql set search_path = public as $$
declare
  pro boolean := exists (select 1 from memberships where user_id = who and pro_until > now());
  this_month date := date_trunc('month', now() at time zone 'utc')::date;
  taken boolean;
begin
  insert into usage_monthly as u (user_id, month, kind, used)
  values (who, this_month, what, 1)
  on conflict (user_id, month, kind) do update set used = u.used + 1
    where u.used < (case when pro then pro_cap else free_cap end)
  returning true into taken;
  return (case when pro then 'pro' else 'free' end) || (case when taken then '' else '_full' end);
end $$;

-- Hands back a unit taken for a request the model then failed.
create or replace function give_back_quota(who uuid, what text)
returns void language sql set search_path = public as $$
  update usage_monthly set used = used - 1
  where user_id = who and month = date_trunc('month', now() at time zone 'utc')::date and kind = what and used > 0
$$;

revoke execute on function take_quota(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function give_back_quota(uuid, text) from public, anon, authenticated;
grant execute on function take_quota(uuid, text, integer, integer) to service_role;
grant execute on function give_back_quota(uuid, text) to service_role;
