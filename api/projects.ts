/**
 * Projects and their reviews.
 *
 * GET    what this person may see — their own work, the approved gallery, and for a mentor
 *        the queue as well.
 * POST   create or update your own project, and hand it in.
 * PATCH  claim or decide. Mentors only.
 *
 * The split between POST and PATCH is not cosmetic. A student owns the body of the work and
 * a mentor owns the decision about it, and row level security cannot express that on its own
 * — Postgres policies apply to a row, not to a column, so a mentor with update rights could
 * rewrite the submission they are reviewing.
 *
 * So the mentor's update right was taken away entirely (migration 0005) and PATCH writes with
 * the service role instead. That is what makes the next sentence true rather than merely
 * intended: PATCH writes `status`, `reviewer_id` and `reviewed_at` and nothing else, ever.
 * Saying it while the browser still held an authenticated client that could write the same
 * row was documenting a wish.
 */

import { HttpError, adminClient, fail, json, readJson, requireMentor, requireMethod, requireUser, type Caller } from './_lib/server.js'

/** What a student may put a project into. Deciding is somebody else's verb. */
const AUTHOR_STATES = new Set(['draft', 'submitted'])

interface SaveBody {
  id?: string
  title?: string
  description?: string
  code?: string
  notes?: string
  courseId?: string
  lessonId?: string
  attachments?: unknown
  tags?: unknown
  status?: string
}

interface ReviewBody {
  id?: string
  action?: 'claim' | 'decide'
  decision?: 'approved' | 'needs_changes'
  message?: string
  rubric?: { completeness: number; clarity: number; craft: number }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST', 'PATCH')
    if (req.method === 'GET') return await list(await requireUser(req))
    if (req.method === 'POST') return await save(req, await requireUser(req))
    // PATCH identifies the caller as a mentor here rather than leaning on a policy, because
    // the write below no longer goes through one. See the note above `review`.
    return await review(req, await requireMentor(req))
  } catch (error) {
    return fail(error)
  }
}

const SELECT = 'id, author_id, title, description, code, notes, course_id, lesson_id, attachments, tags, status, created_at, submitted_at, reviewed_at, reviewer_id, likes, views'

/**
 * Everything visible to this caller, with the reviews attached.
 *
 * Row level security already decides what comes back — a student sees their own work and the
 * approved gallery, a mentor sees all of it — so there is no filter here to get wrong. The
 * query says what to fetch; the policy says who may.
 */
async function list(caller: Caller): Promise<Response> {
  const [projects, feedback] = await Promise.all([
    caller.db.from('projects').select(SELECT).order('created_at', { ascending: false }).limit(500),
    caller.db.from('project_feedback').select('id, project_id, mentor_id, decision, message, rubric, created_at').order('created_at', { ascending: true }).limit(2000),
  ])
  if (projects.error) throw new HttpError(500, 'read_failed', projects.error.message)

  const byProject = new Map<string, unknown[]>()
  for (const row of feedback.data ?? []) {
    const list = byProject.get(row.project_id as string) ?? []
    list.push({
      id: row.id,
      projectId: row.project_id,
      mentorId: row.mentor_id,
      decision: row.decision,
      message: row.message,
      rubric: row.rubric ?? undefined,
      createdAt: row.created_at,
    })
    byProject.set(row.project_id as string, list)
  }

  return json({
    projects: (projects.data ?? []).map((p) => ({
      id: p.id,
      authorId: p.author_id,
      title: p.title,
      description: p.description,
      code: p.code,
      notes: p.notes,
      courseId: p.course_id,
      lessonId: p.lesson_id,
      attachments: p.attachments ?? [],
      tags: p.tags ?? [],
      status: p.status,
      createdAt: p.created_at,
      submittedAt: p.submitted_at ?? undefined,
      reviewedAt: p.reviewed_at ?? undefined,
      reviewerId: p.reviewer_id ?? undefined,
      likes: p.likes,
      views: p.views,
      feedback: byProject.get(p.id as string) ?? [],
    })),
  })
}

/** Create or update your own work. The author's columns, and only those. */
async function save(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<SaveBody>(req)
  const title = (body.title ?? '').trim()
  if (!title) throw new HttpError(400, 'invalid_input', 'A project needs a title.')

  const status = body.status && AUTHOR_STATES.has(body.status) ? body.status : 'draft'
  const row = {
    author_id: caller.id,
    title,
    description: body.description ?? '',
    code: body.code ?? '',
    notes: body.notes ?? '',
    course_id: body.courseId ?? '',
    lesson_id: body.lessonId ?? '',
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    tags: Array.isArray(body.tags) ? body.tags : [],
    status,
  }

  if (body.id) {
    /**
     * Keep the moment it was handed in.
     *
     * This used to write `submitted_at: now()` on every save of a submitted project, so the
     * timestamp meant "when the student last pressed save" rather than "when this reached
     * the queue". Two things read it and both were wrong: `projects_queue` claims to be
     * oldest-first and silently reshuffled whenever anyone edited, and any measure of how
     * long a review took was measuring the wrong interval.
     *
     * A project moving draft → submitted is a new submission and gets a new time. One that
     * was already submitted keeps the one it has.
     */
    const { data: current } = await caller.db.from('projects').select('status, submitted_at').eq('id', body.id).eq('author_id', caller.id).maybeSingle()
    const submittedAt = status !== 'submitted' ? null : (current?.submitted_at ?? new Date().toISOString())

    // The policy refuses this when the row is not theirs or has moved past their reach, so a
    // student cannot edit a project a mentor has already decided on.
    const { data, error } = await caller.db.from('projects').update({ ...row, submitted_at: submittedAt }).eq('id', body.id).eq('author_id', caller.id).select('id').maybeSingle()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    if (!data) throw new HttpError(409, 'not_editable', 'That project can no longer be edited.')
    return json({ ok: true, id: data.id })
  }

  const { data, error } = await caller.db
    .from('projects')
    .insert({ ...row, submitted_at: status === 'submitted' ? new Date().toISOString() : null })
    .select('id')
    .single()
  if (error) throw new HttpError(500, 'write_failed', error.message)
  return json({ ok: true, id: data.id })
}

/**
 * Claim a project, or decide on it.
 *
 * Claiming is what stops two mentors writing the same review, and it is conditional on the
 * project still being unclaimed — the second mentor to press it gets a 409 rather than
 * silently taking it over.
 *
 * This is the one place in the file that writes with the service role, and the reason is the
 * claim at the top of the file. "PATCH writes three columns and nothing else, ever" was only
 * ever true of this route — the browser holds an authenticated Supabase client too, and while
 * a policy said `with check (is_mentor())`, a mentor with devtools could update *any* column
 * of *any* submitted project: rewrite the code, take the authorship, then approve it into the
 * gallery. Postgres has no per-column update policy to express the difference, so the policy
 * is gone (migration 0005) and the write happens somewhere the browser cannot reach.
 *
 * Which makes the handler's `requireMentor` the whole check, rather than a convenience.
 */
async function review(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<ReviewBody>(req)
  if (!body.id) throw new HttpError(400, 'invalid_input', 'Which project?')
  const db = adminClient()

  /**
   * Is this still open, and is it yours to decide?
   *
   * Feedback is append-only and cannot be taken back, so nothing may be written about a
   * project somebody has already decided. Without this, a second mentor opening a finished
   * review would append a contradictory verdict the student can never be rid of — and, since
   * the conditional update below simply matches no rows, would be told it worked.
   *
   * Since 0006 anyone can make themselves a mentor with one click, so `requireMentor` alone
   * would let a student approve their own work into the gallery. Authors never review
   * themselves, and a project another mentor has claimed stays theirs.
   *
   * This read is not the guarantee; the filters on each update are, and they are what settle
   * two mentors pressing at the same instant. This is what keeps the common case — a stale
   * tab, a back button — from writing anything at all.
   */
  const { data: open } = await db.from('projects').select('status, author_id, reviewer_id').eq('id', body.id).maybeSingle()
  if (!open) throw new HttpError(404, 'not_found', 'No such project.')
  if (open.author_id === caller.id) throw new HttpError(403, 'forbidden', 'You cannot review your own project.')

  if (body.action === 'claim') {
    const { data, error } = await db
      .from('projects')
      .update({ status: 'under_review', reviewer_id: caller.id })
      .eq('id', body.id)
      .neq('author_id', caller.id)
      .eq('status', 'submitted')
      .select('id')
      .maybeSingle()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    if (!data) throw new HttpError(409, 'already_claimed', 'Somebody is already reviewing this.')
    return json({ ok: true, id: data.id })
  }

  const decision = body.decision
  if (decision !== 'approved' && decision !== 'needs_changes') throw new HttpError(400, 'invalid_input', 'A review has to decide something.')
  const message = (body.message ?? '').trim()
  if (!message) throw new HttpError(400, 'invalid_input', 'Feedback is required for both decisions.')

  if (open.status !== 'submitted' && open.status !== 'under_review') throw new HttpError(409, 'already_reviewed', 'That project has already been decided.')
  if (open.reviewer_id && open.reviewer_id !== caller.id) throw new HttpError(409, 'already_claimed', 'Somebody else is reviewing this.')

  // The record of what was said goes in first. If the status update then fails, the student
  // has the feedback and the project stays in the queue — the opposite order would close the
  // project with nothing written on it.
  const { error: wrote } = await db.from('project_feedback').insert({
    project_id: body.id,
    mentor_id: caller.id,
    decision,
    message,
    rubric: body.rubric ?? null,
  })
  if (wrote) throw new HttpError(500, 'write_failed', wrote.message)

  // Exactly three columns. The body of the work is not this route's to touch.
  const { data: decided, error } = await db
    .from('projects')
    .update({ status: decision, reviewer_id: caller.id, reviewed_at: new Date().toISOString() })
    .eq('id', body.id)
    // Still open, checked inside the write itself. Two mentors deciding in the same second
    // resolve to one decision here rather than the later one quietly overwriting the earlier.
    .in('status', ['submitted', 'under_review'])
    .neq('author_id', caller.id)
    // caller.id comes from the verified token, so interpolating it into the filter is safe.
    .or(`reviewer_id.is.null,reviewer_id.eq.${caller.id}`)
    .select('author_id, title')
    .maybeSingle()
  if (error) throw new HttpError(500, 'write_failed', error.message)
  // Lost the race. The feedback row above stays — it is a true record of what this mentor
  // said — but the decision is not theirs to report, and the caller must not be told it was.
  if (!decided) throw new HttpError(409, 'already_reviewed', 'Somebody decided this first.')

  /**
   * Tell the student.
   *
   * This is the one notification the client genuinely cannot produce. `logic.reviewProject`
   * writes it too, but it runs in the mentor's browser, so it lands in the mentor's storage
   * addressed to someone who will never read it there. The review ending is the part of the
   * loop the student is waiting for, and until this row existed it arrived nowhere.
   *
   * The failure is swallowed on purpose: the decision is recorded and the feedback is
   * readable without it, and a 500 here would invite a retry that writes a second review.
   */
  if (decided?.author_id) {
    const { data: mentor } = await db.from('profiles').select('name').eq('id', caller.id).maybeSingle()
    const approved = decision === 'approved'
    await db.from('notifications').insert({
      user_id: decided.author_id,
      title: approved ? 'notif_project_approved' : 'notif_changes_requested',
      // `_plain` rather than the client's key: that one names the XP, and the amount is a
      // client-side rule. See the key's own note in src/i18n/ui.ts.
      body: approved ? 'notif_project_approved_body_plain' : 'notif_changes_requested_body',
      vars: { mentor: mentor?.name ?? '', title: decided.title },
      kind: approved ? 'approval' : 'review',
      href: `/projects/${body.id}`,
    })
  }

  return json({ ok: true, id: body.id, decision })
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }
