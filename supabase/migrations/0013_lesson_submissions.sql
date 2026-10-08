-- Hand-ins to mentor-written lessons, and the review of them, on the server.
--
-- `lesson_submissions` has existed since 0001 and nothing read or wrote it. The answers a
-- student gave to a mentor's lesson, and the mentor's verdict on them, lived in the student's
-- browser — so the author only ever saw what was handed in on the machine they were reviewing
-- from, which in practice means never. 0003 fixed the same thing for projects. This is the
-- other half of the review loop the product is built on.
--
-- `api/lesson-content.ts` now reads and writes this table: GET lists what the caller may see,
-- POST hands answers in and grades them against the key, PATCH is the author's decision.
--
-- It builds on 0001 (the table) and 0002 (the ledger), and is safe to run twice.

-- ---------------------------------------------------------------------------
-- submission_status: the author can send answers back
-- ---------------------------------------------------------------------------
-- 0001 gave a hand-in two states, waiting and reviewed, so a review could only ever close it.
-- Projects have always had a third — changes requested, answer again — and the README already
-- describes lessons travelling the same loop. `needs_changes` is that state.
--
-- `add value`, as 0011 does, because every row holds the type. Postgres will not let a value
-- added here be used in the same transaction, and nothing below uses it: the only code that
-- writes it is the route, after this has committed.

alter type submission_status add value if not exists 'needs_changes';

-- The student's own hand-ins, for the pull on sign-in. The author's side already has an index:
-- `unique (lesson_id, student_id)` leads with the lesson.
create index if not exists lesson_submissions_by_student on lesson_submissions (student_id);

-- ---------------------------------------------------------------------------
-- lesson_submissions: the browser reads, the route writes
-- ---------------------------------------------------------------------------
-- 0005 split the writes by column — answers for the student, grading for the author — and
-- left two holes that column grants cannot reach, because both parties are the one role
-- `authenticated`:
--
--   `submissions_insert_own` let a lesson's author hand in answers to their own free lesson,
--   and `submissions_grade` then let them grade it. With XP paid on approval, that is a
--   mentor approving themselves, one click after making themselves a mentor (0006).
--
--   `submissions_grade` let the author rewrite `quiz_score` — the platform's mark, computed
--   from a key — and rewrite `feedback` and `awarded_xp` after the student had read them. A
--   review is a record of what somebody said; the project loop is append-only for that reason.
--   And `awarded_xp` that the ledger does not agree with is a number on screen nobody was paid.
--
-- What it did get right: it is `owns_lesson()`, not `is_mentor()`, so the self-declared mentor
-- hole 0007 and 0010 closed for projects was never open here. Nobody could grade a lesson they
-- did not write.
--
-- Every write to this row now mixes columns two parties own with a judgement neither may make
-- alone. Handing in sets the answers *and* the score, and the score needs `custom_tasks`'
-- answer key, which a student may not read. Settling a quiz-only lesson sets the status *and*
-- pays XP. Reviewing sets the verdict *and* pays XP. So the browser loses its write rights here
-- entirely, as it did for project reviews in 0005 and for review feedback in 0010, and
-- `api/lesson-content.ts` writes with the service role after its own checks: access (paid →
-- entitlement, free → published, never your own lesson), and authorship for the decision.
-- Reads stay as they were — `submissions_read`: your own, the ones on lessons you wrote, admin.

drop policy if exists submissions_insert_own on lesson_submissions;
drop policy if exists submissions_grade on lesson_submissions;

-- The policies are gone and the grants go too: RLS is the lock, the revoke is the second lock.
-- Revoking at the table level also revokes the matching column privileges, so this takes
-- 0005's column grants with it.
revoke insert, update, delete on lesson_submissions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- xp_ledger: assignment XP is paid by the route that decided it
-- ---------------------------------------------------------------------------
-- 0002 let a learner insert their own `assignment` rows, because a quiz-only lesson was marked
-- in the student's own browser and that browser paid it. Any account could therefore post
--
--   supabase.from('xp_ledger').insert({ user_id: me, kind: 'assignment', amount: 100000, … })
--
-- and, with any `ref_id`, add itself to the `starters` count that `lesson_stats` (0009) shows
-- on somebody's course — a number in the storefront any visitor could push up.
--
-- Assignment XP is now always a decision somebody else made about you: the server marking your
-- answers against a key you cannot read, or the author approving them. That puts it with
-- `approval` and `competition`, which 0002 already kept out of the browser for that reason.
-- The route pays it with the service role, and `xp_ledger_paid_once` still pays it once per
-- lesson, which is what keeps a resubmission from paying twice.
--
-- `src/lib/progress.ts` holds this list as `BROWSER_XP_KINDS`, so the client stops sending what
-- this refuses rather than failing a whole batch on it.

drop policy if exists xp_ledger_insert_own on xp_ledger;
create policy xp_ledger_insert_own on xp_ledger for insert to authenticated
  with check (user_id = auth.uid() and kind in ('lesson', 'challenge', 'achievement', 'submission'));
