/**
 * The plans and what each may spend per calendar month (UTC).
 *
 * Shared by the server, which enforces the limits, and the browser, which shows them. Pro is
 * sold through Lemon Squeezy; who is Pro is the memberships table, written by its webhook.
 *
 * Pro at full use costs roughly $8–9 a month in model calls (kits ~$0.011, copy ~$0.007,
 * images ~$0.035 on paid providers) against ~$17.90 received per $20 subscription, so even a
 * subscriber who uses everything leaves a margin. Free stays on free model tiers.
 */

export const PRO_PRICE_USD = 20

export const PLAN_LIMITS = {
  free: { kit: 3, copy: 30, image: 15 },
  pro: { kit: 20, copy: 300, image: 180 },
} as const

export type Plan = keyof typeof PLAN_LIMITS
export type UsageKind = keyof (typeof PLAN_LIMITS)['free']
export const USAGE_KINDS = Object.keys(PLAN_LIMITS.free) as UsageKind[]
