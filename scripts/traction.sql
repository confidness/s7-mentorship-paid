-- Traction numbers for a pitch. Paste into Supabase → SQL Editor and run.
-- copy_requests and images count the current month only (usage_monthly resets on the 1st).
select
  (select count(*) from auth.users) as signups,
  (select count(*) from auth.users where created_at > now() - interval '7 days') as signups_7d,
  (select count(distinct user_id) from brand_kits) as users_with_a_kit,
  (select count(*) from brand_kits) as kits,
  (select coalesce(sum(used), 0) from usage_monthly where kind = 'copy' and month = date_trunc('month', now())::date) as copy_requests,
  (select coalesce(sum(used), 0) from usage_monthly where kind = 'image' and month = date_trunc('month', now())::date) as images,
  (select count(*) from memberships where pro_until > now()) as pro_now;
