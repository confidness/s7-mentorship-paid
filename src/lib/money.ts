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

/** Basis points: 10000 bps = 100%. 2000 bps = 20%. */
export const DEFAULT_PLATFORM_FEE_BPS = 2000

/** Zero-decimal currencies have no minor unit — ¥500 is 500, not 50000. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'])

export const isZeroDecimal = (currency: string) => ZERO_DECIMAL.has(currency.toLowerCase())

/**
 * The platform's cut of a sale, rounded half-up to a whole minor unit.
 *
 * Rounding has to land somewhere, and it must be deterministic: this number is sent to
 * Stripe as application_fee_amount and also written to our own orders row, and the two
 * disagreeing would make the books wrong. Computed once, here, and reused.
 */
export function platformFee(amountCents: number, bps: number = DEFAULT_PLATFORM_FEE_BPS): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error(`amount must be a non-negative integer of minor units, got ${amountCents}`)
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`fee must be 0..10000 bps, got ${bps}`)
  // Integer arithmetic start to finish; the +5000 is the half-up rounding term.
  const fee = Math.floor((amountCents * bps + 5000) / 10000)
  // A fee above the amount would make the mentor owe money on a sale.
  return Math.min(fee, amountCents)
}

/** What the mentor receives. */
export const mentorShare = (amountCents: number, bps?: number) => amountCents - platformFee(amountCents, bps)

/** Reads PLATFORM_FEE_BPS from the environment, falling back to the default. */
export function feeBpsFromEnv(raw: string | undefined): number {
  if (!raw) return DEFAULT_PLATFORM_FEE_BPS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 10000) return DEFAULT_PLATFORM_FEE_BPS
  return n
}

/**
 * Formats minor units for display. Locale-aware, because the app ships Kazakh, Russian
 * and English and a price is one of the few numbers a student reads before paying.
 */
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

/** Parses what a mentor typed ("12.50") into minor units. Returns null if it is not a price. */
export function parsePrice(input: string, currency: string): number | null {
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  const minor = isZeroDecimal(currency) ? Math.round(value) : Math.round(value * 100)
  return Number.isSafeInteger(minor) ? minor : null
}

export const isFree = (priceCents: number) => priceCents <= 0
