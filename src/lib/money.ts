/**
 * Money, in integer minor units.
 *
 * Every amount in this codebase is an integer count of the currency's smallest unit —
 * cents for USD, tiyn for KZT. Never a float: 0.1 + 0.2 is not 0.3 in binary floating
 * point, and a platform fee computed that way is short by somebody's cent, every time,
 * forever. Stripe's API takes minor units for the same reason.
 *
 * Shared by the client (to display a price) and the server (to charge one), so it must
 * not import anything browser- or node-specific.
 */

/**
 * Basis points: 10000 bps = 100%. 500 bps = 5%, Brandyzer's cut of a Bazaar hire.
 *
 * A constant rather than an environment variable. The interface tells a client what the
 * freelancer receives before they pay, and a fee that could differ between the page and the
 * server is a number the platform would be quoting without knowing it.
 */
export const PLATFORM_FEE_BPS = 500

/** Zero-decimal currencies have no minor unit — ¥500 is 500, not 50000. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

export const isZeroDecimal = (currency: string) => ZERO_DECIMAL.has(currency.toLowerCase())

/**
 * The platform's cut of a sale, rounded half-up to a whole minor unit.
 *
 * Rounding has to land somewhere, and it must be deterministic: this number is sent to
 * Stripe as application_fee_amount and also written to the contract row, and the two
 * disagreeing would make the books wrong. Computed once, here, and reused.
 *
 * For a whole number of cents this equals `Math.round(amount * 0.05)` exactly — the test
 * checks it across a range — without ever passing through a float.
 */
export function platformFee(amountCents: number, bps: number = PLATFORM_FEE_BPS): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error(`amount must be a non-negative integer of minor units, got ${amountCents}`)
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`fee must be 0..10000 bps, got ${bps}`)
  // Integer arithmetic start to finish; the +5000 is the half-up rounding term.
  const fee = Math.floor((amountCents * bps + 5000) / 10000)
  // A fee above the amount would make the freelancer owe money on a sale.
  return Math.min(fee, amountCents)
}

/** What the freelancer receives. */
export const payoutShare = (amountCents: number, bps?: number) => amountCents - platformFee(amountCents, bps)

/** Formats minor units for display, in the interface language rather than the OS's. */
export function formatMoney(amountCents: number, currency: string, locale = 'en'): string {
  const zero = isZeroDecimal(currency)
  const value = zero ? amountCents : amountCents / 100
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero ? 0 : 2,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(value)
  } catch {
    // An unknown currency code should not blank out a price.
    return `${value.toFixed(zero ? 0 : 2)} ${currency.toUpperCase()}`
  }
}

/** Parses what a freelancer typed ("12.50") into minor units. Returns null if it is not a price. */
export function parsePrice(input: string, currency: string): number | null {
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  const minor = isZeroDecimal(currency) ? Math.round(value) : Math.round(value * 100)
  return Number.isSafeInteger(minor) ? minor : null
}

export const isFree = (priceCents: number) => priceCents <= 0
