-- Three `is_mentor()` uses and one column grant that 0007 did not reach.
--
-- 0007 established the rule: since 0006, `is_mentor()` is a self-declared capability and
-- grants no authority over anybody else's row. These still treated it as authority.

-- ---------------------------------------------------------------------------
-- project_feedback: nobody writes a review from a browser
-- ---------------------------------------------------------------------------
-- `feedback_write_mentor` let any account that flipped itself to mentor insert a review, with
-- any decision, on any project, and feedback has no delete. `api/projects.ts` has written
-- feedback with the service role since 0005, so the browser needs no insert right at all.
drop policy if exists feedback_write_mentor on project_feedback;

-- ---------------------------------------------------------------------------
-- projects: a mentor sees the queue, not the drafts
-- ---------------------------------------------------------------------------
-- Drafts are unfinished work nobody has handed in. Reviewing needs submitted work and its
-- history, never a draft.
drop policy if exists projects_read on projects;
create policy projects_read on projects for select to authenticated
  using (author_id = auth.uid() or status = 'approved' or (is_mentor() and status <> 'draft') or is_admin());

-- ---------------------------------------------------------------------------
-- custom_lessons: price is gated like `published`
-- ---------------------------------------------------------------------------
-- 0007 kept `price_cents` writable, so an author could publish a lesson free through the API
-- and then price it directly — a priced lesson in the storefront with no Stripe account
-- behind it. `api/lessons.ts` saves with the service role and checks Stripe first.
revoke update on custom_lessons from authenticated;
grant update (title, summary, material_path, material_name, material_mime, material_size, updated_at)
  on custom_lessons to authenticated;
