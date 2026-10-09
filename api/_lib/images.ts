/**
 * Image generation, through whichever free provider is configured, fetched by the server.
 *
 * The obvious build — hand the browser a Pollinations URL and let it load the picture — no
 * longer works. Pollinations moved to gen.pollinations.ai and now wants a secret key, and a
 * secret key in an <img src> is a published secret key. So the server fetches the image,
 * checks it is one, and stores it in the brand-assets bucket; the browser only ever sees our
 * own Storage URL.
 *
 * Providers, in order, each only when it can run:
 *
 *   pollinations         gen.pollinations.ai with POLLINATIONS_API_KEY
 *   huggingface          FLUX.1-schnell on HF's serverless router with HF_TOKEN
 *   pollinations-legacy  the old anonymous image.pollinations.ai endpoint — no key, heavily
 *                        rate-limited, and the reason a fresh checkout can draw anything at all
 *
 * A failure from one moves to the next; the route sees one answer or one error.
 */

declare const process: { env: Record<string, string | undefined> }

import { HttpError } from './server.js'

export interface GeneratedImage {
  bytes: ArrayBuffer
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  provider: string
}

interface Provider {
  name: string
  request: (prompt: string, width: number, height: number, seed: number) => { url: string; init: RequestInit }
}

/** The bucket's own limit. Anything larger would be refused on upload anyway. */
const MAX_BYTES = 10 * 1024 * 1024
const ATTEMPT_MS = 40_000

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function imageProviders(): Provider[] {
  const providers: Provider[] = []
  const model = process.env.POLLINATIONS_MODEL?.trim() || 'flux'

  const pollinationsKey = process.env.POLLINATIONS_API_KEY?.trim()
  if (pollinationsKey) {
    providers.push({
      name: 'pollinations',
      request: (prompt, width, height, seed) => ({
        url: `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${new URLSearchParams({ model, width: String(width), height: String(height), seed: String(seed), safe: 'true' })}`,
        init: { headers: { authorization: `Bearer ${pollinationsKey}` } },
      }),
    })
  }

  const hfToken = process.env.HF_TOKEN?.trim()
  if (hfToken) {
    providers.push({
      name: 'huggingface',
      request: (prompt, width, height, seed) => ({
        url: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
        init: {
          method: 'POST',
          headers: { authorization: `Bearer ${hfToken}`, 'content-type': 'application/json', accept: 'image/jpeg' },
          body: JSON.stringify({ inputs: prompt, parameters: { width, height, seed } }),
        },
      }),
    })
  }

  // Last, and only because something has to work on a fresh checkout. The spec's original
  // URL, nologo included; `safe` keeps it suitable for a shop's feed.
  if (process.env.POLLINATIONS_LEGACY !== 'off') {
    providers.push({
      name: 'pollinations-legacy',
      request: (prompt, width, height, seed) => ({
        url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${new URLSearchParams({ nologo: 'true', model: 'flux', width: String(width), height: String(height), seed: String(seed), safe: 'true' })}`,
        init: {},
      }),
    })
  }

  return providers
}

export async function generateImage(prompt: string, width: number, height: number): Promise<GeneratedImage> {
  const providers = imageProviders()
  if (!providers.length) throw new HttpError(501, 'not_configured', 'No image provider is configured.')

  // A fresh seed each time: asking again is how somebody says "not that one".
  const seed = Math.floor(Math.random() * 2_147_483_647)
  const failures: string[] = []

  for (const provider of providers) {
    const { url, init } = provider.request(prompt, width, height, seed)
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_MS) })
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      // A provider can answer 200 with an HTML error page or a JSON queue notice. Only bytes
      // that say they are an image, of a size we will store, count as an answer.
      if (!res.ok || !ACCEPTED.has(type)) {
        failures.push(`${provider.name} ${res.status}${type ? ` ${type}` : ''}`)
        continue
      }
      const bytes = await res.arrayBuffer()
      if (bytes.byteLength < 1024 || bytes.byteLength > MAX_BYTES) {
        failures.push(`${provider.name} size ${bytes.byteLength}`)
        continue
      }
      return { bytes, contentType: type as GeneratedImage['contentType'], provider: provider.name }
    } catch {
      failures.push(`${provider.name} timeout`)
    }
  }

  throw new HttpError(502, 'upstream', `No image provider answered (${failures.join('; ')}).`)
}

export const extensionFor = (type: GeneratedImage['contentType']) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg')
