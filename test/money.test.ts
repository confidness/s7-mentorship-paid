/**
 * The money rules, checked where they are decided.
 *
 * Fee arithmetic is pure, so it is checked directly and exhaustively. Money bugs are silent:
 * nobody notices a cent, and then it is a year of cents.
 */

import { PLATFORM_FEE_BPS, formatMoney, parsePrice, payoutShare, platformFee } from '../src/lib/money.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })

console.log('the 5% platform fee')

eq('the platform takes 500 bps', PLATFORM_FEE_BPS, 500)
eq('a $100 job pays a $5 fee', platformFee(10000), 500)
eq('and the freelancer keeps $95', payoutShare(10000), 9500)
eq('half a cent rounds up: 10 cents → 1 cent fee', platformFee(10), 1)
eq('just under half rounds down: 9 cents → 0', platformFee(9), 0)
eq('nothing costs nothing', platformFee(0), 0)

// The spec's own formula, Math.round(total * 0.05), must agree with the integer version for
// every amount a service can be priced at. Checked across the whole low range and a sweep of
// the rest, because a disagreement would mean Stripe and the contract row differ.
{
  let mismatch: unknown = null
  for (let cents = 0; cents <= 200_000 && !mismatch; cents++) {
    if (platformFee(cents) !== Math.round(cents * 0.05)) mismatch = { cents, ours: platformFee(cents), spec: Math.round(cents * 0.05) }
  }
  for (let cents = 200_000; cents <= 5_000_000 && !mismatch; cents += 997) {
    if (platformFee(cents) !== Math.round(cents * 0.05)) mismatch = { cents, ours: platformFee(cents), spec: Math.round(cents * 0.05) }
  }
  check('the integer fee equals Math.round(total * 0.05) everywhere it was tried', mismatch === null, mismatch)
}

{
  let broken: unknown = null
  for (let cents = 0; cents <= 50_000 && !broken; cents += 13) {
    const fee = platformFee(cents)
    if (!Number.isInteger(fee) || fee < 0 || fee > cents || fee + payoutShare(cents) !== cents) broken = { cents, fee }
  }
  check('fee and payout are whole cents that always add back up to the total', broken === null, broken)
}

for (const [label, bad] of [
  ['a fractional amount', 10.5],
  ['a negative amount', -100],
] as const) {
  let threw = false
  try {
    platformFee(bad)
  } catch {
    threw = true
  }
  check(`${label} is refused rather than silently rounded`, threw)
}

console.log('prices typed by a freelancer')

eq('150 is 15000 cents', parsePrice('150', 'usd'), 15000)
eq('a comma decimal is accepted', parsePrice('9,99', 'usd'), 999)
eq('letters are refused', parsePrice('cheap', 'usd'), null)
eq('a negative price is refused', parsePrice('-5', 'usd'), null)
check('a formatted price shows the amount', formatMoney(15000, 'usd', 'en-US').includes('150.00'))

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ 5% is exactly 5%, in whole cents, every time')
}
