-- Brandyzer: the baseline schema, for a fresh Supabase project.
--
-- Two products share one account. Studio turns a description of a business into a brand kit
-- and writes and draws in that brand's voice. Bazaar is where a business hires a freelancer
-- and hands over that kit with the job, so the person doing the work starts from the brand
-- rather than from a blank page and a guess.
--
-- The rule carried over from the codebase this grew out of: the client may cache a decision,
-- never make one. Anything that moves money, or decides who may read somebody else's brand,
-- is written by the server with the service role — the browser can read it and nothing more.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helpers that table constraints need, so they come first
-- ---------------------------------------------------------------------------

-- Every URL this schema stores is rendered as a link or an image by somebody other than the
-- person who typed it. `javascript:` in an href is script running in the reader's session,
-- so the database refuses anything that is not plain https rather than trusting every
-- renderer to remember to.
create or replace function all_https(urls text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(bool_and(u ~ '^https://[^[:space:]]{1,500}$'), true) from unnest(urls) as u
$$;

create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- `role` is a capability somebody chooses, not a status anybody grants: a client hires, a
-- freelancer sells, `both` does both. It decides which tools are shown and whether a service
-- may be listed, and nothing else — it is never authority over another person's rows. Taking
-- money has its own gate, and it is Stripe's: `stripe_transfers_active`.
--
-- The Stripe columns are written only by the server. stripe_connect_id decides where a
-- client's money goes, so a browser that could write it could redirect a payout.

create table if not exists profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 120),
  avatar                  text not null default '' check (char_length(avatar) <= 4),
  bio                     text check (bio is null or char_length(bio) <= 2000),
  role                    text not null default 'client' check (role in ('client', 'freelancer', 'both')),
  -- Set by a database operator, never by anything the client can post.
  is_admin                boolean not null default false,
  stripe_customer_id      text unique,
  stripe_connect_id       text unique,
  -- Stripe's answer to "can this account receive transfers", cached for the directory. The
  -- hire route asks Stripe again before taking money; this copy is for display.
  stripe_transfers_active boolean not null default false,
  created_at              timestamptz not null default now()
);

-- Created by Auth, not by the client: letting a browser insert its own row would let it
-- choose its own is_admin. The role it asked for at signup is honoured, because a role here
-- grants nothing that switching it later in settings would not.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted  text := new.raw_user_meta_data ->> 'role';
  display text := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'New member'
  );
begin
  insert into public.profiles (id, name, avatar, role)
  values (
    new.id,
    left(display, 120),
    upper(left(display, 2)),
    case when wanted in ('client', 'freelancer', 'both') then wanted else 'client' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- brand_kits
-- ---------------------------------------------------------------------------
-- The JSON columns are shaped by src/lib/brand.ts, which is the one place that knows what a
-- palette or a set of voice rules looks like. The database checks only what it can check
-- cheaply and must never get wrong: the outer type, and a size ceiling so a browser with
-- write access cannot park a megabyte in a row.
--
-- business_json keeps what the owner told us about the business. Copy is written for a
-- business, not for a palette, and asking them again every time would be the tool's fault.

create table if not exists brand_kits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  brand_name       text not null check (char_length(brand_name) between 1 and 120),
  vibe_summary     text not null default '' check (char_length(vibe_summary) <= 2000),
  business_json    jsonb not null default '{}'::jsonb check (jsonb_typeof(business_json) = 'object' and pg_column_size(business_json) <= 8192),
  palette_json     jsonb not null default '[]'::jsonb check (jsonb_typeof(palette_json) = 'array' and pg_column_size(palette_json) <= 8192),
  typography_json  jsonb not null default '{}'::jsonb check (jsonb_typeof(typography_json) = 'object' and pg_column_size(typography_json) <= 8192),
  voice_rules_json jsonb not null default '{}'::jsonb check (jsonb_typeof(voice_rules_json) = 'object' and pg_column_size(voice_rules_json) <= 16384),
  logo_url         text check (logo_url is null or (logo_url ~ '^https://' and char_length(logo_url) <= 1000)),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Lets a contract prove, in the schema, that the kit it shares belongs to the client.
  unique (id, user_id)
);

create index if not exists brand_kits_user on brand_kits (user_id, created_at desc);

drop trigger if exists brand_kits_touch on brand_kits;
create trigger brand_kits_touch before update on brand_kits for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- bazaar_services
-- ---------------------------------------------------------------------------
-- Money is integer minor units throughout — a float does not hold 0.1 exactly, and a fee
-- computed from one is short by somebody's cent. Hence price_usd_cents rather than price_usd.
--
-- The floor is a sanity check, not pricing advice: below a few dollars Stripe's fixed fee is
-- most of the sale.

create table if not exists bazaar_services (
  id              uuid primary key default gen_random_uuid(),
  freelancer_id   uuid not null references profiles (id) on delete cascade,
  title           text not null check (char_length(title) between 3 and 120),
  description     text not null default '' check (char_length(description) <= 4000),
  price_usd_cents integer not null check (price_usd_cents between 500 and 5000000),
  delivery_days   integer not null check (delivery_days between 1 and 180),
  portfolio_urls  text[] not null default '{}' check (cardinality(portfolio_urls) <= 12 and all_https(portfolio_urls)),
  -- Pausing, not deleting, is how a service with history leaves the directory: contracts
  -- point at it, and the foreign key below refuses to let that history dangle.
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists bazaar_services_freelancer on bazaar_services (freelancer_id);
create index if not exists bazaar_services_active on bazaar_services (created_at desc) where active;

drop trigger if exists bazaar_services_touch on bazaar_services;
create trigger bazaar_services_touch before update on bazaar_services for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- bazaar_contracts
-- ---------------------------------------------------------------------------
-- One hire. Written only by the server: the hire route creates it, the Stripe webhook funds
-- it, and the contracts route moves it through review. No browser holds a write right here.
--
--   pending    checkout started, nothing paid
--   funded     Stripe confirmed the money; the work is on
--   in_review  the freelancer delivered; the client is looking
--   completed  the client accepted the work
--   canceled   checkout expired or the payment failed before any money moved
--   refunded   the money went back
--
-- "Active", for the brand kit rule, means funded or in_review: paid for and not yet finished.
--
-- The title, the delivery time and all three amounts are copied at hire time. A freelancer
-- may reprice or reword a service tomorrow; what this client agreed to pay for stays put.

create table if not exists bazaar_contracts (
  id                         uuid primary key default gen_random_uuid(),
  client_id                  uuid not null references profiles (id) on delete restrict,
  freelancer_id              uuid not null references profiles (id) on delete restrict,
  service_id                 uuid not null references bazaar_services (id) on delete restrict,
  brand_kit_id               uuid,
  service_title              text not null,
  delivery_days              integer not null,
  brief                      text not null default '' check (char_length(brief) <= 4000),
  currency                   text not null default 'usd' check (currency = 'usd'),
  total_amount_cents         integer not null check (total_amount_cents > 0),
  platform_fee_cents         integer not null check (platform_fee_cents >= 0),
  freelancer_payout_cents    integer not null check (freelancer_payout_cents >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  status                     text not null default 'pending'
                             check (status in ('pending', 'funded', 'in_review', 'completed', 'canceled', 'refunded')),
  delivery_note              text check (delivery_note is null or char_length(delivery_note) <= 4000),
  delivery_url               text check (delivery_url is null or (delivery_url ~ '^https://' and char_length(delivery_url) <= 1000)),
  created_at                 timestamptz not null default now(),
  funded_at                  timestamptz,
  delivered_at               timestamptz,
  completed_at               timestamptz,
  updated_at                 timestamptz not null default now(),

  -- The books have to add up in the row itself, not only in the code that wrote it.
  constraint split_adds_up check (platform_fee_cents + freelancer_payout_cents = total_amount_cents),
  constraint not_hiring_yourself check (client_id <> freelancer_id),

  -- The kit a contract shares must be the client's own. Without this, a client and a
  -- freelancer working together could name somebody else's kit id on a contract and the read
  -- rule below would hand it over. A composite key makes that unrepresentable rather than
  -- merely checked. Deleting the kit clears only this column (Postgres 15+).
  constraint kit_belongs_to_client foreign key (brand_kit_id, client_id)
    references brand_kits (id, user_id) on delete set null (brand_kit_id)
);

create index if not exists bazaar_contracts_client on bazaar_contracts (client_id, created_at desc);
create index if not exists bazaar_contracts_freelancer on bazaar_contracts (freelancer_id, created_at desc);
create index if not exists bazaar_contracts_kit on bazaar_contracts (brand_kit_id) where brand_kit_id is not null;

drop trigger if exists bazaar_contracts_touch on bazaar_contracts;
create trigger bazaar_contracts_touch before update on bazaar_contracts for each row execute function touch_updated_at();

-- One open checkout per client per service. Two tabs, or a back button and a second click,
-- would otherwise open two Checkout Sessions for one job, and both can be paid. The hire
-- route resumes the open one instead; this index is what makes a race lose rather than charge.
create unique index if not exists bazaar_contracts_one_pending on bazaar_contracts (client_id, service_id) where status = 'pending';

-- A kit on an open contract is the freelancer's working brief. Deleting it mid-job would null
-- the contract's reference and close the kit to the person paid to use it, so the database
-- refuses with a reason, rather than a policy that would quietly delete nothing.
create or replace function keep_shared_kits()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from bazaar_contracts c where c.brand_kit_id = old.id and c.status in ('funded', 'in_review')) then
    raise exception 'This brand kit is shared on an open contract and cannot be deleted until that work is finished.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace trigger brand_kits_keep_shared before delete on brand_kits for each row execute function keep_shared_kits();

-- ---------------------------------------------------------------------------
-- predicates the policies use
-- ---------------------------------------------------------------------------
-- security definer so a policy on one table can look at another without that table's own
-- policies recursing back into this one.

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false)
$$;

create or replace function is_freelancer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('freelancer', 'both') from profiles p where p.id = auth.uid()), false)
$$;

-- The dynamic read rule: a freelancer sees a client's kit while a paid contract for it is
-- open. Not when the hire is merely pending — nobody has paid for anything yet — and not
-- after completion or a refund, when the engagement that justified the access is over.
create or replace function shares_brand_kit(kit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bazaar_contracts c
    where c.brand_kit_id = kit
      and c.freelancer_id = auth.uid()
      and c.status in ('funded', 'in_review')
  )
$$;

-- ---------------------------------------------------------------------------
-- Row level security, and the columns each role may touch
-- ---------------------------------------------------------------------------
-- Postgres has no per-column policy. Policies decide which rows; column privileges decide
-- which fields. Supabase grants every table to anon and authenticated by default, so each
-- table below is taken back first and then given exactly what it needs.

drop policy if exists profiles_read on profiles;
drop policy if exists profiles_update_self on profiles;
drop policy if exists brand_kits_owner on brand_kits;
drop policy if exists brand_kits_shared on brand_kits;
drop policy if exists services_read on bazaar_services;
drop policy if exists services_insert_own on bazaar_services;
drop policy if exists services_update_own on bazaar_services;
drop policy if exists services_delete_own on bazaar_services;
drop policy if exists contracts_read_party on bazaar_contracts;

alter table profiles         enable row level security;
alter table brand_kits       enable row level security;
alter table bazaar_services  enable row level security;
alter table bazaar_contracts enable row level security;

revoke all on profiles, brand_kits, bazaar_services, bazaar_contracts from anon;

-- profiles: names and roles are public to members (they appear on services and contracts).
-- The Stripe ids and the admin flag are not selectable at all from a browser.
create policy profiles_read on profiles for select to authenticated using (true);
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on profiles from authenticated;
grant select (id, name, avatar, bio, role, stripe_transfers_active, created_at) on profiles to authenticated;
grant update (name, avatar, bio, role) on profiles to authenticated;

-- brand_kits: the owner reads and writes their own; a freelancer on an active contract reads.
create policy brand_kits_owner on brand_kits for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy brand_kits_shared on brand_kits for select to authenticated
  using (shares_brand_kit(id));

revoke insert, update on brand_kits from authenticated;
grant insert (user_id, brand_name, vibe_summary, business_json, palette_json, typography_json, voice_rules_json, logo_url)
  on brand_kits to authenticated;
grant update (brand_name, vibe_summary, business_json, palette_json, typography_json, voice_rules_json, logo_url)
  on brand_kits to authenticated;

-- bazaar_services: the directory is every active service; a freelancer manages their own.
-- Listing needs the freelancer role — a capability, self-chosen, and checked here so the
-- directory only holds people who said they sell.
create policy services_read on bazaar_services for select to authenticated
  using (active or freelancer_id = auth.uid() or is_admin());
create policy services_insert_own on bazaar_services for insert to authenticated
  with check (freelancer_id = auth.uid() and is_freelancer());
create policy services_update_own on bazaar_services for update to authenticated
  using (freelancer_id = auth.uid()) with check (freelancer_id = auth.uid());
create policy services_delete_own on bazaar_services for delete to authenticated
  using (freelancer_id = auth.uid());

revoke insert, update on bazaar_services from authenticated;
grant insert (freelancer_id, title, description, price_usd_cents, delivery_days, portfolio_urls, active)
  on bazaar_services to authenticated;
grant update (title, description, price_usd_cents, delivery_days, portfolio_urls, active)
  on bazaar_services to authenticated;

-- bazaar_contracts: both parties read; nobody writes from a browser. There is deliberately
-- no insert, update or delete policy, and no grant to go with one.
create policy contracts_read_party on bazaar_contracts for select to authenticated
  using (client_id = auth.uid() or freelancer_id = auth.uid() or is_admin());

revoke insert, update, delete on bazaar_contracts from authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
-- Everything in `public` is reachable at /rest/v1/rpc/<name>, and Supabase grants EXECUTE to
-- anon and authenticated by default. The trigger functions are nobody's to call. The three
-- policy predicates have to stay executable by `authenticated` — row level security runs
-- them as the caller — and each answers only a question about that caller; a visitor who is
-- not signed in has no use for any of them.

revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function touch_updated_at() from public, anon, authenticated;
revoke execute on function keep_shared_kits() from public, anon, authenticated;
revoke execute on function is_admin() from public, anon;
revoke execute on function is_freelancer() from public, anon;
revoke execute on function shares_brand_kit(uuid) from public, anon;
revoke execute on function all_https(text[]) from public, anon;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Generated logos and images. Public, because a logo is a public thing by nature and a
-- freelancer on a contract needs to load it — but not listable: there is no select policy on
-- storage.objects, so a URL is reachable only by somebody who was given it. Paths are
-- `<user id>/<random uuid>.<ext>`, written by the server with the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
