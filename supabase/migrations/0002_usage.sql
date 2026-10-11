-- Daily caps on the Studio's AI routes.
--
-- Every brand kit, copy request and image spends an allowance the whole site shares: Gemini's
-- free tier and Pollinations' Quest Pollen. Without a cap one account, or one bot, empties it
-- for everybody. A route takes one unit before it calls a model and gives it back if the model
-- fails, so a timeout does not cost the owner a day's kit.
--
-- Service role only. The server takes and returns units; no browser can read, reset or spend
-- them, which is why there is no policy and no grant to authenticated.

create table if not exists usage_daily (
  user_id uuid    not null references auth.users (id) on delete cascade,
  day     date    not null,
  kind    text    not null check (kind in ('kit', 'copy', 'image')),
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, day, kind)
);

alter table usage_daily enable row level security;
revoke all on usage_daily from anon, authenticated;

-- Takes one unit of `what` for today (UTC) if fewer than `cap` are used; true when taken.
-- One upsert, so two requests at the same moment cannot both take the last unit.
create or replace function take_usage(who uuid, what text, cap integer)
returns boolean language sql set search_path = public as $$
  insert into usage_daily as u (user_id, day, kind, used)
  values (who, (now() at time zone 'utc')::date, what, 1)
  on conflict (user_id, day, kind) do update set used = u.used + 1 where u.used < cap
  returning true
$$;

-- Hands back a unit taken for a request the model then failed.
create or replace function give_back_usage(who uuid, what text)
returns void language sql set search_path = public as $$
  update usage_daily set used = used - 1
  where user_id = who and day = (now() at time zone 'utc')::date and kind = what and used > 0
$$;

revoke execute on function take_usage(uuid, text, integer) from public, anon, authenticated;
revoke execute on function give_back_usage(uuid, text) from public, anon, authenticated;
grant execute on function take_usage(uuid, text, integer) to service_role;
grant execute on function give_back_usage(uuid, text) to service_role;
