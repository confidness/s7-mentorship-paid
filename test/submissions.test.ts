/**
 * Answers handed in to a mentor-written lesson, and the author's verdict on them.
 *
 * The rules live in `src/lib/submissions.ts` and run in two places: the reducers in `logic.ts`
 * when there is no server, and `api/lesson-content.ts` against the answer key only the server
 * may read. Everything here is pure, so it runs with no database — what it pins down is that
 * the decisions those two places make are the same decisions, and the right ones.
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
import { opsFor } from '../src/lib/progress'
import { canHandIn, clampAward, decideReview, gradeQuiz, mergeSubmissions, reachedServer, settle, type GradedTask } from '../src/lib/submissions'
import { readAnswers } from '../api/lesson-content.ts'
import type { AppState, CustomLesson, LessonSubmission } from '../src/lib/types'

const xpOf = (s: AppState, id: string) => s.profiles.find((p) => p.userId === id)?.xp ?? 0
const assignmentRows = (s: AppState, id: string, lessonId: string) => s.xp.filter((x) => x.userId === id && x.kind === 'assignment' && x.refId === lessonId)

/** Two quizzes, ten points each, as `custom_tasks` holds them: the key is the server's. */
const QUIZ: GradedTask[] = [
  { id: 'q1', kind: 'quiz', points: 10, answerIndex: 1 },
  { id: 'q2', kind: 'quiz', points: 10, answerIndex: 0 },
]
const MIXED: GradedTask[] = [...QUIZ, { id: 'w1', kind: 'open', points: 20 }]

/* ------------------------------------------------------- marking on the server */

console.log('the server marks hand-ins, and only from the answers')

// --- a client-sent score is not read ----------------------------------------------------
// Everything in the body except the answers is something a browser made up. The route reads
// the body through `readAnswers` and marks with `settle`, and neither has anywhere to put a
// score, a status or an XP figure — so a forged one is not refused, it is simply never seen.
{
  const forged = {
    lessonId: 'L',
    quizScore: 2,
    quizTotal: 2,
    status: 'reviewed',
    awardedXp: 1000,
    answers: [
      { taskId: 'q1', value: '0', correct: true },
      { taskId: 'q2', value: '1' },
    ],
  }
  const answers = readAnswers(forged.answers, QUIZ)
  const graded = settle(QUIZ, answers)
  check('both answers are wrong, whatever the body claims', graded.quizScore === 0, graded)
  check('so the quiz pays nothing', graded.awardedXp === 0, graded)
  check('and nothing but the answer survives the body', JSON.stringify(answers) === JSON.stringify([{ taskId: 'q1', value: '0' }, { taskId: 'q2', value: '1' }]), answers)
}

// --- the key is the server's copy, not the client's --------------------------------------
{
  // A client whose copy said the answer to q1 was option 0 still scores against option 1.
  const graded = settle(QUIZ, [{ taskId: 'q1', value: '1' }, { taskId: 'q2', value: '0' }])
  check('marked against the key the server read', graded.quizScore === 2 && graded.quizTotal === 2, graded)
}

// --- the body cannot invent questions or answer one twice ---------------------------------
{
  const answers = readAnswers(
    [
      { taskId: 'q2', value: '0' },
      { taskId: 'q2', value: '1' },
      { taskId: 'not-a-question', value: '1' },
      { taskId: 'q1', value: 1 },
      'junk',
      null,
    ],
    QUIZ,
  )
  check('unknown questions are dropped', !answers.some((a) => a.taskId === 'not-a-question'))
  check('the first answer to a question is the one kept', answers.find((a) => a.taskId === 'q2')?.value === '0', answers)
  check('answers come back in the lesson’s order, as text', answers.map((a) => `${a.taskId}=${a.value}`).join() === 'q1=1,q2=0', answers)
  check('a body that is not a list is no answers at all', readAnswers({ q1: '1' }, QUIZ).length === 0)
}

// --- a blank answer is not option 0 ------------------------------------------------------
{
  // Number('') is 0, so marking used to call an untouched question right whenever the first
  // option was the answer. A crafted request would collect those for free.
  const { score } = gradeQuiz(QUIZ, [{ taskId: 'q2', value: '' }])
  check('a blank answer scores nothing', score === 0)
  const keyless = gradeQuiz([{ id: 'q', kind: 'quiz', points: 5 }], [{ taskId: 'q', value: '0' }])
  check('a question with no key cannot be got right', keyless.score === 0 && keyless.total === 1, keyless)
}

/* ------------------------------------------------------- settling on hand-in */

console.log('a quiz-only lesson settles on hand-in; anything else waits')

{
  const half = settle(QUIZ, [{ taskId: 'q1', value: '1' }, { taskId: 'q2', value: '1' }])
  check('quiz-only settles', half.status === 'reviewed', half)
  check('and pays its share of the points', half.awardedXp === 10, half)

  const waiting = settle(MIXED, [{ taskId: 'q1', value: '1' }, { taskId: 'q2', value: '0' }, { taskId: 'w1', value: 'Because.' }])
  check('a written answer waits for its author', waiting.status === 'submitted', waiting)
  check('and pays nothing until then', waiting.awardedXp === undefined, waiting)
  check('though its quiz part is already marked', waiting.quizScore === 2 && waiting.quizTotal === 2, waiting)

  check('a lesson with no questions never settles itself', settle([], []).status === 'submitted')
}

/* ------------------------------------------------------- answering again */

console.log('answering again pays nothing already paid')

{
  check('a first hand-in is allowed', canHandIn(undefined) && canHandIn(null))
  check('one waiting for review is not reopened', !canHandIn({ status: 'submitted' }))
  check('a settled one stays settled', !canHandIn({ status: 'reviewed' }))
  check('one sent back may be answered again', canHandIn({ status: 'needs_changes' }))
}

/** A student and an author, and the lesson the author wrote, built through the real reducers. */
function world(tasks: CustomLesson['tasks'], published = true) {
  let s = createInitialState()
  const author = logic.registerUser(s, { name: 'Author', email: 'author@s7.kz', role: 'mentor' })
  s = author.state
  const student = logic.registerUser(s, { name: 'Student', email: 'student@s7.kz', role: 'student' })
  s = student.state
  const lesson: CustomLesson = {
    id: 'cl-x',
    authorId: author.user!.id,
    title: 'Fixture',
    summary: 'A lesson the test owns',
    tasks,
    published,
    priceCents: 0,
    currency: 'usd',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  s = logic.saveCustomLesson(s, lesson)
  return { s, authorId: author.user!.id, studentId: student.user!.id, lesson }
}

// --- sent back, answered again, approved: paid once ---------------------------------------
{
  const mixed = [
    { id: 'q1', kind: 'quiz' as const, prompt: '?', points: 10, options: ['a', 'b'], answerIndex: 1 },
    { id: 'w1', kind: 'open' as const, prompt: 'Why?', points: 20 },
  ]
  const { authorId, studentId, lesson, ...w } = world(mixed)
  let s = w.s
  s = logic.submitLessonAnswers(s, studentId, lesson.id, [{ taskId: 'q1', value: '1' }, { taskId: 'w1', value: 'Short.' }])
  const first = s.lessonSubmissions.find((sub) => sub.lessonId === lesson.id)!
  check('written answers wait', first.status === 'submitted')

  s = logic.reviewLessonSubmission(s, first.id, authorId, 'Say why, not what.', 30, 'needs_changes')
  const back = s.lessonSubmissions.find((sub) => sub.id === first.id)!
  check('the author can send it back', back.status === 'needs_changes', back.status)
  check('sending back pays nothing', assignmentRows(s, studentId, lesson.id).length === 0)
  check('the student is told, in their own inbox', s.notifications.some((n) => n.userId === studentId && n.body === 'notif_assignment_changes_requested_body'))

  s = logic.submitLessonAnswers(s, studentId, lesson.id, [{ taskId: 'q1', value: '1' }, { taskId: 'w1', value: 'Because the fumes are toxic.' }])
  const again = s.lessonSubmissions.filter((sub) => sub.lessonId === lesson.id)
  check('answering again replaces the hand-in rather than adding one', again.length === 1 && again[0].id === first.id, again.length)
  check('and puts it back in the queue', again[0].status === 'submitted')
  check('with the new answers', again[0].answers.some((a) => a.value.includes('toxic')))
  check('and the feedback that sent it back still beside it', again[0].feedback === 'Say why, not what.')

  const before = xpOf(s, studentId)
  s = logic.reviewLessonSubmission(s, first.id, authorId, 'Exactly right.', 25)
  check('approval pays', assignmentRows(s, studentId, lesson.id).length === 1 && xpOf(s, studentId) >= before + 25)

  // Nothing reopens an approved hand-in, and if something did, the ledger would still refuse.
  const third = logic.submitLessonAnswers(s, studentId, lesson.id, [{ taskId: 'q1', value: '1' }, { taskId: 'w1', value: 'Again.' }])
  check('an approved hand-in cannot be handed in again', third === s)
  check('the lesson paid exactly once', assignmentRows(s, studentId, lesson.id).length === 1)
}

// --- a lesson already paid for is not paid again by a later approval ---------------------
{
  const { authorId, studentId, lesson, ...w } = world([{ id: 'w1', kind: 'open', prompt: 'Why?', points: 20 }])
  let s = w.s
  // An award from before — a settled quiz the lesson used to be, or a replayed ledger row.
  s = logic.awardXp(s, studentId, 12, 'xp_assignment_completed', 'assignment', lesson.id, { title: lesson.title })
  const paid = xpOf(s, studentId)
  s = logic.submitLessonAnswers(s, studentId, lesson.id, [{ taskId: 'w1', value: 'Because.' }])
  s = logic.reviewLessonSubmission(s, s.lessonSubmissions[0].id, authorId, 'Good.', 20)
  check('the second award for the same lesson is refused', assignmentRows(s, studentId, lesson.id).length === 1)
  check('so the total does not move for it', xpOf(s, studentId) - paid < 20, { before: paid, after: xpOf(s, studentId) })
}

// --- a server row recorded twice pays once ------------------------------------------------
{
  const { s, studentId, lesson } = world([])
  const row: LessonSubmission = {
    id: '6f1c2b0e-8a4d-4c3e-9b7a-1d2e3f4a5b6c',
    lessonId: lesson.id,
    studentId,
    answers: [],
    quizScore: 2,
    quizTotal: 2,
    status: 'reviewed',
    submittedAt: new Date().toISOString(),
    reviewedAt: new Date().toISOString(),
    awardedXp: 20,
  }
  const once = logic.recordHandIn(s, row, lesson.title)
  const twice = logic.recordHandIn(once, row, lesson.title)
  check('recording the same settled hand-in twice pays once', assignmentRows(twice, studentId, lesson.id).length === 1 && xpOf(twice, studentId) === xpOf(once, studentId))
  check('and keeps one row for it', twice.lessonSubmissions.filter((sub) => sub.lessonId === lesson.id).length === 1)
}

/* ------------------------------------------------------- who may decide */

console.log('only the author decides, and never about themselves')

{
  const base = { reviewerId: 'author', lessonAuthorId: 'author', studentId: 'student', status: 'submitted' as const, decision: 'approved', feedback: 'Well argued.', awardedXp: 15, maxXp: 30 }

  const ok = decideReview(base)
  check('the author may approve', ok.ok && ok.status === 'reviewed' && ok.awardedXp === 15, ok)

  // Since 0006 anyone can make themselves a mentor; owning the lesson is the authority.
  const stranger = decideReview({ ...base, reviewerId: 'another-mentor' })
  check('a mentor who did not write the lesson may not', !stranger.ok && stranger.reason === 'not_author', stranger)
  check('nor may anyone when the lesson cannot be found', !decideReview({ ...base, lessonAuthorId: '' }).ok)

  const self = decideReview({ ...base, studentId: 'author' })
  check('nobody approves their own answers', !self.ok && self.reason === 'own_work', self)

  const late = decideReview({ ...base, status: 'reviewed' })
  check('a settled hand-in is not decided twice', !late.ok && late.reason === 'not_waiting', late)
  check('nor one that is back with the student', !decideReview({ ...base, status: 'needs_changes' }).ok)

  check('an approval needs words', !decideReview({ ...base, feedback: '   ' }).ok)
  check('a decision has to be one of the two', !decideReview({ ...base, decision: 'reviewed' }).ok)

  const greedy = decideReview({ ...base, awardedXp: 9999 })
  check('the award is held to what the lesson is worth', greedy.ok && greedy.awardedXp === 30, greedy)
  const negative = decideReview({ ...base, awardedXp: -50 })
  check('and never below nothing', negative.ok && negative.awardedXp === 0, negative)
  check('a nonsense figure is nothing', clampAward(Number('lots'), 30) === 0)

  const back = decideReview({ ...base, decision: 'needs_changes', awardedXp: 30 })
  check('sending back pays nothing', back.ok && back.status === 'needs_changes' && back.awardedXp === undefined, back)
}

// --- the same rule in the reducer ----------------------------------------------------------
{
  const { s, studentId, lesson } = world([{ id: 'w1', kind: 'open', prompt: 'Why?', points: 20 }])
  const intruder = logic.registerUser(s, { name: 'Intruder', email: 'intruder@s7.kz', role: 'mentor' })
  const handed = logic.submitLessonAnswers(intruder.state, studentId, lesson.id, [{ taskId: 'w1', value: 'Because.' }])
  const after = logic.reviewLessonSubmission(handed, handed.lessonSubmissions[0].id, intruder.user!.id, 'I approve of this.', 20)
  check('a non-author’s review changes nothing', after === handed)
  check('and pays nothing', assignmentRows(after, studentId, lesson.id).length === 0)
}

/* ------------------------------------------------------- server rows into this browser */

console.log('the server’s hand-ins merge over this browser’s')

{
  const at = new Date().toISOString()
  const make = (over: Partial<LessonSubmission>): LessonSubmission => ({ id: 'x', lessonId: 'L1', studentId: 'S', answers: [], quizScore: 0, quizTotal: 0, status: 'submitted', submittedAt: at, ...over })

  const localOnly = make({ id: 'ls-draft', lessonId: 'L-local' })
  const localCopy = make({ id: 'ls-old', lessonId: 'L1', status: 'submitted', quizScore: 0 })
  const serverCopy = make({ id: '11111111-2222-4333-8444-555555555555', lessonId: 'L1', status: 'reviewed', quizScore: 2, quizTotal: 2, awardedXp: 20, studentName: 'Aisha' })
  const serverNew = make({ id: '66666666-7777-4888-9999-000000000000', lessonId: 'L2', studentId: 'T' })

  const merged = mergeSubmissions([localOnly, localCopy], [serverCopy, serverNew])
  check('a hand-in only this browser has is kept', merged.some((sub) => sub.id === 'ls-draft'))
  check('the server’s copy replaces this browser’s for the same lesson and student', merged.filter((sub) => sub.lessonId === 'L1' && sub.studentId === 'S').length === 1)
  check('and it is the server’s version that stays', merged.find((sub) => sub.lessonId === 'L1')?.status === 'reviewed')
  check('hand-ins this browser never saw arrive', merged.some((sub) => sub.studentId === 'T'))
  check('merging again changes nothing', JSON.stringify(mergeSubmissions(merged, [serverCopy, serverNew])) === JSON.stringify(merged))

  check('a uuid is a hand-in the server has seen', reachedServer(serverCopy))
  check('a local id is one it has not', !reachedServer(localCopy))
}

/* ------------------------------------------------------- a lesson fetched from the server */

console.log('a fetched lesson is marked by the server, and a local one still marks itself')

// Reported from the outside: for a lesson fetched from the server, quiz questions never marked
// themselves. The student's copy rightly has no answer key, and the local copy in state is a
// catalogue teaser with no questions at all — so marking locally scored nothing and left a
// quiz-only lesson waiting for a review. The server's mark is what lands now.
{
  const { s, studentId, lesson } = world([])
  const answers = [{ taskId: 'srv-q1', value: '1' }, { taskId: 'srv-q2', value: '0' }]

  const markedHere = logic.submitLessonAnswers(s, studentId, lesson.id, answers)
  const wrong = markedHere.lessonSubmissions.find((sub) => sub.lessonId === lesson.id)!
  check('marked against the teaser, it scores nothing and settles nothing (the bug)', wrong.quizTotal === 0 && wrong.status === 'submitted', wrong)

  const fromServer: LessonSubmission = {
    id: '0b6b3a52-2f4e-4c55-9a1b-7d1c9e0f2a33',
    lessonId: lesson.id,
    studentId,
    answers,
    quizScore: 2,
    quizTotal: 2,
    status: 'reviewed',
    submittedAt: new Date().toISOString(),
    reviewedAt: new Date().toISOString(),
    awardedXp: 20,
  }
  const before = xpOf(s, studentId)
  const landed = logic.recordHandIn(s, fromServer, lesson.title)
  const row = landed.lessonSubmissions.find((sub) => sub.lessonId === lesson.id)!
  check('the server’s mark is what the student sees', row.quizScore === 2 && row.quizTotal === 2 && row.status === 'reviewed', row)
  check('and it pays on the spot', xpOf(landed, studentId) >= before + 20, { before, after: xpOf(landed, studentId) })
  check('and says so', landed.notifications.some((n) => n.userId === studentId && n.title === 'notif_assignment_marked'))
  check('without a copy for the author, who was told by the server if at all', !landed.notifications.some((n) => n.title === 'notif_assignment_submitted'))

  // The award is shown at once and arrives from the server later; it is never posted from here.
  const ops = opsFor(s, landed, studentId)
  check('the browser does not post an award the server pays', !ops.some((op) => op.t === 'xp' && op.kind === 'assignment'), ops)
  check('it still posts the ones it may', opsFor(s, logic.awardXp(s, studentId, 5, 'xp_lesson_completed', 'lesson', 'L'), studentId).some((op) => op.t === 'xp' && op.kind === 'lesson'))
}

{
  // No server: the local copy has the key, and marking it here is still the whole story.
  const quiz = [
    { id: 'q1', kind: 'quiz' as const, prompt: '?', points: 10, options: ['a', 'b'], answerIndex: 1 },
    { id: 'q2', kind: 'quiz' as const, prompt: '?', points: 10, options: ['a', 'b'], answerIndex: 0 },
  ]
  const { s, studentId, lesson } = world(quiz)
  const marked = logic.submitLessonAnswers(s, studentId, lesson.id, [{ taskId: 'q1', value: '1' }, { taskId: 'q2', value: '0' }])
  const row = marked.lessonSubmissions.find((sub) => sub.lessonId === lesson.id)!
  check('a local lesson still marks itself', row.status === 'reviewed' && row.quizScore === 2 && row.awardedXp === 20, row)
  check('and pays', xpOf(marked, studentId) >= xpOf(s, studentId) + 20)
}

/* ------------------------------------------------------------------ done */

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ hand-ins are marked from the key, settle once, pay once, and only their author decides')
}
