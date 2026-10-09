/**
 * A tab that outlives a deploy, checked without a browser.
 *
 * What matters is small and easy to get wrong in the direction that hurts: recognising the
 * failure in every browser's wording, reloading the first time, and never reloading in a loop —
 * a page that reloads forever is worse than the crash screen it was meant to avoid.
 */

import { claimReload, isStaleBuildError } from '../src/lib/staleBuild.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

/* ------------------------------------------------------------------ the failure, in each browser's words */

console.log('stale build')

check('chrome', isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://s7-mentorship-paid.vercel.app/assets/Courses-Cd_rA7qL.js')))
check('firefox', isStaleBuildError(new TypeError('error loading dynamically imported module: https://example.test/assets/Courses-x.js')))
check('safari', isStaleBuildError(new TypeError('Importing a module script failed.')))
check("vite's own css preload", isStaleBuildError(new Error('Unable to preload CSS for /assets/Courses-x.css')))
check('an ordinary render error is not one', !isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'id')")))
check('a thrown string is not one', !isStaleBuildError('Failed to fetch dynamically imported module'))
check('nothing is not one', !isStaleBuildError(undefined))

/* ------------------------------------------------------------------ one reload, never a loop */

function memory(start: number) {
  let now = start
  let stored: string | null = null
  return {
    clock: { now: () => now, read: () => stored, write: (value: string) => void (stored = value) },
    wait: (ms: number) => void (now += ms),
  }
}

{
  const tab = memory(1_000_000)
  check('the first failure reloads', claimReload(tab.clock))
  tab.wait(1_500)
  check('a second failure straight after does not, so a broken deploy cannot loop', !claimReload(tab.clock))
  tab.wait(8_000)
  check('nor one just inside ten seconds (9.5 s after the first)', !claimReload(tab.clock))
  tab.wait(60_000)
  check('a later deploy, a minute on, gets its own reload', claimReload(tab.clock))
}

{
  const blocked = { now: () => 5_000_000, read: () => { throw new Error('SecurityError') }, write: () => undefined }
  check('storage that cannot be read never reloads: it could not tell the first try from the fifth', !claimReload(blocked))
  const readOnly = { now: () => 5_000_000, read: () => null, write: () => { throw new Error('QuotaExceededError') } }
  check('nor storage that cannot be written', !claimReload(readOnly))
}

/* ------------------------------------------------------------------ done */

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ a failed import is recognised in every browser, reloads once, and never loops')
}
