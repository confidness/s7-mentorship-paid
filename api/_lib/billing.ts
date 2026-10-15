/**
 * Lemon Squeezy: checking that a webhook is really theirs, and turning a subscription's state
 * into how long its owner is Pro.
 */

/** Days of Pro kept after a renewal date a card failed on, while Lemon Squeezy retries it. */
const GRACE_DAYS = 3

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * True when `signature` is the HMAC-SHA256 of the raw body under the webhook's signing secret,
 * as Lemon Squeezy sends it in X-Signature. Compared in constant time, so the check does not
 * tell an attacker how many leading characters they got right.
 */
import { IMAGE_PACK } from '../../src/lib/plans.js'

export async function validSignature(raw: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const given = signature.trim().toLowerCase()
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

/**
 * Until when a subscription in `status` makes its owner Pro, or null for not at all.
 *
 * Paying (active, on_trial, past_due while the card is retried): until the next renewal, plus
 * a few days so a renewal that lands late does not lock a paying customer out. Cancelled:
 * until the end of the period they paid for. Anything else — expired, unpaid, paused — none.
 */
/**
 * Binds a checkout link to the account that asked for it.
 *
 * The user id rides through Lemon Squeezy as checkout custom data and comes back on every
 * webhook — but it is typed into a URL, so a buyer could put anybody's id there and point
 * their own subscription at someone else's membership. The server signs the id when it hands
 * out the link; the webhook trusts the id only with this signature beside it. The prefix keeps
 * it from ever matching a webhook body signed with the same secret.
 */
export async function checkoutToken(userId: string, secret: string, kind?: OrderKind): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed(userId, kind))))
}

export const validCheckoutToken = (userId: string, token: string, secret: string, kind?: OrderKind) => validSignature(signed(userId, kind), token, secret)

/** A one-time product signs its kind too, so a link cannot be edited into the other product. */
const signed = (userId: string, kind?: OrderKind) => (kind ? `checkout:${userId}:${kind}` : `checkout:${userId}`)

/** The one-time $3 products, and what one purchase of each adds. */
export const ORDER_CREDIT = { site: 1, images: IMAGE_PACK } as const
export type OrderKind = keyof typeof ORDER_CREDIT
export const isOrderKind = (v: unknown): v is OrderKind => v === 'site' || v === 'images'

export function proUntilFor(status: string, renewsAt: unknown, endsAt: unknown): string | null {
  const date = (value: unknown) => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isNaN(time) ? null : time
  }
  if (status === 'active' || status === 'on_trial' || status === 'past_due') {
    const renews = date(renewsAt)
    return renews === null ? null : new Date(renews + GRACE_DAYS * 86_400_000).toISOString()
  }
  if (status === 'cancelled') {
    const ends = date(endsAt)
    return ends === null ? null : new Date(ends).toISOString()
  }
  return null
}
