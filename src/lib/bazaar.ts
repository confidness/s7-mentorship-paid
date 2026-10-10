/**
 * The Bazaar's rules, as pure functions.
 *
 * Shared by the routes that enforce them and the pages that explain them, and tested without
 * a database. A route reads rows, asks one of these, and writes what it is told — so the rule
 * exists once, and a test of the function is a test of the route's decision.
 */

// `.js` because the API routes import this file, and Vercel loads them one file at a time
// with no bundler to resolve a bare path. scripts/check-api-imports.mjs is what catches it.
import { PLATFORM_FEE_BPS, platformFee } from './money.js'

export const CONTRACT_STATUSES = ['pending', 'funded', 'in_review', 'completed', 'canceled', 'refunded'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/**
 * Paid for and not yet finished. Mirrors `shares_brand_kit` in the schema, which is what
 * actually enforces it; this copy is for saying so in the interface.
 */
export const ACTIVE_STATUSES: readonly ContractStatus[] = ['funded', 'in_review']

export const isActive = (status: ContractStatus) => ACTIVE_STATUSES.includes(status)

export type Role = 'client' | 'freelancer' | 'both'

export const sells = (role: Role | undefined) => role === 'freelancer' || role === 'both'

/* ------------------------------------------------------------------ money */

export interface Split {
  totalCents: number
  feeCents: number
  payoutCents: number
}

/** The 5% take, and what is left for the freelancer. Three numbers that always add up. */
export function splitPayment(totalCents: number): Split {
  const feeCents = platformFee(totalCents, PLATFORM_FEE_BPS)
  return { totalCents, feeCents, payoutCents: totalCents - feeCents }
}

/* ------------------------------------------------------------------ hiring */

export type Refusal = { ok: false; status: number; code: string; message: string }

export interface HireFacts {
  callerId: string
  service: { active: boolean; freelancerId: string } | null
  /** Whether Stripe, asked just now, will move money to this freelancer. */
  freelancerCanReceive: boolean
  /** False once the freelancer has switched their account to client-only. */
  freelancerSells?: boolean
  /** Undefined when no kit was named; null when one was named and is not the caller's. */
  kitOwnerId?: string | null
}

/**
 * May this person hire this service, right now?
 *
 * Every input comes from the database or from Stripe, never from the request — the request
 * names a service and, optionally, a kit, and that is all it is trusted to do.
 */
export function decideHire(f: HireFacts): { ok: true } | Refusal {
  if (!f.service || !f.service.active) return { ok: false, status: 404, code: 'not_found', message: 'That service is not available.' }
  if (f.service.freelancerId === f.callerId) return { ok: false, status: 400, code: 'own_service', message: 'You cannot hire yourself.' }
  if (f.kitOwnerId !== undefined && f.kitOwnerId !== f.callerId) {
    // Not found rather than forbidden: whether somebody else's kit id exists is not this
    // caller's business either.
    return { ok: false, status: 404, code: 'kit_not_found', message: 'That brand kit is not yours to share.' }
  }
  // A listing outlives its owner's role switch; the hire must not.
  if (f.freelancerSells === false) return { ok: false, status: 409, code: 'seller_unavailable', message: 'This freelancer is not taking work right now.' }
  if (!f.freelancerCanReceive) return { ok: false, status: 409, code: 'seller_unavailable', message: 'This freelancer cannot take payments yet.' }
  return { ok: true }
}

/* ------------------------------------------------------------------ the contract lifecycle */

export const CONTRACT_ACTIONS = ['deliver', 'request_changes', 'accept'] as const
export type ContractAction = (typeof CONTRACT_ACTIONS)[number]

interface Transition {
  from: ContractStatus
  to: ContractStatus
  by: 'client' | 'freelancer'
}

/**
 * Everything a person may do to a contract. Payment-driven moves — pending to funded, to
 * canceled, to refunded — are absent: those are Stripe's to announce, through the webhook,
 * and no button in the interface can make them happen.
 */
export const TRANSITIONS: Record<ContractAction, Transition> = {
  deliver: { from: 'funded', to: 'in_review', by: 'freelancer' },
  request_changes: { from: 'in_review', to: 'funded', by: 'client' },
  accept: { from: 'in_review', to: 'completed', by: 'client' },
}

export function decideTransition(
  contract: { status: ContractStatus; clientId: string; freelancerId: string },
  callerId: string,
  action: ContractAction,
): { ok: true; to: ContractStatus } | Refusal {
  // Checked against the list, not by looking the action up: `TRANSITIONS["constructor"]` is
  // not undefined, and the action arrives from a request body.
  if (!(CONTRACT_ACTIONS as readonly string[]).includes(action)) return { ok: false, status: 400, code: 'invalid_action', message: 'Unknown action.' }
  const rule = TRANSITIONS[action]

  const party = callerId === contract.clientId ? 'client' : callerId === contract.freelancerId ? 'freelancer' : null
  // A stranger is told the contract does not exist, the same answer row level security gives.
  if (!party) return { ok: false, status: 404, code: 'not_found', message: 'Contract not found.' }
  if (party !== rule.by) return { ok: false, status: 403, code: 'wrong_party', message: `Only the ${rule.by} can do that.` }
  if (contract.status !== rule.from) return { ok: false, status: 409, code: 'wrong_status', message: `This contract is ${contract.status.replace('_', ' ')}.` }
  return { ok: true, to: rule.to }
}

/** Which buttons this person should see. The server decides again when one is pressed. */
export function availableActions(contract: { status: ContractStatus; clientId: string; freelancerId: string }, viewerId: string): ContractAction[] {
  return CONTRACT_ACTIONS.filter((action) => decideTransition(contract, viewerId, action).ok)
}
