/**
 * Reports whether payments are configured. Names no secret and returns no value from one —
 * ServerStatus only needs to know whether a key is present, the same shape the old PIN
 * probe answered with.
 */

declare const process: { env: Record<string, string | undefined> }

export default async function handler(): Promise<Response> {
  const configured = Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.STRIPE_WEBHOOK_SECRET)
  return new Response(
    JSON.stringify({
      ok: configured,
      configured,
      // Which half is missing is the useful part when this is red.
      checkout: Boolean(process.env.STRIPE_SECRET_KEY),
      webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    }),
    { status: configured ? 200 : 501, headers: { 'content-type': 'application/json' } },
  )
}

export const config = { runtime: 'edge' }
