/**
 * Stripe client and the platform's fee setting.
 *
 * Instantiated lazily: importing this module must not throw when STRIPE_SECRET_KEY is
 * absent, or a deployment without payments configured would fail to serve routes that
 * have nothing to do with money.
 */

declare const process: { env: Record<string, string | undefined> }

import Stripe from 'stripe'
import { feeBpsFromEnv } from '../../src/lib/money'
import { HttpError, requireEnv } from './server'

let client: Stripe | null = null

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
      // Pinned deliberately. Stripe changes shapes between versions, and a silent upgrade
      // on redeploy is a payment bug discovered in production.
      apiVersion: '2026-08-26.dahlia',
      typescript: true,
    })
  }
  return client
}

export const paymentsConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY)

/** The platform's cut, in basis points. One source of truth for checkout and the books. */
export const platformFeeBps = () => feeBpsFromEnv(process.env.PLATFORM_FEE_BPS)

/** The site's own origin, used to build Stripe return URLs. */
export function siteOrigin(req: Request): string {
  const configured = process.env.PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  throw new HttpError(500, 'not_configured', 'PUBLIC_SITE_URL is not set.')
}
