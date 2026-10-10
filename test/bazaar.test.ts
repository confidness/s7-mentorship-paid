/**
 * Who may hire whom, and who may move a contract where.
 *
 * These are the decision functions the routes call, so a check here is a check of the route's
 * judgement — without a database, and without Stripe.
 */

import { ACTIVE_STATUSES, availableActions, decideHire, decideTransition, splitPayment, type ContractAction, type ContractStatus } from '../src/lib/bazaar.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })

const CLIENT = 'client-1'
const FREELANCER = 'freelancer-1'
const STRANGER = 'someone-else'

/* ------------------------------------------------------------------ split */

console.log('the split')
{
  const s = splitPayment(15000)
  eq('$150 → $7.50 to Brandyzer', s.feeCents, 750)
  eq('$150 → $142.50 to the freelancer', s.payoutCents, 14250)
  eq('and the total is what was charged', s.totalCents, 15000)
}

/* ------------------------------------------------------------------ hiring */

console.log('hiring')

const open = { active: true, freelancerId: FREELANCER }
const code = (v: ReturnType<typeof decideHire>) => (v.ok ? 'ok' : v.code)

eq('a client may hire an active service whose freelancer can be paid', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: true })), 'ok')
eq('a missing service is not found', code(decideHire({ callerId: CLIENT, service: null, freelancerCanReceive: true })), 'not_found')
eq('a paused service is not found either', code(decideHire({ callerId: CLIENT, service: { ...open, active: false }, freelancerCanReceive: true })), 'not_found')
eq('nobody hires themselves', code(decideHire({ callerId: FREELANCER, service: open, freelancerCanReceive: true })), 'own_service')
eq('a freelancer Stripe will not pay cannot be hired', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: false })), 'seller_unavailable')
eq('the caller’s own kit may be shared', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: true, kitOwnerId: CLIENT })), 'ok')
// The case the composite foreign key exists for: naming somebody else's kit on your contract.
eq('somebody else’s kit may not be shared', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: true, kitOwnerId: STRANGER })), 'kit_not_found')
eq('a kit id that does not exist is refused the same way', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: true, kitOwnerId: null })), 'kit_not_found')
eq('a freelancer who switched to client-only cannot be hired', code(decideHire({ callerId: CLIENT, service: open, freelancerCanReceive: true, freelancerSells: false })), 'seller_unavailable')
// Order matters: the route asks Stripe only after the cheap refusals, by calling this twice.
eq('the cheap refusals come before the Stripe one', code(decideHire({ callerId: FREELANCER, service: open, freelancerCanReceive: false })), 'own_service')

/* ------------------------------------------------------------------ the lifecycle */

console.log('the contract lifecycle')

const contract = (status: ContractStatus) => ({ status, clientId: CLIENT, freelancerId: FREELANCER })
const move = (status: ContractStatus, caller: string, action: ContractAction) => {
  const v = decideTransition(contract(status), caller, action)
  return v.ok ? v.to : v.code
}

eq('the freelancer delivers funded work', move('funded', FREELANCER, 'deliver'), 'in_review')
eq('the client accepts it', move('in_review', CLIENT, 'accept'), 'completed')
eq('or sends it back', move('in_review', CLIENT, 'request_changes'), 'funded')
eq('the client cannot deliver', move('funded', CLIENT, 'deliver'), 'wrong_party')
eq('the freelancer cannot accept their own work', move('in_review', FREELANCER, 'accept'), 'wrong_party')
eq('nothing is delivered before it is paid for', move('pending', FREELANCER, 'deliver'), 'wrong_status')
eq('a completed contract stays completed', move('completed', CLIENT, 'request_changes'), 'wrong_status')
eq('a refunded contract cannot be delivered into', move('refunded', FREELANCER, 'deliver'), 'wrong_status')
eq('a stranger is told it does not exist', move('in_review', STRANGER, 'accept'), 'not_found')
// The action arrives from a request body. An object key that is not an action must not be
// found on the prototype and treated as one.
eq('"constructor" is not an action', move('funded', FREELANCER, 'constructor' as ContractAction), 'invalid_action')
eq('nor is "toString"', move('funded', FREELANCER, 'toString' as ContractAction), 'invalid_action')

// Payment states belong to the webhook alone. Every move a person can make, from every
// status, by either party: none leaves `pending` (only money arriving does that), and none
// lands on canceled, refunded or back on pending.
{
  const moves: string[] = []
  for (const status of ['pending', 'funded', 'in_review', 'completed', 'canceled', 'refunded'] as ContractStatus[]) {
    for (const caller of [CLIENT, FREELANCER]) {
      for (const action of ['deliver', 'request_changes', 'accept'] as ContractAction[]) {
        const v = decideTransition(contract(status), caller, action)
        if (v.ok) moves.push(`${status}→${v.to}`)
      }
    }
  }
  check('no button moves an unpaid contract', !moves.some((m) => m.startsWith('pending→')), moves)
  check('no button cancels, refunds or un-pays one', !moves.some((m) => /→(canceled|refunded|pending)$/.test(m)), moves)
  eq('exactly three moves exist', moves.sort().join(' '), 'funded→in_review in_review→completed in_review→funded')
}

{
  eq('the freelancer sees one button on funded work', availableActions(contract('funded'), FREELANCER).join(), 'deliver')
  eq('the client sees two in review', availableActions(contract('in_review'), CLIENT).join(), 'request_changes,accept')
  eq('a stranger sees none', availableActions(contract('in_review'), STRANGER).length, 0)
}

/* ------------------------------------------------------------------ the kit rule */

console.log('which statuses share the brand kit')
eq('funded and in review, and nothing else', [...ACTIVE_STATUSES].sort().join(), 'funded,in_review')

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ hires need a payable freelancer and the client’s own kit; contracts move only the way the rules say')
}
