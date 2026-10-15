-- Published websites. One per brand kit; Free accounts may have 1, Pro 10.
--
-- The html is rendered in the browser from the kit and stored as is, so a public page needs
-- nothing but this row: the kit itself stays private. It is served in a sandboxed iframe with
-- scripts off, so even html written straight into the table cannot run code on our origin.

create table if not exists sites (
  slug       text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kit_id     uuid not null unique references brand_kits (id) on delete cascade,
  content    jsonb not null default '{}',
  html       text not null check (char_length(html) <= 200000),
  updated_at timestamptz not null default now()
);

alter table sites enable row level security;

-- ponytail: anyone signed in can read every row's content and owner id, which is the public
-- page's own text plus a uuid. Split content into an owner-only table if that ever matters.
create policy "sites are public" on sites for select using (true);

create policy "owners publish within their plan" on sites for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from brand_kits k where k.id = kit_id and k.user_id = auth.uid())
  and (select count(*) from sites s where s.user_id = auth.uid())
      < case when exists (select 1 from memberships m where m.user_id = auth.uid() and m.pro_until > now()) then 10 else 1 end
);

create policy "owners update their sites" on sites for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from brand_kits k where k.id = kit_id and k.user_id = auth.uid()));

create policy "owners delete their sites" on sites for delete to authenticated using (user_id = auth.uid());

revoke all on sites from anon, authenticated;
grant select (slug, html) on sites to anon;
grant select, insert, update, delete on sites to authenticated;
