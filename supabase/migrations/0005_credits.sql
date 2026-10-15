-- One-time $3 purchases: +1 website (permanent) and +20 images (spent after the monthly
-- allowance runs out). Only the Lemon Squeezy webhook, as service_role, changes them.

create table if not exists credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sites   integer not null default 0 check (sites >= 0),
  images  integer not null default 0 check (images >= 0)
);
alter table credits enable row level security;
create policy "members read their own credits" on credits for select to authenticated using (user_id = auth.uid());
revoke all on credits from anon, authenticated;
grant select on credits to authenticated;

-- Every order credited once: a redelivered webhook finds its order here and changes nothing.
create table if not exists credit_orders (
  order_id   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('site', 'images')),
  refunded   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table credit_orders enable row level security;
revoke all on credit_orders from anon, authenticated;

create or replace function add_credit(who uuid, what text, n integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into credits (user_id) values (who) on conflict (user_id) do nothing;
  if what = 'site' then
    update credits set sites = greatest(0, sites + n) where user_id = who;
  elsif what = 'images' then
    update credits set images = greatest(0, images + n) where user_id = who;
  else
    raise exception 'unknown credit %', what;
  end if;
end $$;

create or replace function spend_image_credit(who uuid) returns boolean
language sql security definer set search_path = public as $$
  with spent as (update credits set images = images - 1 where user_id = who and images > 0 returning 1)
  select exists (select 1 from spent);
$$;

revoke execute on function add_credit(uuid, text, integer) from public, anon, authenticated;
revoke execute on function spend_image_credit(uuid) from public, anon, authenticated;
grant execute on function add_credit(uuid, text, integer) to service_role;
grant execute on function spend_image_credit(uuid) to service_role;

-- A bought website raises the cap for good.
drop policy if exists "owners publish within their plan" on sites;
create policy "owners publish within their plan" on sites for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from brand_kits k where k.id = kit_id and k.user_id = auth.uid())
  and (select count(*) from sites s where s.user_id = auth.uid())
      < case when exists (select 1 from memberships m where m.user_id = auth.uid() and m.pro_until > now()) then 10 else 1 end
        + coalesce((select c.sites from credits c where c.user_id = auth.uid()), 0)
);
