-- A profile for every account that signed up before there was a trigger to make one.
--
-- 0001 creates a profile when an account is created, from a trigger on auth.users. A trigger only
-- sees rows inserted after it exists, so on a project where people signed up first and the
-- migrations ran later, those accounts have a login and no profile. Sign-in still works — the
-- client falls back to the email for a name — which is what makes the gap easy to miss. Everything
-- that hangs off the profile does not: progress and XP, projects, hand-ins, notifications and the
-- AI allowance all reference profiles(id), so for those accounts each write fails its foreign key
-- and the work is quietly lost, or the AI mentor falls back to its built-in answers every time.
--
-- The rows are made exactly as the trigger makes them — name from the sign-up metadata or the
-- email, initials for the avatar, and the student role, since teaching is switched on by the
-- person afterwards — and only where none exists, so running this again changes nothing.

insert into public.profiles (id, name, avatar, role)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
  upper(left(coalesce(u.raw_user_meta_data ->> 'name', u.email), 2)),
  'student'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
