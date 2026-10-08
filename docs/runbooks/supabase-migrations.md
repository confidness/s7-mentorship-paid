# Runbook: Supabase migrations

The schema, its row level security and its storage buckets live in `supabase/migrations/`, one
numbered file per change. This page is for applying them and for adding one.

## The rules

**Migrations are numbered and applied in order.** `0001` first, then `0002`, and so on. Later
files change the policies and grants earlier ones created, so a database built from part of the
list is not the one the code is written against.

**Never edit a migration that has been applied.** Somewhere there is a database that ran the
old text, and it will not run the new one. A correction is a new file. The history in this
folder shows why: `0003` and `0004` created policies that `0005`, `0007` and `0010` later
removed, once it was clear a mentor, as a self-declared capability, should not hold them. The
original files still say what they said. The new ones say what changed and why.

**A new migration is the next number.** Look at the highest file in the folder and add one. If
two branches both add `0013`, whichever merges second renumbers.

## Applying

Paste each file into the Supabase SQL editor and run it, in order. Or run it with `psql`
against the project's database connection string. Both do the same thing; the repository has no
Supabase CLI configuration.

The files are written to be run again. They use `create table if not exists`, and they drop a
policy before creating it, because `create policy` has no `if not exists` and a file that
aborts halfway leaves a half-built database. Write new ones the same way.

There is no table recording which migrations ran. To see where a database is, look at what it
has:

```sql
select table_name from information_schema.tables where table_schema = 'public' order by 1;
select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2;
```

A table from a migration being present says that migration ran; a policy that a later migration
drops being absent says the later one ran.

### Enum values

`0011` adds values to the `order_status` enum with `alter type ... add value if not exists`.
Postgres will not let a value added in a transaction be used in the same transaction, so a
migration that adds one must not also use it; `0011` only adds them, and the code that uses
them is the webhook.

### Storage policies

`0001` creates two private buckets, `lesson-materials` and `mentor-docs`, and then tries to add
Storage policies so a person can upload only under their own user id. `storage.objects` belongs
to the storage extension, and on some projects the SQL editor's role cannot add policies to it.
When that happens the migration raises a notice (`Could not create storage policies`) instead
of aborting. The buckets are still private, so nothing is exposed; the only thing lost is
per-user path isolation, which you then add from Dashboard, Storage, Policies. Check for the
notice after running `0001`.

## Adding one

1. Start the file with a comment that says what changes and why. The existing files do this
   and it is how the next person learns that a policy was removed on purpose.
2. Enable row level security on every new table, and write the policies in the same file.
   A table with no policies is closed to the browser, which is a safe default; a table with
   RLS off is open.
3. Where two parties own different columns of one row, do not rely on a route to keep them
   apart. Postgres policies apply to a row, not a column, so use a column grant instead:
   `revoke update on t from authenticated; grant update (col) on t to authenticated;`.
   `0005`, `0007` and `0010` are the pattern.
4. Keep tables that hold history. `0006` retired the mentor application desk and left
   `mentor_applications` in place, because dropping a table to tidy up an interface is how
   history gets lost.
5. If the change moves what a route may do, change the route and add a test in the same pull
   request.

## What exists

| File | What it does |
| --- | --- |
| `0001_monetization.sql` | The monetization schema: profiles, mentor applications, Connect accounts, lessons, tasks, orders, entitlements and submissions, their row level security, and the two private storage buckets. |
| `0002_progress.sql` | Progress moves out of one browser: `student_profiles`, `lesson_progress` and `xp_ledger`, with `xp` maintained by a trigger and an award paid once. |
| `0003_projects.sql` | Projects and their reviews (`projects`, `project_feedback`), so a mentor can see work submitted from the student's browser. |
| `0004_notifications.sql` | Notifications that one person causes for another, with Realtime so the bell rings while the page is open. |
| `0005_column_ownership.sql` | Takes away the mentor's update right on projects, and narrows column writes on notifications and submissions. |
| `0006_open_teaching.sql` | Anyone may teach. A person may set their own role; `is_admin` stays pinned. The application desk is retired and its table kept. |
| `0007_authority.sql` | Repairs what `0006` broke: nobody writes into another inbox from a browser, and `published` is no longer a column an author may write. |
| `0008_demand.sql` | The demand board: `course_requests`, `course_request_votes` and `request_fulfilments`. |
| `0009_reputation.sql` | Public numbers the author cannot write: the `lesson_stats` and `mentor_reputation` views, and `learning_path` on student profiles. |
| `0010_self_declared_mentors.sql` | Removes the last uses of `is_mentor()` as authority: no browser-written feedback, mentors see the queue and not drafts, price and currency are no longer browser-writable. |
| `0011_disputes.sql` | Chargebacks: adds `disputed` and `charged_back` to the order statuses, and an index on `orders.stripe_payment_intent`, which refunds and disputes look their order up by. |
| `0012_ai_usage.sql` | The AI mentor's daily allowance: an `ai_usage` table with one row per account per UTC day, and `consume_ai_quota`, the only way to write it. |
| `0013_lesson_submissions.sql` | Lesson hand-ins on the server: adds `needs_changes` to the submission statuses, takes every write right on `lesson_submissions` away from the browser (`api/lesson-content.ts` writes them after its own checks), indexes hand-ins by student, and stops a browser inserting `assignment` XP. |

The folder is the source of truth. If a file exists that is not in this table, read its header
comment and add a line.
