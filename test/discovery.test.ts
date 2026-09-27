/**
 * The offline course search.
 *
 * This is the half that has to work when nothing else does — no key, no credit, no network —
 * so it is worth more than a smoke test. What is checked here is the behaviour the UI and
 * the advisor both lean on: filters exclude, the query only orders, and a course that
 * matches none of what was asked for never appears at all.
 *
 *   npm run check
 */

const assert = {
  ok(value: unknown, message = 'expected a truthy value') {
    if (!value) throw new Error(`FAILED: ${message}`)
  },
  equal<T>(actual: T, expected: T, message = 'values differ') {
    if (actual !== expected) throw new Error(`FAILED: ${message} — got ${String(actual)}, expected ${String(expected)}`)
  },
}

import type { CustomLesson, CustomTask } from '../src/lib/types'
import { directionOf, formatOf, lengthOf, minutesOf, searchLessons, shortlistFor } from '../src/lib/discovery'

let n = 0
const quiz = (): CustomTask => ({ id: `t${++n}`, kind: 'quiz', prompt: 'q', points: 5, options: ['a', 'b'], answerIndex: 1 })
const open = (): CustomTask => ({ id: `t${++n}`, kind: 'open', prompt: 'q', points: 10 })
const codeTask = (): CustomTask => ({ id: `t${++n}`, kind: 'code', prompt: 'q', points: 20 })

function lesson(partial: Partial<CustomLesson> & { id: string; title: string }): CustomLesson {
  return {
    authorId: 'a1',
    authorName: 'Aigerim',
    summary: '',
    tasks: [],
    published: true,
    priceCents: 0,
    currency: 'usd',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

const CATALOGUE: CustomLesson[] = [
  lesson({ id: 'fig', title: 'Figma с нуля', summary: 'Первый экран, сетка и типографика.', tasks: [open(), open()], priceCents: 0 }),
  lesson({ id: 'py', title: 'Python basics', summary: 'Loops, functions and a first script.', tasks: [codeTask(), codeTask(), quiz()], priceCents: 1200 }),
  lesson({ id: 'gui', title: 'Гитара для начинающих', summary: 'Первые аккорды и бой.', tasks: [quiz(), quiz()], priceCents: 500 }),
  lesson({ id: 'ielts', title: 'IELTS Writing Task 2', summary: 'Structure, linking, band 7.', tasks: [open()], priceCents: 3000 }),
  lesson({ id: 'read', title: 'Про деньги', summary: 'Как считать личный бюджет.', material: { name: 'budget.pdf', mime: 'application/pdf', size: 100 }, tasks: [], priceCents: 0 }),
]

// --- what a course is about, read off its own words -------------------------------------
assert.equal(directionOf(CATALOGUE[0]), 'design', 'Figma is design')
assert.equal(directionOf(CATALOGUE[1]), 'programming', 'Python is programming')
assert.equal(directionOf(CATALOGUE[2]), 'music', 'a guitar course is music, in Russian')
assert.equal(directionOf(CATALOGUE[3]), 'languages', 'IELTS is languages')
assert.equal(directionOf(CATALOGUE[4]), 'business', 'a budget is business')
assert.equal(directionOf(lesson({ id: 'x', title: 'Кулинария', summary: 'Готовим дома' })), 'craft', 'cooking, in Russian')

// --- format and length, from the work rather than a promise ------------------------------
assert.equal(formatOf(CATALOGUE[1]), 'coding', 'a code task makes it a coding course')
assert.equal(formatOf(CATALOGUE[2]), 'quiz', 'all-quiz is a quiz course')
assert.equal(formatOf(CATALOGUE[0]), 'practice', 'open questions are practice')
assert.equal(formatOf(CATALOGUE[4]), 'reading', 'material and no questions is reading')
assert.ok(minutesOf(CATALOGUE[1]) > minutesOf(CATALOGUE[2]), 'two coding tasks take longer than two quiz items')
assert.equal(lengthOf(CATALOGUE[2]), 'short', 'two quiz questions is a short one')

// --- filters exclude ---------------------------------------------------------------------
{
  const free = searchLessons(CATALOGUE, { freeOnly: true })
  assert.ok(
    free.every((m) => m.lesson.priceCents === 0),
    'free only means free only',
  )
  assert.equal(free.length, 2, 'two free courses in the fixture')

  // A paid course that matches the words perfectly still must not appear.
  const freeAndPython = searchLessons(CATALOGUE, { freeOnly: true, query: 'python' })
  assert.equal(freeAndPython.length, 0, 'a filter is not a preference the query can overrule')

  const cheap = searchLessons(CATALOGUE, { maxPriceCents: 1000 })
  assert.ok(
    cheap.every((m) => m.lesson.priceCents <= 1000),
    'the price ceiling holds',
  )

  assert.equal(searchLessons(CATALOGUE, { direction: 'music' }).length, 1, 'one music course')
  assert.equal(searchLessons(CATALOGUE, { format: 'coding' })[0]?.lesson.id, 'py', 'the coding filter finds the coding course')
}

// --- the query orders, and never invents a match -----------------------------------------
{
  assert.equal(searchLessons(CATALOGUE, { query: 'figma' })[0]?.lesson.id, 'fig', 'an exact title word wins')
  assert.equal(searchLessons(CATALOGUE, { query: 'гитар' })[0]?.lesson.id, 'gui', 'a Russian stem finds the inflected title')
  assert.equal(searchLessons(CATALOGUE, { query: 'аккорды' })[0]?.lesson.id, 'gui', 'a word from the summary counts too')
  assert.equal(searchLessons(CATALOGUE, { query: 'Aigerim' })[0]?.lesson.id !== undefined, true, 'the teacher is searchable')

  // The failure that makes a search feel broken: something unrelated at the top because
  // every course scored a little on the tie-breakers.
  assert.equal(searchLessons(CATALOGUE, { query: 'подводное плавание' }).length, 0, 'no match means no results, not the whole catalogue')

  const both = searchLessons(CATALOGUE, { query: 'python loops' })
  assert.equal(both[0]?.lesson.id, 'py', 'two matching words beat one')

  // Free-first only breaks ties; it must not overturn a real text match.
  assert.equal(searchLessons(CATALOGUE, { query: 'ielts' })[0]?.lesson.id, 'ielts', 'a paid exact match still wins over a free non-match')
}

// --- an empty query is a browse, not an error --------------------------------------------
{
  const all = searchLessons(CATALOGUE)
  assert.equal(all.length, CATALOGUE.length, 'everything comes back')
  assert.equal(all[0].lesson.priceCents, 0, 'free is offered first when nothing else separates them')
}

// --- the shortlist handed to the model ---------------------------------------------------
{
  const vague = shortlistFor(CATALOGUE, 'I want to earn more money', 12)
  assert.ok(vague.length > 0, 'a question with no course words still gets options rather than silence')
  assert.ok(vague.length <= CATALOGUE.length, 'and never more than there are')

  const specific = shortlistFor(CATALOGUE, 'python', 12)
  assert.equal(specific[0]?.lesson.id, 'py', 'a clear question keeps its answer at the top')

  assert.equal(shortlistFor([], 'anything', 12).length, 0, 'an empty catalogue shortlists nothing')
}

console.log('✓ the offline course search filters, ranks and refuses to invent a match')

// --- reputation nudges, and absence costs nothing ----------------------------------------
//
// The second of these is the one that matters. `stats` is undefined for every lesson
// whenever the backend is unconfigured — which is the entire scenario this module exists for
// — so adding a popularity term must leave that case byte-identical to before.
{
  const withStats = CATALOGUE.map((l) => (l.id === 'gui' ? { ...l, stats: { buyers: 40, starters: 60 } } : l))

  const plain = searchLessons(CATALOGUE).map((m) => m.lesson.id).join(',')
  const nudged = searchLessons(withStats).map((m) => m.lesson.id).join(',')
  assert.ok(plain !== nudged, 'a course other people took is ordered ahead of one nobody has')

  // The cap is the contract: popularity breaks ties, it does not win arguments.
  const popular = { ...CATALOGUE[2], stats: { buyers: 5000, starters: 5000 } }
  const searched = searchLessons([popular, ...CATALOGUE.filter((l) => l.id !== 'gui')], { query: 'figma' })
  assert.equal(searched[0]?.lesson.id, 'fig', 'a text match still beats any amount of popularity')

  // No stats anywhere: identical to the day before the feature existed.
  const before = searchLessons(CATALOGUE, { query: 'python' }).map((m) => `${m.lesson.id}:${m.score.toFixed(6)}`).join('|')
  const after = searchLessons(CATALOGUE.map((l) => ({ ...l, stats: undefined })), { query: 'python' }).map((m) => `${m.lesson.id}:${m.score.toFixed(6)}`).join('|')
  assert.equal(after, before, 'a lesson with no stats scores exactly as it always did')

  console.log('✓ popularity breaks ties without overturning a match, and absence is free')
}
