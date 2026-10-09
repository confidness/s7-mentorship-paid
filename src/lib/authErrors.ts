/**
 * What a failed sign-in or sign-up actually means, as a dictionary key.
 *
 * Every sign-in failure used to read "Incorrect password", whatever Supabase had said. The most
 * common one by far is not a wrong password: Supabase requires a confirmed email by default, and
 * an unconfirmed account refuses to sign in with "Email not confirmed". Told their password was
 * wrong, people reset it, register again, and conclude the site has forgotten them.
 *
 * Kept free of the Supabase types so it can be checked in node: it reads the three fields every
 * auth error carries, and falls back on the message for older servers that send no code.
 */

export interface AuthFailure {
  code?: string
  message?: string
  status?: number
}

export type SignInProblem = 'unconfirmed' | 'credentials' | 'network' | 'rate_limited' | 'unknown'

export function signInProblem(error: AuthFailure | null | undefined): SignInProblem {
  if (!error) return 'unknown'
  const code = error.code ?? ''
  const message = error.message ?? ''
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return 'unconfirmed'
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'credentials'
  if (code.startsWith('over_') || error.status === 429 || /rate limit/i.test(message)) return 'rate_limited'
  // supabase-js reports a request that never got an answer as status 0, or as a fetch TypeError.
  if (error.status === 0 || /failed to fetch|networkerror|load failed|fetch failed/i.test(message)) return 'network'
  return 'unknown'
}

export const SIGN_IN_MESSAGE: Record<SignInProblem, string> = {
  unconfirmed: 'confirm_your_email_first',
  credentials: 'wrong_email_or_password',
  network: 'could_not_reach_the_server',
  rate_limited: 'too_many_attempts_wait',
  unknown: 'something_went_wrong_try_again',
}

/**
 * Whether a sign-up was for an email that already has an account.
 *
 * With email confirmation on, Supabase does not say so: to avoid telling a stranger which emails
 * are registered, it answers with a stand-in user that has no identities, sends no email, and
 * returns no error. Taking that at face value tells the person to confirm a link that never comes.
 */
export function signUpExisting(error: AuthFailure | null | undefined, identities: unknown[] | null | undefined): boolean {
  if (error && (error.code === 'user_already_exists' || error.code === 'email_exists' || /already registered/i.test(error.message ?? ''))) return true
  return !error && Array.isArray(identities) && identities.length === 0
}
