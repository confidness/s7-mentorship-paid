/**
 * Stripe client, and what this platform asks of a connected account.
 *
 * Instantiated lazily: importing this module must not throw when STRIPE_SECRET_KEY is
 * absent, or a deployment without payments configured would fail to serve the Studio routes,
 * which have nothing to do with money.
 */

declare const process: { env: Record<string, string | undefined> }

import Stripe from 'stripe'
import { HttpError, requireEnv } from './server.js'

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

/**
 * Tags every hire's Checkout Session so this flow can be told apart in the Dashboard. The
 * eight-letter suffix is Stripe's own convention for these labels; it is fixed, not random
 * per request, so every hire is filed under the same one.
 */
export const HIRE_INTEGRATION_ID = 'brandyzer-bazaar-hire-qkrvmzta'

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

/* ------------------------------------------------------------------ connected accounts (v2) */

/**
 * A freelancer is a *recipient*: Brandyzer runs the checkout and is the merchant of record,
 * and the freelancer's account receives a transfer out of each charge — a destination charge.
 * So the account asks for exactly one capability, `stripe_balance.stripe_transfers`, and not
 * card payments, which a recipient never takes itself and which would only lengthen
 * onboarding.
 *
 * Accounts v2 rather than v1's `type: 'express'`: the dashboard, who pays Stripe's fees and
 * who carries a negative balance are separate settings here, and for a marketplace on
 * destination charges the platform carries both — a refund or a dispute is reversed out of
 * Brandyzer's balance first.
 */
export const RECIPIENT_INCLUDE: Stripe.V2.Core.AccountRetrieveParams['include'] = ['configuration.recipient', 'requirements']

export async function createRecipientAccount(input: { email?: string; name: string; userId: string }) {
  return stripe().v2.core.accounts.create({
    contact_email: input.email,
    display_name: input.name.slice(0, 100),
    dashboard: 'express',
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    include: RECIPIENT_INCLUDE,
    metadata: { userId: input.userId },
  })
}

export interface RecipientState {
  /** Whether a destination charge to this account will succeed. The only gate on taking money. */
  transfersActive: boolean
  status: string
  /** Stripe's own words for what it is still waiting on from the freelancer. */
  requirements: string[]
}

/**
 * Reads the account's transfer capability. The v2 path, not `charges_enabled`, which is a v1
 * field and describes a capability a recipient does not have.
 */
export function recipientState(account: Stripe.V2.Core.Account): RecipientState {
  const status = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? 'unrequested'
  const requirements = (account.requirements?.entries ?? []).filter((entry) => entry.awaiting_action_from === 'user').map((entry) => entry.description)
  return { transfersActive: status === 'active', status, requirements: [...new Set(requirements)].slice(0, 10) }
}

export async function retrieveRecipient(accountId: string): Promise<RecipientState> {
  return recipientState(await stripe().v2.core.accounts.retrieve(accountId, { include: RECIPIENT_INCLUDE }))
}
