/**
 * Lemon Squeezy: only a correctly signed webhook makes anybody Pro, and each subscription
 * state gives Pro for exactly as long as it should. Supabase is stubbed; the route is run for
 * real.
 */

import { proUntilFor, validSignature } from '../api/_lib/billing.ts'
import { POST as lemonRoute } from '../api/billing/lemon.ts'
import { POST as deleteRoute } from '../api/account/delete.ts'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })

const SECRET = 'lemon-signing-secret-not-real'
const USER_ID = '22222222-2222-4222-8222-222222222222'

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ signatures */

console.log('signatures')
{
  const body = '{"meta":{"event_name":"subscription_created"}}'
  const good = await sign(body)
  eq('the right signature passes', await validSignature(body, good, SECRET), true)
  eq('in capitals too', await validSignature(body, good.toUpperCase(), SECRET), true)
  eq('a signature for another body fails', await validSignature(body + ' ', good, SECRET), false)
  eq('one made with another secret fails', await validSignature(body, await sign(body, 'guess'), SECRET), false)
  eq('an empty one fails', await validSignature(body, '', SECRET), false)
}

/* ------------------------------------------------------------------ how long Pro lasts */

console.log('how long Pro lasts')
{
  const renews = '2026-11-11T10:00:00.000Z'
  const ends = '2026-11-20T10:00:00.000Z'
  eq('active: until renewal, plus three days’ grace', proUntilFor('active', renews, null), '2026-11-14T10:00:00.000Z')
  eq('a trial counts as active', proUntilFor('on_trial', renews, null), '2026-11-14T10:00:00.000Z')
  eq('so does a card being retried', proUntilFor('past_due', renews, null), '2026-11-14T10:00:00.000Z')
  eq('cancelled: until the end of the paid period', proUntilFor('cancelled', renews, ends), ends)
  eq('expired gives nothing', proUntilFor('expired', renews, ends), null)
  eq('unpaid gives nothing', proUntilFor('unpaid', renews, ends), null)
  eq('paused gives nothing', proUntilFor('paused', renews, ends), null)
  eq('a date that is not a date gives nothing', proUntilFor('active', 'soon', null), null)
}

/* ------------------------------------------------------------------ the webhook */

console.log('the webhook')
process.env.SUPABASE_URL = 'https://stub.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-not-a-real-key'
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = SECRET

let writes: { method: string; url: string; body: Record<string, unknown> }[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input)
  if (!url.includes('/rest/v1/memberships')) throw new Error(`unexpected fetch: ${url}`)
  writes.push({ method: (init.method ?? 'GET').toUpperCase(), url, body: JSON.parse(String(init.body)) })
  return new Response(null, { status: 201 })
}) as typeof fetch

const event = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    meta: { event_name: name, custom_data: { user_id: USER_ID }, ...extra },
    data: { type: 'subscriptions', id: '777', attributes: { status: 'active', renews_at: '2026-11-11T10:00:00.000Z', ends_at: null } },
  })

const deliver = async (body: string, signature?: string) =>
  lemonRoute(new Request('https://brandyzer.test/api/billing/lemon', { method: 'POST', headers: { 'x-signature': signature ?? (await sign(body)) }, body }))

{
  writes = []
  const res = await deliver(event('subscription_created'))
  eq('a signed subscription event is accepted', res.status, 200)
  eq('one membership write', writes.length, 1)
  eq('keyed on the buyer the checkout named', writes[0]?.body.user_id, USER_ID)
  eq('who is Pro until renewal plus grace', writes[0]?.body.pro_until, '2026-11-14T10:00:00.000Z')
  eq('with the subscription id kept for later events', writes[0]?.body.ls_subscription_id, '777')
  check('as an upsert on user_id', writes[0]?.method === 'POST' && writes[0]?.url.includes('on_conflict=user_id'), writes[0])

  writes = []
  const forged = await deliver(event('subscription_created'), await sign(event('subscription_created'), 'guess'))
  eq('a forged signature is refused', forged.status, 400)
  eq('and writes nothing', writes.length, 0)

  writes = []
  const order = await deliver(JSON.stringify({ meta: { event_name: 'order_created', custom_data: { user_id: USER_ID } }, data: { type: 'orders', id: '1', attributes: { status: 'paid' } } }))
  eq('an order event is acknowledged', order.status, 200)
  eq('but makes nobody Pro', writes.length, 0)

  writes = []
  const invoice = JSON.stringify({ meta: { event_name: 'subscription_payment_success', custom_data: { user_id: USER_ID } }, data: { type: 'subscription-invoices', id: '9', attributes: { status: 'paid' } } })
  eq('a payment event is acknowledged', (await deliver(invoice)).status, 200)
  eq('and its invoice never touches who is Pro', writes.length, 0)

  writes = []
  const anonymous = JSON.stringify({ meta: { event_name: 'subscription_expired' }, data: { type: 'subscriptions', id: '777', attributes: { status: 'expired' } } })
  await deliver(anonymous)
  check('an event with no buyer id updates the row by subscription id', writes[0]?.method === 'PATCH' && writes[0]?.url.includes('ls_subscription_id=eq.777'), writes[0])
  eq('and an expired one ends Pro', writes[0]?.body.pro_until, null)
}

/* ------------------------------------------------------------------ deleting an account */

console.log('deleting an account')
{
  process.env.SUPABASE_ANON_KEY = 'anon-not-a-real-key'
  let status = 'active'
  let files = [{ name: 'logo.webp' }]
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${new URL(url).pathname}`)
    if (url.includes('/auth/v1/user')) return Response.json({ id: USER_ID, email: 'owner@example.com' })
    if (url.includes('/rest/v1/memberships')) return Response.json({ status })
    if (url.includes('/rest/v1/bazaar_contracts')) return new Response(null, { status: 200, headers: { 'content-range': '*/0' } })
    if (url.includes('/storage/v1/object/list/')) return Response.json(files)
    if (method === 'DELETE' && url.includes('/storage/v1/object/')) {
      files = []
      return Response.json([])
    }
    if (url.includes('/auth/v1/admin/users/')) return Response.json({})
    throw new Error(`unexpected fetch: ${method} ${url}`)
  }) as typeof fetch

  const ask = () => deleteRoute(new Request('https://brandyzer.test/api/account/delete', { method: 'POST', headers: { authorization: 'Bearer valid-token' } }))

  const refused = await ask()
  eq('a Pro subscription that still bills blocks deletion', refused.status, 409)
  check('and nothing is deleted', !calls.some((c) => c.startsWith('DELETE')), calls)

  status = 'cancelled'
  calls.length = 0
  eq('once cancelled, the account is deleted', (await ask()).status, 200)
  check('its images first', calls.some((c) => c.startsWith('DELETE /storage/v1/object/brand-assets')), calls)
  check('then the user', calls.some((c) => c === `DELETE /auth/v1/admin/users/${USER_ID}`), calls)
}

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ only a signed webhook makes anybody Pro, for exactly as long as the subscription says')
}
