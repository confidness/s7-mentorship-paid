/**
 * The four properties the whole sync design rests on.
 *
 * All of them are about `src/lib/progress.ts`, which is pure — so this runs with no database,
 * no network and no mocks. If these hold, a replayed offline queue cannot double-pay, two
 * devices cannot diverge, and importing a returning user's history twice is harmless. If any
 * of them stops holding, the sync is unsafe no matter what the server does.
 *
 *   npm run check
 */

declare const process: { exitCode?: number }

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

import { createInitialState } from '../src/lib/seed'
import * as logic from '../src/lib/logic'
import { applyOps, opsFor, snapshotOps } from '../src/lib/progress'
import type { AppState, StudentProfile } from '../src/lib/types'

const profile = (s: AppState, id: string) => s.profiles.find((p) => p.userId === id) as StudentProfile

/** A learner with some history, built through the real reducers rather than by hand. */
function seeded() {
  let s = createInitialState()
  const reg = logic.registerUser(s, { name: 'Learner', email: 'l@s7.kz', password: 'secret123', role: 'student' })
  s = reg.state
  const id = reg.user!.id
  s = logic.awardXp(s, id, 100, 'xp_lesson_completed', 'lesson', 'L1')
  s = logic.awardXp(s, id, 60, 'xp_challenge_completed', 'challenge', 'C1')
  s = { ...s, profiles: s.profiles.map((p) => (p.userId === id ? { ...p, completedLessonIds: ['L1'], passedCheckLessonIds: ['L1'], unlockedAchievementIds: ['first-lesson'] } : p)) }
  return { s, id }
}

console.log('progress sync')

// 1 — the diff loses nothing -------------------------------------------------------------
{
  const { s, id } = seeded()
  const rebuilt = applyOps(blankLike(s, id), id, snapshotOps(s, id))
  const a = profile(s, id)
  const b = profile(rebuilt, id)
  check('round trip keeps xp', a.xp === b.xp, { a: a.xp, b: b.xp })
  check('round trip keeps completed lessons', a.completedLessonIds.join() === b.completedLessonIds.join(), b.completedLessonIds)
  check('round trip keeps achievements', a.unlockedAchievementIds.join() === b.unlockedAchievementIds.join(), b.unlockedAchievementIds)
  check('round trip keeps the ledger length', rebuilt.xp.filter((x) => x.userId === id).length === s.xp.filter((x) => x.userId === id).length)
}

/** The same state with this learner emptied — what the first import diffs against. */
function blankLike(s: AppState, id: string): AppState {
  return {
    ...s,
    profiles: s.profiles.map((p) =>
      p.userId === id
        ? { ...p, xp: 0, completedLessonIds: [], completedChallengeIds: [], passedCheckLessonIds: [], unlockedAchievementIds: [], streak: 0, lastActiveDate: new Date(0).toISOString() }
        : p,
    ),
    xp: s.xp.filter((x) => x.userId !== id),
  }
}

// 2 — applying twice changes nothing ------------------------------------------------------
// This is the retry story and the re-import story in one assertion: a queue flushed twice
// after an unknown outcome, or an import that ran on two devices.
{
  const { s, id } = seeded()
  const ops = snapshotOps(s, id)
  const once = applyOps(blankLike(s, id), id, ops)
  const twice = applyOps(once, id, ops)
  check('replaying the same ops pays nothing extra', profile(twice, id).xp === profile(once, id).xp, { once: profile(once, id).xp, twice: profile(twice, id).xp })
  check('replaying adds no ledger rows', twice.xp.filter((x) => x.userId === id).length === once.xp.filter((x) => x.userId === id).length)
  check('replaying adds no duplicate lessons', profile(twice, id).completedLessonIds.length === profile(once, id).completedLessonIds.length)
}

// 3 — two devices converge whichever order they merge in ----------------------------------
{
  const { s, id } = seeded()
  const base = s

  // device A finishes L2, device B finishes L3, neither has seen the other
  const deviceA = logic.awardXp({ ...base, profiles: base.profiles.map((p) => (p.userId === id ? { ...p, completedLessonIds: [...p.completedLessonIds, 'L2'] } : p)) }, id, 100, 'xp_lesson_completed', 'lesson', 'L2')
  const deviceB = logic.awardXp({ ...base, profiles: base.profiles.map((p) => (p.userId === id ? { ...p, completedLessonIds: [...p.completedLessonIds, 'L3'] } : p)) }, id, 100, 'xp_lesson_completed', 'lesson', 'L3')

  const opsA = opsFor(base, deviceA, id)
  const opsB = opsFor(base, deviceB, id)

  const ab = applyOps(applyOps(base, id, opsA), id, opsB)
  const ba = applyOps(applyOps(base, id, opsB), id, opsA)

  check('both orders reach the same xp', profile(ab, id).xp === profile(ba, id).xp, { ab: profile(ab, id).xp, ba: profile(ba, id).xp })
  check('both orders reach the same lessons', [...profile(ab, id).completedLessonIds].sort().join() === [...profile(ba, id).completedLessonIds].sort().join())
  check('both devices work is kept', profile(ab, id).completedLessonIds.includes('L2') && profile(ab, id).completedLessonIds.includes('L3'), profile(ab, id).completedLessonIds)
}

// 4 — an award is still paid once ----------------------------------------------------------
// The client half of the unique index in 0002. An op carrying an award already in the ledger
// must add nothing, or a replay would pay twice for one completed lesson.
{
  const { s, id } = seeded()
  const before = profile(s, id).xp
  const duplicate = opsFor(blankLike(s, id), s, id).filter((o) => o.t === 'xp')
  const after = applyOps(s, id, duplicate)
  check('an award already in the ledger adds nothing', profile(after, id).xp === before, { before, after: profile(after, id).xp })

  // An award with no ref is deliberately not deduplicated — there is nothing to key on, which
  // is why the schema also carries a unique op_id.
  const noRef = logic.awardXp(s, id, 5, 'xp_lesson_completed', 'lesson')
  check('an award without a ref still goes through', profile(noRef, id).xp === before + 5)
}

// 5 — the streak cannot be walked backwards ------------------------------------------------
{
  const { s, id } = seeded()
  const recent = new Date().toISOString()
  const stale = new Date(Date.now() - 86_400_000 * 3).toISOString()
  const current = applyOps(s, id, [{ id: 'o1', t: 'profile', patch: { streak: 9, lastActiveDate: recent }, at: recent }])
  const afterStale = applyOps(current, id, [{ id: 'o2', t: 'profile', patch: { streak: 1, lastActiveDate: stale }, at: stale }])
  check('an older streak op is ignored', profile(afterStale, id).streak === 9, profile(afterStale, id).streak)
  check('the newer last-active date survives', profile(afterStale, id).lastActiveDate === recent)
}

console.log(failures === 0 ? '✓ ops round-trip, replay safely, converge in either order and pay once' : `${failures} failed`)
if (failures) process.exitCode = 1
