import type { CustomTask, LessonSubmission, TaskAnswer } from './types'

/**
 * The rules for answers handed in to a mentor-written lesson, alone and with no I/O.
 *
 * Shared by the reducers in `logic.ts`, which run in the browser when there is no server, and
 * by `api/lesson-content.ts`, which runs them against the answer key only the server may read.
 * One copy of each rule, used in both places — a second copy on the server is the thing most
 * likely to drift, and the first place it would drift is the number of XP somebody is paid.
 *
 * So it must not import anything browser- or node-specific, and nothing but types from the
 * rest of `src/lib`: Vercel loads it from a Node function file by file, with no bundler.
 */

/** What grading needs to know about a question. The server builds this from `custom_tasks`. */
export type GradedTask = Pick<CustomTask, 'id' | 'kind' | 'points' | 'answerIndex'>

/** What a lesson is worth: the most a reviewer may award, and what a perfect quiz pays. */
export const lessonPoints = (tasks: Pick<CustomTask, 'points'>[]) => tasks.reduce((n, t) => n + t.points, 0)

/** Quiz questions mark themselves. Anything written by hand needs a person to read it. */
export function gradeQuiz(tasks: GradedTask[], answers: TaskAnswer[]): { score: number; total: number } {
  const quizzes = tasks.filter((t) => t.kind === 'quiz')
  const score = quizzes.reduce((n, task) => {
    const given = answers.find((a) => a.taskId === task.id)?.value
    // A blank answer is not choice 0: Number('') is 0, which would mark an untouched question
    // right whenever the first option was the answer.
    return given !== undefined && given !== '' && task.answerIndex !== undefined && Number(given) === task.answerIndex ? n + 1 : n
  }, 0)
  return { score, total: quizzes.length }
}

/** A lesson made only of quizzes has nothing for a person to read, so nobody is asked to. */
export const marksItself = (tasks: Pick<CustomTask, 'kind'>[]) => tasks.length > 0 && tasks.every((t) => t.kind === 'quiz')

/**
 * What a hand-in is the moment it arrives.
 *
 * The score is computed here from the answers and the key, and there is deliberately no way
 * to pass one in. A client that sends `quizScore: 10` is sending a field nothing reads.
 *
 * A lesson made only of quizzes settles on the spot and pays its share of the points. One with
 * code or written answers waits for its author — the same review loop projects use.
 */
export function settle(tasks: GradedTask[], answers: TaskAnswer[]): { quizScore: number; quizTotal: number; status: 'submitted' | 'reviewed'; awardedXp?: number } {
  const { score, total } = gradeQuiz(tasks, answers)
  if (!marksItself(tasks)) return { quizScore: score, quizTotal: total, status: 'submitted' }
  return { quizScore: score, quizTotal: total, status: 'reviewed', awardedXp: total ? Math.round((score / total) * lessonPoints(tasks)) : 0 }
}

/**
 * Whether answers may be handed in now.
 *
 * Once, unless the author sent them back. A hand-in waiting for review is the author's to read
 * as it stands, and a settled one is settled — reopening it would be a second go at a quiz
 * whose result has already been paid.
 */
export const canHandIn = (existing?: Pick<LessonSubmission, 'status'> | null) => !existing || existing.status === 'needs_changes'

/** Never below nothing, never above what the lesson is worth, and always a whole number. */
export const clampAward = (awarded: number, cap: number) => Math.max(0, Math.min(Math.round(Number(awarded) || 0), cap))

export type ReviewDecision = 'approved' | 'needs_changes'

export type ReviewVerdict =
  | { ok: true; status: 'reviewed' | 'needs_changes'; awardedXp?: number }
  | { ok: false; reason: 'not_author' | 'own_work' | 'not_waiting' | 'no_decision' | 'no_feedback' }

/**
 * The author's decision about one hand-in.
 *
 * Authority here is owning the lesson, not being a mentor. Since 0006 anyone can call
 * themselves a mentor with one click, so the role says nothing about whose work you may judge;
 * the lesson's `author_id` does. Nobody reviews their own answers, even on their own lesson.
 *
 * There is no claim step, unlike projects. A project can be picked up by any mentor, so two
 * of them could write contradicting reviews of the same work and claiming is what stops that.
 * A lesson has exactly one author and only they may decide, so there is nobody to collide with
 * — two tabs of the same author are settled by the write itself, which only matches a hand-in
 * still waiting.
 *
 * Approving pays what the author chose, held to what the lesson is worth. Sending it back pays
 * nothing: the answers are not finished, and the XP is paid when they are.
 */
export function decideReview(input: {
  reviewerId: string
  lessonAuthorId: string
  studentId: string
  status: LessonSubmission['status']
  decision: unknown
  feedback: string
  awardedXp: number
  maxXp: number
}): ReviewVerdict {
  if (!input.lessonAuthorId || input.reviewerId !== input.lessonAuthorId) return { ok: false, reason: 'not_author' }
  if (input.studentId === input.reviewerId) return { ok: false, reason: 'own_work' }
  if (input.status !== 'submitted') return { ok: false, reason: 'not_waiting' }
  if (input.decision !== 'approved' && input.decision !== 'needs_changes') return { ok: false, reason: 'no_decision' }
  if (!input.feedback.trim()) return { ok: false, reason: 'no_feedback' }
  if (input.decision === 'needs_changes') return { ok: true, status: 'needs_changes' }
  return { ok: true, status: 'reviewed', awardedXp: clampAward(input.awardedXp, input.maxXp) }
}

/** A server id is a uuid; a hand-in minted in this browser is `ls-…`. */
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether the server has ever seen this hand-in.
 *
 * With a backend, a hand-in only lands in local state after the server accepted it, carrying
 * the server's id. One with a local id was made before that was true — when answers to a lesson
 * fetched from the server were marked against a local copy with no questions in it, scored
 * nothing, and waited for a review no mentor could see. Those have to be sent again.
 */
export const reachedServer = (submission: Pick<LessonSubmission, 'id'>) => SERVER_ID.test(submission.id)

/**
 * Folds the server's hand-ins into the ones this browser holds.
 *
 * Keyed by lesson and student rather than by id, because that pair is unique on the server and
 * a local copy of the same hand-in may carry a local id. The server wins for every pair it
 * knows: its copy was graded against the real key and carries the author's decision. Pairs it
 * does not know are kept rather than dropped — they may be answers that never made it, and
 * throwing away somebody's written work to tidy a list is the wrong trade.
 */
export function mergeSubmissions(local: LessonSubmission[], remote: LessonSubmission[]): LessonSubmission[] {
  const key = (s: Pick<LessonSubmission, 'lessonId' | 'studentId'>) => `${s.lessonId}:${s.studentId}`
  const fromServer = new Map(remote.map((s) => [key(s), s]))
  const kept = local.filter((s) => !fromServer.has(key(s)))
  return [...remote, ...kept]
}
