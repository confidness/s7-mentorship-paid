/**
 * What a failed sign-in is called, checked without a server.
 *
 * Every failure used to read "Incorrect password". The one that mattered most — an account whose
 * email was never confirmed — was the one it described worst, and a person told their password is
 * wrong concludes the site has forgotten them. These pin each Supabase answer to what it means,
 * and check every message exists in all three languages.
 */

import { SIGN_IN_MESSAGE, signInProblem, signUpExisting } from '../src/lib/authErrors.ts'
import { UI } from '../src/i18n/ui.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const is = (name: string, error: Parameters<typeof signInProblem>[0], expected: string) => {
  const got = signInProblem(error)
  check(name, got === expected, { got, expected })
}

console.log('auth errors')

is('an unconfirmed email, by code', { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' }, 'unconfirmed')
is('an unconfirmed email, from an older server with no code', { status: 400, message: 'Email not confirmed' }, 'unconfirmed')
is('wrong password or unknown email, by code', { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'credentials')
is('wrong password, by message alone', { status: 400, message: 'Invalid login credentials' }, 'credentials')
is('too many attempts', { code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached' }, 'rate_limited')
is('too many confirmation emails', { code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' }, 'rate_limited')
is('no answer at all (status 0)', { status: 0, message: '' }, 'network')
is("chrome's fetch failure", { message: 'Failed to fetch' }, 'network')
is("safari's fetch failure", { message: 'Load failed' }, 'network')
is('anything else is not dressed up as a wrong password', { code: 'unexpected_failure', status: 500, message: 'Database error querying schema' }, 'unknown')
is('no error object', null, 'unknown')

check('an existing email, by code', signUpExisting({ code: 'user_already_exists', message: 'User already registered' }, undefined))
check('an existing email, by message', signUpExisting({ message: 'User already registered' }, undefined))
check('an existing email hidden behind a stand-in user with no identities', signUpExisting(null, []))
check('a real new sign-up is not one', !signUpExisting(null, [{ provider: 'email' }]))
check('a sign-up that failed for another reason is not one', !signUpExisting({ code: 'weak_password', message: 'Password is too weak' }, undefined))

const keys = [...Object.values(SIGN_IN_MESSAGE), 'account_exists_sign_in', 'resend_confirmation_email', 'confirmation_email_sent', 'your_account_is_saved_on_the_server']
for (const key of keys) {
  const entry = UI[key]
  check(`"${key}" exists in en, ru and kk`, Boolean(entry?.en && entry?.ru && entry?.kk), entry)
}
check('the unconfirmed message names the address it was sent to', ['en', 'ru', 'kk'].every((l) => UI.confirm_your_email_first[l as 'en'].includes('{email}')))

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ each sign-in failure is named for what it is, a repeat sign-up is caught, and every message is in three languages')
}
