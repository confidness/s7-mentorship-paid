/**
 * The demand board's one piece of client-side logic: what a request is about.
 *
 * `0008_demand.sql` deliberately has no `direction` column — the board derives the subject
 * with the same function the catalogue uses, so the two can never disagree about what
 * "design" means. That is a decision worth a test, because the cheap alternative (a text
 * column somebody types) would pass every other check in the repo while quietly splitting
 * the taxonomy in two.
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

import { directionOf } from '../src/lib/discovery'

/**
 * A request has `title` and `body`; a lesson has `title` and `summary`. `directionOf` takes
 * the structural shape, not the entity, which is what lets one function serve both.
 */
const asRequest = (title: string, body: string) => ({ title, summary: body })

// The board and the catalogue agree, because it is the same call.
assert.equal(directionOf(asRequest('Хочу верстать сайты', 'Чтобы сделать лендинг самому')), 'programming', 'a Russian request about sites is programming')
assert.equal(directionOf(asRequest('IELTS 7.0', 'Нужно для поступления')), 'languages', 'an exam request is languages')
assert.equal(directionOf(asRequest('Научите готовить', 'Хотя бы пять блюд')), 'craft', 'cooking is craft')
assert.equal(directionOf(asRequest('Как вести бюджет', 'Считать деньги семьи')), 'business', 'budgeting is business')
assert.equal(directionOf(asRequest('Что-то интересное', 'Сам не знаю')), 'other', 'a vague request falls through to other, not to a wrong shelf')

// The subject can live in either field: a one-line request has no body at all.
assert.equal(directionOf(asRequest('Гитара', '')), 'music', 'the title alone is enough')
assert.equal(directionOf(asRequest('Начать с нуля', 'хочу рисовать портреты')), 'design', 'and so is the body alone')

// A lesson written to answer a request lands on the same shelf, which is what makes the
// board's filter and the catalogue's filter the same filter.
const request = asRequest('Хочу научиться играть на гитаре', 'С нуля, для себя')
const answer = { title: 'Гитара для начинающих', summary: 'Первые аккорды и бой.' }
assert.equal(directionOf(request), directionOf(answer), 'a request and the course that answers it are filed together')

console.log('✓ the demand board files a request on the same shelf the catalogue would')
