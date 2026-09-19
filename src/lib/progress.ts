import type { AppState, StudentProfile, TextVars, XPTransaction } from './types'

/**
 * Progress as operations, and the pure functions that turn state into them and back.
 *
 * Nothing here touches the network, React or the clock beyond what it copies out of the
 * states it is handed, which is what lets the whole sync story be tested with no database and
 * no mocks — see `test/progress.test.ts`.
 *
 * **Why operations rather than a snapshot.** A client that posts its whole profile lets a
 * stale tab overwrite a fresh one: last writer wins, and the loser is whoever had the better
 * data. An operation says what happened — this lesson was completed, this award was paid —
 * and applying it twice is the same as applying it once. That property is what makes the
 * offline queue safe to replay and two devices safe to interleave, and it is the reason there
 * is no locking anywhere in this design.
 *
 * **No user id on the wire.** `registerUser` mints ids like `u-a3f9x2` and the Supabase auth
 * uuid is retrofitted onto that row at sign-in, so a locally-created account can carry an id
 * that means nothing to the server. Operations therefore name no one: the server takes the
 * user from the verified JWT, which is the argument `api/_lib/server.ts` already makes —
 * a caller-supplied user id is not identification, it is a request to be someone else.
 */

/** The scalars a learner may move about themselves. Their score is not among them. */
export type ProfilePatch = Partial<Pick<StudentProfile, 'currentCourseId' | 'goal' | 'enrolledCourseIds' | 'streak' | 'lastActiveDate'>>

export type ProgressOp =
  | { id: string; t: 'lesson'; lessonId: string; courseId: string; at: string }
  | { id: string; t: 'challenge'; lessonId: string; courseId: string; at: string }
  | { id: string; t: 'check'; lessonId: string; courseId: string; at: string }
  | { id: string; t: 'achievement'; achievementId: string; at: string }
  | { id: string; t: 'xp'; amount: number; reason: string; vars?: TextVars; kind: XPTransaction['kind']; refId?: string; at: string }
  | { id: string; t: 'profile'; patch: ProfilePatch; at: string }

/** Client-minted, and it becomes `xp_ledger.op_id` — the guard against a retried request paying twice. */
const opId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const profileOf = (s: AppState, userId: string) => s.profiles.find((p) => p.userId === userId)

/**
 * Diffs two states into the operations that explain the difference.
 *
 * Diffing rather than having each of the twenty-five store mutators emit its own operation is
 * both the smaller change and the safer one: instrumenting every call site is twenty-five
 * chances to forget one, and the one forgotten is silent data loss that shows up as progress
 * that quietly fails to sync. A diff cannot be forgotten.
 */
export function opsFor(prev: AppState, next: AppState, userId: string): ProgressOp[] {
  const before = profileOf(prev, userId)
  const after = profileOf(next, userId)
  if (!after) return []

  const ops: ProgressOp[] = []
  const at = new Date().toISOString()
  const courseOf = (lessonId: string) => next.lessons.find((l) => l.id === lessonId)?.courseId ?? ''

  const added = (pick: (p: StudentProfile) => string[]) => {
    const had = new Set(before ? pick(before) : [])
    return pick(after).filter((id) => !had.has(id))
  }

  for (const lessonId of added((p) => p.completedLessonIds)) ops.push({ id: opId(), t: 'lesson', lessonId, courseId: courseOf(lessonId), at })
  for (const lessonId of added((p) => p.completedChallengeIds)) ops.push({ id: opId(), t: 'challenge', lessonId, courseId: courseOf(lessonId), at })
  for (const lessonId of added((p) => p.passedCheckLessonIds)) ops.push({ id: opId(), t: 'check', lessonId, courseId: courseOf(lessonId), at })
  for (const achievementId of added((p) => p.unlockedAchievementIds)) ops.push({ id: opId(), t: 'achievement', achievementId, at })

  // The ledger is append-only, so new rows are the ones the previous state had never seen.
  const seen = new Set(prev.xp.filter((x) => x.userId === userId).map((x) => x.id))
  for (const row of next.xp.filter((x) => x.userId === userId && !seen.has(x.id))) {
    ops.push({ id: opId(), t: 'xp', amount: row.amount, reason: row.reason, vars: row.vars, kind: row.kind, refId: row.refId, at: row.createdAt })
  }

  const patch: ProfilePatch = {}
  if (before?.currentCourseId !== after.currentCourseId) patch.currentCourseId = after.currentCourseId
  if (before?.goal !== after.goal) patch.goal = after.goal
  if ((before?.enrolledCourseIds ?? []).join() !== after.enrolledCourseIds.join()) patch.enrolledCourseIds = after.enrolledCourseIds
  if (before?.streak !== after.streak || before?.lastActiveDate !== after.lastActiveDate) {
    patch.streak = after.streak
    patch.lastActiveDate = after.lastActiveDate
  }
  if (Object.keys(patch).length) ops.push({ id: opId(), t: 'profile', patch, at })

  return ops
}

const withProfile = (s: AppState, userId: string, fn: (p: StudentProfile) => StudentProfile): AppState => ({
  ...s,
  profiles: s.profiles.map((p) => (p.userId === userId ? fn(p) : p)),
})

const addOnce = (list: string[], id: string) => (list.includes(id) ? list : [...list, id])

/**
 * Applies operations to a state. The inverse of `opsFor`, and the merge used when the server's
 * copy arrives.
 *
 * Every branch is a grow-only set insert or a monotonic write, which is what makes this
 * idempotent and order-independent — two devices can apply each other's operations in either
 * order and land in the same place. The one exception is the streak, which resets to 1 after
 * a gap and so is not monotonic; there the later `lastActiveDate` wins and an older operation
 * is ignored rather than allowed to walk it backwards.
 */
export function applyOps(state: AppState, userId: string, ops: ProgressOp[]): AppState {
  let s = state
  for (const op of ops) {
    switch (op.t) {
      case 'lesson':
        s = withProfile(s, userId, (p) => ({ ...p, completedLessonIds: addOnce(p.completedLessonIds, op.lessonId) }))
        break
      case 'challenge':
        s = withProfile(s, userId, (p) => ({ ...p, completedChallengeIds: addOnce(p.completedChallengeIds, op.lessonId) }))
        break
      case 'check':
        s = withProfile(s, userId, (p) => ({ ...p, passedCheckLessonIds: addOnce(p.passedCheckLessonIds, op.lessonId) }))
        break
      case 'achievement':
        s = withProfile(s, userId, (p) => ({ ...p, unlockedAchievementIds: addOnce(p.unlockedAchievementIds, op.achievementId) }))
        break
      case 'xp': {
        // The same guard awardXp applies, for the same reason: an award is paid once per
        // thing. Without it a replayed queue would pay a second time for a completed lesson.
        const paid = op.refId && s.xp.some((x) => x.userId === userId && x.kind === op.kind && x.refId === op.refId)
        if (paid) break
        const row: XPTransaction = {
          id: op.id,
          userId,
          amount: op.amount,
          reason: op.reason,
          vars: op.vars,
          kind: op.kind,
          refId: op.refId,
          createdAt: op.at,
        }
        s = withProfile({ ...s, xp: [row, ...s.xp] }, userId, (p) => ({ ...p, xp: p.xp + op.amount }))
        break
      }
      case 'profile':
        s = withProfile(s, userId, (p) => {
          const next = { ...p, ...op.patch }
          // An operation older than what we already have must not walk the streak backwards.
          if (op.patch.lastActiveDate && op.patch.lastActiveDate < p.lastActiveDate) {
            next.streak = p.streak
            next.lastActiveDate = p.lastActiveDate
          }
          if (op.patch.enrolledCourseIds) next.enrolledCourseIds = [...new Set([...p.enrolledCourseIds, ...op.patch.enrolledCourseIds])]
          return next
        })
        break
    }
  }
  return s
}

const BLANK: StudentProfile = {
  userId: '',
  xp: 0,
  streak: 0,
  lastActiveDate: new Date(0).toISOString(),
  enrolledCourseIds: [],
  currentCourseId: '',
  completedLessonIds: [],
  completedChallengeIds: [],
  passedCheckLessonIds: [],
  unlockedAchievementIds: [],
  goal: '',
}

/** A state holding nothing for this learner — the left side of a first-import diff. */
export const blankFor = (s: AppState, userId: string): AppState => ({
  ...s,
  profiles: s.profiles.map((p) => (p.userId === userId ? { ...BLANK, userId } : p)),
  xp: s.xp.filter((x) => x.userId !== userId),
})

/**
 * Everything this learner has, as operations.
 *
 * Used once, to hand the server what a returning user accumulated before any of this existed.
 * It is the ordinary diff against an empty profile rather than a special import path, which
 * means it inherits the same idempotence: running it twice, or on two devices with divergent
 * local state, converges instead of duplicating.
 */
export const snapshotOps = (s: AppState, userId: string): ProgressOp[] => opsFor(blankFor(s, userId), s, userId)
