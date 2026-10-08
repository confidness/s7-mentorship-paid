/**
 * Serves a lesson's actual contents — tasks and teaching material — to someone entitled to it.
 *
 * This is the route the paywall actually is. Hiding a lesson behind a lock icon in the UI
 * stops nobody; refusing to send the bytes is what makes a purchase mean something. A student
 * who edits local storage, or who calls this endpoint directly with a valid session, gets the
 * same 402 as before, because ownership is read from the entitlements table on every request.
 *
 * Two things never cross the wire to a student:
 *   - answer_index, the quiz answer key. It is stripped here rather than merely unused by the
 *     UI, because "the client doesn't render it" is not the same as "the client doesn't have it".
 *   - the material's storage path. A signed URL is minted per request and expires.
 *
 * And what is handed in against those tasks:
 *
 * GET   ?lessonId=…     the lesson's contents, as above.
 * GET   ?submissions=1  the hand-ins this person may see — their own, and for an author, the
 *                       ones on lessons they wrote.
 * POST                  hand answers in, or answer again after the author sent them back.
 * PATCH                 the author's decision: approve and pay, or send back.
 *
 * Hand-ins live in this file rather than in one of their own for two reasons. Every hand-in is
 * marked against the answer key, and this is the one file that reads it — keeping it here
 * means the key still has exactly one place it is touched. And the deployment is at the twelve
 * functions a Vercel Hobby project may have; a thirteenth file under `api/` would fail every
 * deploy, not just this feature.
 */

import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser, type Caller } from './_lib/server.js'
import { canHandIn, decideReview, lessonPoints, settle, type GradedTask } from '../src/lib/submissions.js'
import type { LessonSubmission, TaskAnswer } from '../src/lib/types'

/** Long enough to open a PDF, short enough that a copied link is not a distribution channel. */
const MATERIAL_URL_TTL_SECONDS = 900

/**
 * The access rule, alone and with no I/O.
 *
 * Pulled out of the handler so it can be tested exhaustively without a database: this is the
 * sentence the paywall comes down to, and it should be readable in one glance. Three ways in,
 * and only three — you wrote it, it is free, or you bought it.
 */
export function decideAccess(input: { authorId: string; priceCents: number; published: boolean; viewerId: string; hasEntitlement: boolean }):
  | { allow: true; isAuthor: boolean }
  | { allow: false; reason: 'not_found' | 'payment_required' } {
  const isAuthor = input.authorId === input.viewerId
  // An unpublished lesson does not exist as far as anyone but its author is concerned —
  // 404, not 402, because "pay to see my draft" is not an offer being made.
  if (!input.published && !isAuthor) return { allow: false, reason: 'not_found' }
  if (isAuthor || input.priceCents <= 0 || input.hasEntitlement) return { allow: true, isAuthor }
  return { allow: false, reason: 'payment_required' }
}

/**
 * Strips a task down to what a student may see.
 *
 * answer_index is removed rather than blanked: a null answer key still tells you the shape of
 * the data, and a field that is absent cannot be accidentally reintroduced by a later change
 * that copies the row wholesale.
 */
export function publicTask(task: { id: string; kind: string; prompt: string; points: number; options?: unknown; starter?: string | null; answer_index?: number | null }, forAuthor: boolean) {
  const base = { id: task.id, kind: task.kind, prompt: task.prompt, points: task.points, options: task.options ?? undefined, starter: task.starter ?? undefined }
  return forAuthor ? { ...base, answerIndex: task.answer_index ?? undefined } : base
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST', 'PATCH')
    const caller = await requireUser(req)
    if (req.method === 'POST') return await handIn(req, caller)
    if (req.method === 'PATCH') return await decide(req, caller)

    const params = new URL(req.url).searchParams
    if (params.get('submissions') === '1') return await listSubmissions(caller)

    const lessonId = params.get('lessonId') ?? ''
    if (!lessonId) throw new HttpError(400, 'invalid_input', 'Which lesson?')

    const db = adminClient()
    const { data: lesson, error } = await db
      .from('custom_lessons')
      .select('id, author_id, title, summary, price_cents, currency, published, material_path, material_name, material_mime, material_size')
      .eq('id', lessonId)
      .maybeSingle()
    if (error) throw new HttpError(500, 'read_failed', error.message)
    if (!lesson) throw new HttpError(404, 'not_found', 'No such lesson.')

    const isAuthor = lesson.author_id === caller.id

    // Only ask about entitlement when it could matter — an author or a free lesson needs no
    // lookup, and the rule itself is decided by decideAccess above.
    let hasEntitlement = false
    if (!isAuthor && lesson.price_cents > 0) {
      const { data: owned } = await db.from('entitlements').select('id').eq('student_id', caller.id).eq('lesson_id', lessonId).maybeSingle()
      hasEntitlement = Boolean(owned)
    }

    const verdict = decideAccess({ authorId: lesson.author_id, priceCents: lesson.price_cents, published: lesson.published, viewerId: caller.id, hasEntitlement })
    if (!verdict.allow && verdict.reason === 'not_found') throw new HttpError(404, 'not_found', 'No such lesson.')

    if (!verdict.allow) {
      // 402 Payment Required, with the teaser fields only — enough to render a buy page,
      // nothing that is being sold.
      return json(
        {
          error: 'payment_required',
          entitled: false,
          lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary, priceCents: lesson.price_cents, currency: lesson.currency },
        },
        402,
      )
    }

    const { data: taskRows, error: taskError } = await db
      .from('custom_tasks')
      .select('id, kind, prompt, points, options, starter, answer_index, position')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: true })
    if (taskError) throw new HttpError(500, 'read_failed', taskError.message)

    // The author gets the answer key back — they wrote it, and the builder needs it to edit.
    // Everyone else gets the same rows with that field absent, not blanked.
    const tasks = (taskRows ?? []).map((task) => publicTask(task, isAuthor))

    let material: { name: string; mime: string; size: number; url: string } | null = null
    if (lesson.material_path) {
      const { data: signed } = await db.storage.from('lesson-materials').createSignedUrl(lesson.material_path, MATERIAL_URL_TTL_SECONDS)
      if (signed?.signedUrl) {
        material = {
          name: lesson.material_name ?? 'material',
          mime: lesson.material_mime ?? 'application/octet-stream',
          size: lesson.material_size ?? 0,
          url: signed.signedUrl,
        }
      }
    }

    return json({
      entitled: true,
      lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary, priceCents: lesson.price_cents, currency: lesson.currency, authorId: lesson.author_id },
      tasks,
      material,
    })
  } catch (error) {
    return fail(error)
  }
}

/* ---------------------------------------------------------------- hand-ins */

/** An essay fits; a megabyte pasted into every box is a row nobody can render. */
const MAX_ANSWER_CHARS = 20_000

const SUBMISSION_COLUMNS = 'id, lesson_id, student_id, answers, quiz_score, quiz_total, status, submitted_at, reviewed_at, reviewer_id, feedback, awarded_xp'
/** With the student's name, because an author has usually never met them in their own browser. */
const WITH_NAME = `${SUBMISSION_COLUMNS}, profiles:student_id (name)`

/**
 * Ids here are uuids. One that is not — a hand-in only ever held in one browser, say — is a
 * row that does not exist, and saying so beats letting Postgres reject the cast as a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Admin = ReturnType<typeof adminClient>

interface SubmissionRow {
  id: string
  lesson_id: string
  student_id: string
  answers: unknown
  quiz_score: number
  quiz_total: number
  status: LessonSubmission['status']
  submitted_at: string
  reviewed_at: string | null
  reviewer_id: string | null
  feedback: string | null
  awarded_xp: number | null
  profiles?: { name?: string } | null
}

const toSubmission = (row: SubmissionRow): LessonSubmission => ({
  id: row.id,
  lessonId: row.lesson_id,
  studentId: row.student_id,
  studentName: row.profiles?.name ?? undefined,
  answers: Array.isArray(row.answers) ? (row.answers as TaskAnswer[]) : [],
  quizScore: row.quiz_score,
  quizTotal: row.quiz_total,
  status: row.status,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at ?? undefined,
  reviewerId: row.reviewer_id ?? undefined,
  feedback: row.feedback ?? undefined,
  awardedXp: row.awarded_xp ?? undefined,
})

/** A unique key doing its job: the thing already exists, which is not a fault. */
const isDuplicate = (error: { code?: string; message: string }) => error.code === '23505' || /duplicate key|unique constraint/i.test(error.message)

/**
 * The answers in a hand-in, and nothing else from the body.
 *
 * Only questions the lesson actually has, once each, in the lesson's order, as text. Whatever
 * else a client sends — a score, a status, an XP figure, its own copy of the answer key — is
 * never read, so there is nothing in it to believe.
 */
export function readAnswers(raw: unknown, tasks: Pick<GradedTask, 'id'>[]): TaskAnswer[] {
  const given = new Map<string, string>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const { taskId, value } = (entry ?? {}) as { taskId?: unknown; value?: unknown }
      if (typeof taskId !== 'string' || given.has(taskId)) continue
      given.set(taskId, typeof value === 'string' ? value.slice(0, MAX_ANSWER_CHARS) : typeof value === 'number' ? String(value) : '')
    }
  }
  return tasks.filter((task) => given.has(task.id)).map((task) => ({ taskId: task.id, value: given.get(task.id) ?? '' }))
}

/**
 * Every hand-in this caller may see, newest first.
 *
 * As the caller, so `submissions_read` decides: your own, the ones on lessons you wrote, and
 * all of them for an admin. There is no filter here to get wrong — the query says what to
 * fetch and the policy says who may.
 */
async function listSubmissions(caller: Caller): Promise<Response> {
  const { data, error } = await caller.db.from('lesson_submissions').select(WITH_NAME).order('submitted_at', { ascending: false }).limit(500)
  if (error) throw new HttpError(500, 'read_failed', error.message)
  return json({ submissions: ((data ?? []) as SubmissionRow[]).map(toSubmission) })
}

/**
 * Hand answers in, or answer again after the author sent them back.
 *
 * Who may: the three ways into a lesson `decideAccess` names, less one. Nobody hands in answers
 * to their own lesson, because they would be the one approving them, and approving pays.
 *
 * The mark is this route's and never the client's. It reads the answer key, runs `settle` over
 * the answers, and writes the result. A lesson made only of quizzes settles here and pays at
 * once; anything else waits for its author, who is told it arrived.
 *
 * The reads that the policies allow go through the caller. The answer key and every write use
 * the service role, and 0013 says why: a hand-in sets the student's answers and the platform's
 * mark in one row, the mark comes from a key the student may not read, and settling pays XP no
 * browser may write. So the browser holds no write right on this table, and the checks above
 * the first write are the whole gate.
 */
async function handIn(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<{ lessonId?: unknown; answers?: unknown }>(req)
  const lessonId = typeof body.lessonId === 'string' ? body.lessonId : ''
  if (!lessonId) throw new HttpError(400, 'invalid_input', 'Which lesson?')
  if (!UUID.test(lessonId)) throw new HttpError(404, 'not_found', 'No such lesson.')

  // As the caller: a published lesson, or their own. Anything else is not there for them.
  const { data: lesson, error } = await caller.db.from('custom_lessons').select('id, author_id, title, price_cents, published').eq('id', lessonId).maybeSingle()
  if (error) throw new HttpError(500, 'read_failed', error.message)
  if (!lesson) throw new HttpError(404, 'not_found', 'No such lesson.')
  if (lesson.author_id === caller.id) throw new HttpError(403, 'own_lesson', 'You cannot hand in answers to your own lesson.')

  let hasEntitlement = false
  if (lesson.price_cents > 0) {
    const { data: owned } = await caller.db.from('entitlements').select('id').eq('student_id', caller.id).eq('lesson_id', lessonId).maybeSingle()
    hasEntitlement = Boolean(owned)
  }
  const access = decideAccess({ authorId: lesson.author_id, priceCents: lesson.price_cents, published: lesson.published, viewerId: caller.id, hasEntitlement })
  if (!access.allow) {
    throw access.reason === 'not_found' ? new HttpError(404, 'not_found', 'No such lesson.') : new HttpError(402, 'payment_required', 'Buy this lesson to hand in answers.')
  }

  const db = adminClient()
  // The answer key, which `tasks_author_only` keeps from everyone but the author — that is
  // what it is for, and why marking has to happen here.
  const { data: taskRows, error: taskError } = await db.from('custom_tasks').select('id, kind, points, answer_index').eq('lesson_id', lessonId).order('position', { ascending: true })
  if (taskError) throw new HttpError(500, 'read_failed', taskError.message)
  const tasks: GradedTask[] = (taskRows ?? []).map((task) => ({ id: task.id, kind: task.kind, points: task.points, answerIndex: task.answer_index ?? undefined }))
  if (!tasks.length) throw new HttpError(400, 'invalid_input', 'This lesson has no questions to answer.')

  const answers = readAnswers(body.answers, tasks)
  const graded = settle(tasks, answers)

  const { data: existing } = await caller.db.from('lesson_submissions').select('id, status').eq('lesson_id', lessonId).eq('student_id', caller.id).maybeSingle()
  if (!canHandIn(existing)) throw new HttpError(409, 'already_submitted', 'These answers are already handed in.')

  /**
   * Paid before the row says so.
   *
   * The other order can leave a settled hand-in whose XP never arrived, and nothing to retry:
   * the row is final. This order can at worst pay and then fail to write the row, and the
   * retry writes it and pays nothing, because the ledger already holds this lesson for this
   * student. The same reasoning as writing project feedback before moving the project.
   */
  const settledNow = graded.status === 'reviewed'
  if (settledNow) await pay(db, caller.id, lessonId, graded.awardedXp ?? 0, lesson.title)

  const at = new Date().toISOString()
  const columns = {
    answers,
    quiz_score: graded.quizScore,
    quiz_total: graded.quizTotal,
    status: graded.status,
    submitted_at: at,
    reviewed_at: settledNow ? at : null,
    awarded_xp: settledNow ? (graded.awardedXp ?? 0) : null,
    // A new round. The feedback that sent it back stays until the next decision replaces it.
    reviewer_id: null,
  }

  const { data: row, error: writeError } = existing
    ? // Only while it is still sent back, checked inside the write: two tabs answering again at
      // once land one answer, not the later one over the earlier.
      await db.from('lesson_submissions').update(columns).eq('id', existing.id).eq('student_id', caller.id).eq('status', 'needs_changes').select(WITH_NAME).maybeSingle()
    : await db.from('lesson_submissions').insert({ ...columns, lesson_id: lessonId, student_id: caller.id }).select(WITH_NAME).maybeSingle()
  if (writeError && isDuplicate(writeError)) throw new HttpError(409, 'already_submitted', 'These answers are already handed in.')
  if (writeError) throw new HttpError(500, 'write_failed', writeError.message)
  if (!row) throw new HttpError(409, 'already_submitted', 'These answers are already handed in.')

  const submission = toSubmission(row as SubmissionRow)
  if (!settledNow) {
    await tell(db, {
      user_id: lesson.author_id,
      title: 'notif_assignment_submitted',
      body: 'notif_assignment_submitted_body',
      vars: { student: submission.studentName ?? '', title: lesson.title },
      kind: 'review',
      href: `/m/lessons/${lessonId}`,
    })
  }

  return json({ ok: true, submission })
}

/**
 * The author's decision: approve and pay, or send the answers back.
 *
 * `decideReview` says whether this caller may decide, given facts read here rather than taken
 * from the body — who wrote the lesson, whose answers these are, whether they are still
 * waiting, and what the lesson is worth. The body supplies only the decision, the words and the
 * figure the author chose, and the figure is held to the lesson's points.
 *
 * The reads go through the caller, so the policies decide what could be seen at all: the row by
 * `submissions_read`, the questions by `tasks_author_only`. The writes use the service role for
 * the reason in 0013 — the verdict and the XP it pays land together, and the browser holds no
 * write right on this table.
 *
 * No claim step, unlike projects. A lesson has exactly one author and only they may decide, so
 * there is nobody to collide with; see `decideReview`.
 */
async function decide(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<{ id?: unknown; decision?: unknown; feedback?: unknown; awardedXp?: unknown }>(req)
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) throw new HttpError(400, 'invalid_input', 'Which answers?')
  if (!UUID.test(id)) throw new HttpError(404, 'not_found', 'No such answers.')

  const { data: sub, error } = await caller.db.from('lesson_submissions').select('id, lesson_id, student_id, status').eq('id', id).maybeSingle()
  if (error) throw new HttpError(500, 'read_failed', error.message)
  if (!sub) throw new HttpError(404, 'not_found', 'No such answers.')

  const [{ data: lesson }, { data: points }] = await Promise.all([
    caller.db.from('custom_lessons').select('author_id, title').eq('id', sub.lesson_id).maybeSingle(),
    caller.db.from('custom_tasks').select('points').eq('lesson_id', sub.lesson_id),
  ])

  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : ''
  const verdict = decideReview({
    reviewerId: caller.id,
    lessonAuthorId: lesson?.author_id ?? '',
    studentId: sub.student_id,
    status: sub.status,
    decision: body.decision,
    feedback,
    awardedXp: Number(body.awardedXp),
    maxXp: lessonPoints(points ?? []),
  })
  if (!verdict.ok) throw refusal(verdict.reason)

  const db = adminClient()
  const title = lesson?.title ?? ''
  const approved = verdict.status === 'reviewed'
  const xp = verdict.awardedXp ?? 0
  // Paid before the row says so, for the reason given in `handIn`.
  if (approved) await pay(db, sub.student_id, sub.lesson_id, xp, title)

  const { data: decided, error: writeError } = await db
    .from('lesson_submissions')
    .update({ status: verdict.status, feedback, awarded_xp: approved ? xp : null, reviewer_id: caller.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    // Still waiting, checked inside the write itself. Two tabs deciding in the same second
    // resolve to one decision rather than the later quietly overwriting the earlier.
    .eq('status', 'submitted')
    .select(WITH_NAME)
    .maybeSingle()
  if (writeError) throw new HttpError(500, 'write_failed', writeError.message)
  if (!decided) throw new HttpError(409, 'already_reviewed', 'These answers have already been decided.')

  // The one part the student is waiting for, and the one the mentor's browser cannot deliver.
  await tell(db, {
    user_id: sub.student_id,
    title: approved ? 'notif_assignment_reviewed' : 'notif_changes_requested',
    body: approved ? 'notif_assignment_reviewed_body' : 'notif_assignment_changes_requested_body',
    vars: approved ? { title, xp } : { title },
    kind: approved ? 'approval' : 'review',
    href: `/assigned/${sub.lesson_id}`,
  })

  return json({ ok: true, submission: toSubmission(decided as SubmissionRow) })
}

function refusal(reason: 'not_author' | 'own_work' | 'not_waiting' | 'no_decision' | 'no_feedback'): HttpError {
  switch (reason) {
    case 'not_author':
      return new HttpError(403, 'forbidden', 'Only the author of this lesson can review these answers.')
    case 'own_work':
      return new HttpError(403, 'forbidden', 'You cannot review your own answers.')
    case 'not_waiting':
      return new HttpError(409, 'already_reviewed', 'These answers have already been decided.')
    case 'no_decision':
      return new HttpError(400, 'invalid_input', 'A review has to decide something.')
    case 'no_feedback':
      return new HttpError(400, 'invalid_input', 'Feedback is required for both decisions.')
  }
}

/**
 * Pays assignment XP, once per student per lesson.
 *
 * Service role, because since 0013 no browser may write an `assignment` row — including the
 * browser of the person being paid. `xp_ledger_paid_once` is what makes it once: a second
 * award for the same lesson collides and is not an error, which is how a resubmission, a
 * retried request and two tabs pressing together all come to pay nothing extra. The total in
 * `student_profiles.xp` moves by trigger when the row lands, never from here.
 */
async function pay(db: Admin, studentId: string, lessonId: string, amount: number, title: string): Promise<void> {
  if (amount <= 0) return
  const { error } = await db.from('xp_ledger').insert({
    user_id: studentId,
    amount,
    // A dictionary key and its vars, like every other ledger row: read in whatever language
    // the student has on, not frozen in the one the server happened to run in.
    reason: 'xp_assignment_completed',
    vars: { title },
    kind: 'assignment',
    ref_id: lessonId,
    // `xp_ledger_paid_once` is the guard here, not this; it only has to be unique.
    op_id: crypto.randomUUID(),
  })
  if (error && !isDuplicate(error)) throw new HttpError(500, 'write_failed', error.message)
}

/**
 * Puts a notification in somebody else's inbox.
 *
 * Service role, because since 0007 nothing may write into another account's inbox from a
 * browser; the routes that decide things are where those rows come from. A failure is logged
 * and swallowed: what it announces is already recorded and readable without it, and an error
 * here would invite a retry of something that has already happened.
 */
async function tell(db: Admin, row: { user_id: string; title: string; body: string; vars: Record<string, string | number>; kind: string; href: string }): Promise<void> {
  const { error } = await db.from('notifications').insert(row)
  if (error) console.error('notification not written:', error.message)
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
