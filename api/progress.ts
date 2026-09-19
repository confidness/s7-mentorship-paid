/**
 * Learner progress: read it back, or post what happened.
 *
 * This route expresses no rules. It upserts, and that is deliberate — the rules live in
 * `src/lib/logic.ts` as pure functions, and a second copy of them here is the thing most
 * likely to drift. The only judgement it makes is `on conflict`, and that judgement is the
 * database enforcing `awardXp`'s guard rather than a re-implementation of it.
 *
 * It runs as the caller, not as the service role. Nothing here needs to act outside what the
 * person may do: row level security already says a learner writes only their own rows, and
 * refuses the two XP kinds that are somebody else's decision about them.
 */

import { HttpError, fail, json, readJson, requireMethod, requireUser, type Caller } from './_lib/server'
import type { ProgressOp } from '../src/lib/progress'

/** A batch bound, so one bad client cannot post a million rows in a single request. */
const MAX_OPS = 500

interface Body {
  ops?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST')
    const caller = await requireUser(req)
    return req.method === 'GET' ? await snapshot(caller) : await apply(req, caller)
  } catch (error) {
    return fail(error)
  }
}

/** Everything the client needs to merge on sign-in, in one round trip. */
async function snapshot(caller: Caller): Promise<Response> {
  const [profile, lessons, ledger] = await Promise.all([
    caller.db.from('student_profiles').select('xp, streak, last_active_date, current_course_id, enrolled_course_ids, goal').eq('user_id', caller.id).maybeSingle(),
    caller.db.from('lesson_progress').select('lesson_id, course_id, check_passed_at, completed_at, challenge_completed_at').eq('user_id', caller.id),
    caller.db.from('xp_ledger').select('id, amount, reason, vars, kind, ref_id, created_at').eq('user_id', caller.id).order('created_at', { ascending: false }).limit(500),
  ])

  return json({
    profile: profile.data
      ? {
          xp: profile.data.xp as number,
          streak: profile.data.streak as number,
          lastActiveDate: profile.data.last_active_date as string,
          currentCourseId: profile.data.current_course_id as string,
          enrolledCourseIds: (profile.data.enrolled_course_ids ?? []) as string[],
          goal: profile.data.goal as string,
        }
      : null,
    lessons: (lessons.data ?? []).map((row) => ({
      lessonId: row.lesson_id as string,
      courseId: row.course_id as string,
      checkPassedAt: row.check_passed_at as string | null,
      completedAt: row.completed_at as string | null,
      challengeCompletedAt: row.challenge_completed_at as string | null,
    })),
    xp: (ledger.data ?? []).map((row) => ({
      id: row.id as string,
      amount: row.amount as number,
      reason: row.reason as string,
      vars: row.vars ?? undefined,
      kind: row.kind as string,
      refId: (row.ref_id ?? undefined) as string | undefined,
      createdAt: row.created_at as string,
    })),
  })
}

/**
 * Applies a batch.
 *
 * Every write is idempotent, which is what lets a queued batch be replayed after an unknown
 * outcome. Lesson timestamps use `coalesce` so the FIRST time something happened is the one
 * kept — a replay from a device that has been offline for a week must not rewrite history
 * forwards. Ledger rows collide on either unique key and are ignored.
 */
async function apply(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<Body>(req)
  const ops = Array.isArray(body.ops) ? (body.ops as ProgressOp[]) : null
  if (!ops) throw new HttpError(400, 'invalid_input', 'Expected an array of operations.')
  if (ops.length > MAX_OPS) throw new HttpError(413, 'too_many_ops', `At most ${MAX_OPS} operations per request.`)
  if (!ops.length) return json({ ok: true, applied: 0 })

  // The row has to exist before anything references it, and the trigger on the ledger makes
  // the same guarantee — this is for the batches that carry no award.
  const { error: ensure } = await caller.db.from('student_profiles').upsert({ user_id: caller.id }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (ensure) throw new HttpError(500, 'write_failed', ensure.message)

  const lessons = new Map<string, { user_id: string; lesson_id: string; course_id: string; check_passed_at?: string; completed_at?: string; challenge_completed_at?: string }>()
  const ledger: Record<string, unknown>[] = []
  let patch: Record<string, unknown> | null = null

  for (const op of ops) {
    switch (op.t) {
      case 'lesson':
      case 'challenge':
      case 'check': {
        const row = lessons.get(op.lessonId) ?? { user_id: caller.id, lesson_id: op.lessonId, course_id: op.courseId }
        if (op.t === 'lesson') row.completed_at = op.at
        if (op.t === 'challenge') row.challenge_completed_at = op.at
        if (op.t === 'check') row.check_passed_at = op.at
        lessons.set(op.lessonId, row)
        break
      }
      case 'xp':
        ledger.push({ user_id: caller.id, amount: op.amount, reason: op.reason, vars: op.vars ?? null, kind: op.kind, ref_id: op.refId ?? null, op_id: toUuid(op.id), created_at: op.at })
        break
      case 'profile':
        patch = { ...(patch ?? {}), ...toColumns(op), updated_at: new Date().toISOString() }
        break
      // An achievement unlock is an award in the ledger, so it needs no row of its own.
      case 'achievement':
        break
    }
  }

  let applied = 0

  for (const row of lessons.values()) {
    // Read then merge then write: the FIRST timestamp for each milestone is the one kept, so
    // a replay from a device that has been offline for a week cannot move history forwards.
    const existing = await caller.db
      .from('lesson_progress')
      .select('check_passed_at, completed_at, challenge_completed_at')
      .eq('user_id', caller.id)
      .eq('lesson_id', row.lesson_id)
      .maybeSingle()

    const { error } = await caller.db.from('lesson_progress').upsert(
      {
        ...row,
        check_passed_at: existing.data?.check_passed_at ?? row.check_passed_at ?? null,
        completed_at: existing.data?.completed_at ?? row.completed_at ?? null,
        challenge_completed_at: existing.data?.challenge_completed_at ?? row.challenge_completed_at ?? null,
      },
      { onConflict: 'user_id,lesson_id' },
    )
    if (error) throw new HttpError(500, 'write_failed', error.message)
    applied++
  }

  if (ledger.length) {
    // Both unique keys are in play: (user, kind, ref) and op_id. A duplicate is not an error.
    const { error } = await caller.db.from('xp_ledger').upsert(ledger, { onConflict: 'op_id', ignoreDuplicates: true })
    if (error && !isDuplicate(error.message)) throw new HttpError(500, 'write_failed', error.message)
    applied += ledger.length
  }

  if (patch) {
    const { error } = await caller.db.from('student_profiles').update(patch).eq('user_id', caller.id)
    if (error) throw new HttpError(500, 'write_failed', error.message)
    applied++
  }

  return json({ ok: true, applied })
}

/** A duplicate is the guard working, not a fault. */
const isDuplicate = (message: string) => /duplicate key|unique constraint/i.test(message)

function toColumns(op: Extract<ProgressOp, { t: 'profile' }>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (op.patch.currentCourseId !== undefined) out.current_course_id = op.patch.currentCourseId
  if (op.patch.goal !== undefined) out.goal = op.patch.goal
  if (op.patch.enrolledCourseIds !== undefined) out.enrolled_course_ids = op.patch.enrolledCourseIds
  if (op.patch.streak !== undefined) out.streak = op.patch.streak
  if (op.patch.lastActiveDate !== undefined) out.last_active_date = op.patch.lastActiveDate
  return out
}

/**
 * The op id is a short client-minted string; `xp_ledger.op_id` is a uuid.
 *
 * Hashing it rather than asking the client for a uuid keeps the id meaningful on both sides:
 * the same operation always produces the same uuid, which is exactly what the unique
 * constraint needs from a retry.
 */
export function toUuid(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822519) >>> 0
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0')
  const a = hex(h1)
  const b = hex(h2)
  const c = hex(Math.imul(h1 ^ h2, 2654435761) >>> 0)
  const d = hex(Math.imul(h1 + h2, 40503) >>> 0)
  return `${a}-${b.slice(0, 4)}-4${b.slice(5)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }
