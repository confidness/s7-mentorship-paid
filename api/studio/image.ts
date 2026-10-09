/**
 * Draws an image in a brand's style, stores it, and returns its URL.
 *
 * The kit's image_style directives and palette are folded into every prompt by
 * `buildImagePrompt` — the owner types "sourdough loaf on the counter" and the model is told
 * the rest. That is the feature: the tenth photo looks like the same shop as the first
 * without anybody retyping "natural light, 35mm grain" nine times.
 *
 * Purpose "logo" also sets the kit's logo_url, and only the owner may do that. A freelancer
 * reading a shared kit can draw photos in its style; they cannot replace the client's logo.
 * Row level security would refuse the write anyway — this says so before an image is spent.
 */

import { IMAGE_PURPOSES, IMAGE_SHAPES, buildImagePrompt, type ImagePurpose, type ImageShape } from '../../src/lib/brand.js'
import { HttpError, fail, json, readJson, requireMethod, requireUser, str, uuidOrNull } from '../_lib/server.js'
import { generateImage } from '../_lib/images.js'
import { loadKit, storeImage } from '../_lib/studio.js'

interface Body {
  brandKitId?: unknown
  purpose?: unknown
  subject?: unknown
  shape?: unknown
}

async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'POST')
    const caller = await requireUser(req)
    const body = await readJson<Body>(req)

    const kitId = uuidOrNull(body.brandKitId)
    if (!kitId) throw new HttpError(400, 'invalid_input', 'Which brand kit?')
    const purpose: ImagePurpose = (IMAGE_PURPOSES as readonly string[]).includes(String(body.purpose)) ? (body.purpose as ImagePurpose) : 'photo'
    // Own keys only: `in` would also accept "constructor" and "toString" off the prototype.
    const shape: ImageShape = purpose !== 'logo' && Object.keys(IMAGE_SHAPES).includes(String(body.shape)) ? (body.shape as ImageShape) : 'square'
    const subject = str(body.subject, 400)
    if (purpose === 'photo' && subject.length < 3) throw new HttpError(400, 'invalid_input', 'Describe what the picture should show.')

    const kit = await loadKit(caller, kitId)
    if (purpose === 'logo' && kit.user_id !== caller.id) throw new HttpError(403, 'forbidden', 'Only the owner can change a brand’s logo.')

    const prompt = buildImagePrompt({
      purpose,
      // A logo with no direction of its own leans on the kit's description of itself.
      subject: subject || kit.vibe_summary,
      brandName: kit.brand_name,
      offering: kit.business_json?.offering,
      palette: kit.palette_json ?? [],
      imageStyle: kit.voice_rules_json?.image_style ?? [],
    })

    const [width, height] = IMAGE_SHAPES[shape]
    const image = await generateImage(prompt, width, height)
    const url = await storeImage(caller.id, image)

    if (purpose === 'logo') {
      const { error } = await caller.db.from('brand_kits').update({ logo_url: url }).eq('id', kit.id)
      if (error) throw new HttpError(500, 'write_failed', error.message)
    }

    return json({ url, prompt, provider: image.provider })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: Storage uploads go through the Supabase SDK. Duration is set in vercel.json. */
export const config = { runtime: 'nodejs' }

/** Vercel's Node runtime treats a default export as `(req, res) => void` and drops the returned Response; named methods get the Web `Request`. Each handler rejects the methods it does not serve. */
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
