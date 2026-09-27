-- Anyone may teach here.
--
-- The application desk is gone. It was built for a robotics academy where a named adult with
-- documents was approved by a reviewer before handling children's work — a real answer to a
-- real question, and the wrong shape for an open marketplace where the platform's job is to
-- carry other people's courses, not to vet them first.
--
-- What replaces it is the thing every open marketplace actually relies on: publishing under
-- your own name, a review loop students can see, and the ability to take money only through
-- an account Stripe has verified. Money still has a gate; teaching does not.
--
-- The tables from 0001 stay. `mentor_applications` holds rows somebody filed in good faith,
-- and dropping a table to tidy up a UI is how history gets lost. Nothing reads it any more.

-- ---------------------------------------------------------------------------
-- profiles: a person may now make themselves a mentor
-- ---------------------------------------------------------------------------
-- The old policy pinned `role` to its current value, because the only legitimate way to
-- change it was an admin route acting on an approved application. With that gone, pinning it
-- would mean nobody could ever teach.
--
-- `is_admin` stays pinned, and that is the line that matters. Admin decides who is admin;
-- anyone decides whether they teach. The enum has exactly two values, so `role in (...)` is
-- not a restriction so much as a statement that this is the whole of it.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_admin = (select p.is_admin from profiles p where p.id = auth.uid())
    and role in ('student', 'mentor')
  );
