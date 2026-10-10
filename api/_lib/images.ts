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
 *   recraft              Recraft V4.1 with RECRAFT_API_KEY — built for logos and brand work
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

/** What the picture is for, and the kit's colours as hex. Recraft takes the colours as controls; the rest read them in the prompt. */
export interface ImageOptions {
  purpose?: 'photo' | 'logo'
  colors?: string[]
  background?: string
}

interface Provider {
  name: string
  request: (prompt: string, width: number, height: number, seed: number, options: ImageOptions) => { url: string; init: RequestInit }
  /** For a provider that answers JSON rather than the image itself. */
  read?: (res: Response) => Promise<{ type: string; bytes: ArrayBuffer }>
}

/** Image bytes straight off the response, as most providers send them. */
async function readImage(res: Response) {
  return { type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), bytes: await res.arrayBuffer() }
}

/**
 * Which Recraft model draws what. A logo is drawn a few times per kit and is the kit's face,
 * so it gets V4.1 ($0.035); photos are drawn by the dozen and get V4.1 Flash ($0.007).
 * A paid plan with better models would be decided here.
 */
export const recraftModel = (purpose?: ImageOptions['purpose']) => (purpose === 'logo' ? 'recraftv4_1' : 'recraftv4_1_flash')

/**
 * Which Pollinations model draws what, from the ones its free Quest Pollen may pay for —
 * Recraft and Ideogram there are paid-only. GPT Image follows a logo brief and spells a name
 * better than any free alternative (~0.002–0.006 pollen); Z-Image Turbo is their own photo
 * model (0.004).
 */
export const pollinationsModel = (purpose?: ImageOptions['purpose']) => (purpose === 'logo' ? 'gptimage' : 'zimage')

/** `#C65D3B` as Recraft's `{ rgb: [198, 93, 59] }`. Hexes reach here normalised by the kit. */
const rgb = (hex: string) => ({ rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) })

/** The bucket's own limit. Anything larger would be refused on upload anyway. */
const MAX_BYTES = 10 * 1024 * 1024
const ATTEMPT_MS = 40_000

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function imageProviders(): Provider[] {
  const providers: Provider[] = []
  const recraftKey = process.env.RECRAFT_API_KEY?.trim()
  if (recraftKey) {
    providers.push({
      name: 'recraft',
      request: (prompt, width, height, seed, { purpose, colors = [], background }) => ({
        url: 'https://external.api.recraft.ai/v1/images/generations',
        init: {
          method: 'POST',
          headers: { authorization: `Bearer ${recraftKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: recraftModel(purpose),
            // Every IMAGE_SHAPES size is one of V4.1's own.
            size: `${width}x${height}`,
            random_seed: seed,
            response_format: 'b64_json',
            // A logo is drawn in the kit's colours on its background. A photo is not held to
            // them: tinted to a palette, it stops looking like a photograph.
            controls: purpose === 'logo' ? { colors: colors.slice(0, 10).map(rgb), ...(background ? { background_color: rgb(background) } : {}) } : undefined,
          }),
        },
      }),
      read: async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null
        const b64 = body?.data?.[0]?.b64_json
        if (!b64) return { type: '', bytes: new ArrayBuffer(0) }
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        // WebP is Recraft's default image_format.
        return { type: 'image/webp', bytes: bytes.buffer }
      },
    })
  }

  const pollinationsKey = process.env.POLLINATIONS_API_KEY?.trim()
  if (pollinationsKey) {
    providers.push({
      name: 'pollinations',
      request: (prompt, width, height, seed, { purpose }) => ({
        url: `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${new URLSearchParams({ model: pollinationsModel(purpose), width: String(width), height: String(height), seed: String(seed), safe: 'true' })}`,
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

export async function generateImage(prompt: string, width: number, height: number, options: ImageOptions = {}): Promise<GeneratedImage> {
  const providers = imageProviders()
  if (!providers.length) throw new HttpError(501, 'not_configured', 'No image provider is configured.')

  // A fresh seed each time: asking again is how somebody says "not that one".
  const seed = Math.floor(Math.random() * 2_147_483_647)
  const failures: string[] = []

  for (const provider of providers) {
    const { url, init } = provider.request(prompt, width, height, seed, options)
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_MS) })
      if (!res.ok) {
        // The provider's own words: "invalid key" and "out of credits" need different fixes.
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120)
        failures.push(`${provider.name} ${res.status}${detail ? ` ${detail}` : ''}`)
        continue
      }
      const { type, bytes } = await (provider.read ?? readImage)(res)
      // A provider can answer 200 with an HTML error page or a JSON queue notice. Only bytes
      // that say they are an image, of a size we will store, count as an answer.
      if (!ACCEPTED.has(type)) {
        failures.push(`${provider.name} ${res.status}${type ? ` ${type}` : ' no image'}`)
        continue
      }
      if (bytes.byteLength < 1024 || bytes.byteLength > MAX_BYTES) {
        failures.push(`${provider.name} size ${bytes.byteLength}`)
        continue
      }
      if (failures.length) console.warn(`[images] ${provider.name} answered after: ${failures.join(' | ')}`)
      return { bytes, contentType: type as GeneratedImage['contentType'], provider: provider.name }
    } catch {
      failures.push(`${provider.name} timeout`)
    }
  }

  console.warn(`[images] no provider answered: ${failures.join(' | ')}`)
  throw new HttpError(502, 'upstream', `No image provider answered (${failures.join('; ')}).`)
}

export const extensionFor = (type: GeneratedImage['contentType']) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg')
