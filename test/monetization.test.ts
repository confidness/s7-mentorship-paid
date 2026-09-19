/**
 * The money rules, checked where they are actually decided.
 *
 * Two kinds of test live here, and the split matters:
 *
 *   - Fee arithmetic is pure, so it is checked directly and exhaustively. Money bugs are
 *     silent: nobody notices a cent, and then it is a year of cents.
 *   - The access rules are checked against the real decision functions the route uses, not
 *     against the UI. Testing "the button is hidden" would prove nothing: the question is
 *     what the server hands to someone who asks for content they never paid for.
 *
 * The important one is entitlement: a signed-in student with no entitlement row must get a
 * 402 with no tasks and no material URL, no matter what their browser claims to own.
 */

import { platformFee, mentorShare, parsePrice, formatMoney, feeBpsFromEnv, DEFAULT_PLATFORM_FEE_BPS } from '../src/lib/money.ts'
import { decideAccess, publicTask } from '../api/lesson-content.ts'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, Object.is(actual, expected), { actual, expected })

/* ------------------------------------------------------------------ fees */

console.log('platform fee arithmetic')

// The headline case from the plan: a 5000-cent lesson at 20% leaves 1000 for the platform.
eq('5000 cents at 2000 bps is a 1000 cent fee', platformFee(5000, 2000), 1000)
eq('the mentor keeps the remaining 4000', mentorShare(5000, 2000), 4000)
eq('the default is 20%', DEFAULT_PLATFORM_FEE_BPS, 2000)
eq('the default applies when no bps is given', platformFee(5000), 1000)

// Rounding has to land somewhere and be the same number in both places it is used —
// what Stripe is told, and what we write in the orders row.
eq('333 at 2000 bps rounds half-up to 67', platformFee(333, 2000), 67)
eq('1 cent at 2000 bps rounds to 0', platformFee(1, 2000), 0)
eq('3 cents at 1667 bps rounds to 1', platformFee(3, 1667), 1)
eq('a free lesson has no fee', platformFee(0, 2000), 0)
eq('0 bps takes nothing', platformFee(5000, 0), 0)
eq('10000 bps takes everything', platformFee(5000, 10000), 5000)

// The fee must never exceed the sale, or a mentor would owe money on their own lesson.
check('the fee never exceeds the amount', platformFee(7, 10000) <= 7)
for (let amount = 0; amount <= 2000; amount += 7) {
  const fee = platformFee(amount, 2000)
  if (fee < 0 || fee > amount || !Number.isInteger(fee)) {
    check(`fee stays a whole number within bounds at ${amount}`, false, { amount, fee })
    break
  }
}

// Floats are the bug this module exists to prevent. 0.1 + 0.2 !== 0.3, and a fee derived
// that way drifts. Everything here must be an exact integer.
check('fees are integers, never floats', Number.isInteger(platformFee(999, 2000)) && Number.isInteger(platformFee(1234567, 733)))

let threw = false
try {
  platformFee(10.5, 2000)
} catch {
  threw = true
}
check('a non-integer amount is refused rather than silently rounded', threw)

threw = false
try {
  platformFee(-100, 2000)
} catch {
  threw = true
}
check('a negative amount is refused', threw)

threw = false
try {
  platformFee(100, 20000)
} catch {
  threw = true
}
check('a fee above 100% is refused', threw)

eq('a bad PLATFORM_FEE_BPS falls back to the default', feeBpsFromEnv('nonsense'), DEFAULT_PLATFORM_FEE_BPS)
eq('an out-of-range PLATFORM_FEE_BPS falls back', feeBpsFromEnv('99999'), DEFAULT_PLATFORM_FEE_BPS)
eq('a valid PLATFORM_FEE_BPS is honoured', feeBpsFromEnv('1500'), 1500)

/* --------------------------------------------------------------- parsing */

console.log('prices entered by a mentor')

eq('9.99 is 999 cents', parsePrice('9.99', 'usd'), 999)
eq('a comma decimal is accepted', parsePrice('9,99', 'usd'), 999)
eq('whole numbers work', parsePrice('12', 'usd'), 1200)
// JPY has no minor unit: 500 yen is 500, not 50000.
eq('a zero-decimal currency is not multiplied', parsePrice('500', 'jpy'), 500)
eq('letters are rejected', parsePrice('free', 'usd'), null)
eq('an empty string is rejected', parsePrice('', 'usd'), null)
eq('a negative price is rejected', parsePrice('-5', 'usd'), null)
check('a formatted price contains the amount', formatMoney(999, 'usd', 'en').includes('9.99'))

/* -------------------------------------------------- the entitlement gate */

console.log('paid content is refused without an entitlement')

const CALLER = 'student-1'
const AUTHOR = 'mentor-1'

const paid = { authorId: AUTHOR, priceCents: 5000, published: true, viewerId: CALLER }

// --- the tamper case -------------------------------------------------------------------
// This is the check the whole paywall rests on. A student with a valid session but no
// entitlement row is refused, and no amount of editing their own browser changes the input
// to this function: authorId, priceCents and hasEntitlement all come from the database.
{
  const verdict = decideAccess({ ...paid, hasEntitlement: false })
  eq('an unentitled student is refused', verdict.allow, false)
  eq('and told to pay rather than that it is missing', verdict.allow === false && verdict.reason, 'payment_required')
}

{
  const verdict = decideAccess({ ...paid, hasEntitlement: true })
  eq('a paying student is let in', verdict.allow, true)
  eq('and is not treated as the author', verdict.allow === true && verdict.isAuthor, false)
}

{
  const verdict = decideAccess({ ...paid, viewerId: AUTHOR, hasEntitlement: false })
  eq('the author reaches their own lesson without buying it', verdict.allow, true)
  eq('and is recognised as the author', verdict.allow === true && verdict.isAuthor, true)
}

{
  const verdict = decideAccess({ ...paid, priceCents: 0, hasEntitlement: false })
  eq('a free lesson opens for anyone signed in', verdict.allow, true)
}

{
  const verdict = decideAccess({ ...paid, published: false, hasEntitlement: true })
  eq('someone else’s draft is not found rather than paywalled', verdict.allow === false && verdict.reason, 'not_found')
}

{
  // An author may always open their own draft — that is the edit path.
  const verdict = decideAccess({ ...paid, published: false, viewerId: AUTHOR, hasEntitlement: false })
  eq('the author still reaches their own draft', verdict.allow, true)
}

/* ------------------------------------------------------- the answer key */

console.log('quiz answers never reach a student')

const quizRow = { id: 'q1', kind: 'quiz', prompt: '180 or 320?', points: 10, options: ['180', '320'], answer_index: 1, starter: null }

{
  const forStudent = publicTask(quizRow, false)
  const wire = JSON.stringify(forStudent)

  // Absent, not null: a blanked key still describes the shape of the data, and a later change
  // that copies the row wholesale could quietly refill it.
  check('the answer key is absent from a student copy', !('answerIndex' in forStudent))
  check('and does not survive serialisation either', !wire.includes('answerIndex') && !wire.includes('answer_index'))
  check('the question itself still arrives', wire.includes('180 or 320'))
  check('so do the options to choose between', wire.includes('320'))
}

{
  // Read as a record rather than narrowing: the union type is itself the guarantee — a
  // student-facing task has no answerIndex to read, and TypeScript refuses to pretend it does.
  const forAuthor = publicTask(quizRow, true) as Record<string, unknown>
  eq('the author keeps the answer key they wrote', forAuthor.answerIndex, 1)
}

{
  // A task with no answer key must not grow one.
  const open = { id: 'w1', kind: 'open', prompt: 'Why?', points: 20, options: null, answer_index: null, starter: null }
  const forAuthor = publicTask(open, true) as Record<string, unknown>
  eq('an open question has no answer key even for the author', forAuthor.answerIndex, undefined)
}


/* ------------------------------------------------------------------ done */

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ fees round correctly and paid content stays shut without an entitlement')
}
