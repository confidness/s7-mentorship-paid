/**
 * Serves a lesson's actual contents — tasks and teaching material — to someone entitled to it.
 *
 * This is the route the paywall actually is. Hiding a lesson behind a lock icon in the UI
 * stops nobody; refusing to send the bytes is what makes a purchase mean something. A student
 * who edits local storage, or who calls this endpoint directly with a valid session, gets the
 * same 402 as before, because ownership is read from the entitlements table on every request.
 *
 * Two things never cross the wire to a student:
 *   - answer_index, the quiz answer key. It is stripped here rather than merely unused by the
 *     UI, because "the client doesn't render it" is not the same as "the client doesn't have it".
 *   - the material's storage path. A signed URL is minted per request and expires.
 */

import { HttpError, adminClient, fail, json, requireMethod, requireUser } from './_lib/server'

/** Long enough to open a PDF, short enough that a copied link is not a distribution channel. */
const MATERIAL_URL_TTL_SECONDS = 900

/**
 * The access rule, alone and with no I/O.
 *
 * Pulled out of the handler so it can be tested exhaustively without a database: this is the
 * sentence the paywall comes down to, and it should be readable in one glance. Three ways in,
 * and only three — you wrote it, it is free, or you bought it.
 */
export function decideAccess(input: { authorId: string; priceCents: number; published: boolean; viewerId: string; hasEntitlement: boolean }):
  | { allow: true; isAuthor: boolean }
  | { allow: false; reason: 'not_found' | 'payment_required' } {
  const isAuthor = input.authorId === input.viewerId
  // An unpublished lesson does not exist as far as anyone but its author is concerned —
  // 404, not 402, because "pay to see my draft" is not an offer being made.
  if (!input.published && !isAuthor) return { allow: false, reason: 'not_found' }
  if (isAuthor || input.priceCents <= 0 || input.hasEntitlement) return { allow: true, isAuthor }
  return { allow: false, reason: 'payment_required' }
}

/**
 * Strips a task down to what a student may see.
 *
 * answer_index is removed rather than blanked: a null answer key still tells you the shape of
 * the data, and a field that is absent cannot be accidentally reintroduced by a later change
 * that copies the row wholesale.
 */
export function publicTask(task: { id: string; kind: string; prompt: string; points: number; options?: unknown; starter?: string | null; answer_index?: number | null }, forAuthor: boolean) {
  const base = { id: task.id, kind: task.kind, prompt: task.prompt, points: task.points, options: task.options ?? undefined, starter: task.starter ?? undefined }
  return forAuthor ? { ...base, answerIndex: task.answer_index ?? undefined } : base
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET')
    const caller = await requireUser(req)

    const lessonId = new URL(req.url).searchParams.get('lessonId') ?? ''
    if (!lessonId) throw new HttpError(400, 'invalid_input', 'Which lesson?')

    const db = adminClient()
    const { data: lesson, error } = await db
      .from('custom_lessons')
      .select('id, author_id, title, summary, price_cents, currency, published, material_path, material_name, material_mime, material_size')
      .eq('id', lessonId)
      .maybeSingle()
    if (error) throw new HttpError(500, 'read_failed', error.message)
    if (!lesson) throw new HttpError(404, 'not_found', 'No such lesson.')

    const isAuthor = lesson.author_id === caller.id

    // Only ask about entitlement when it could matter — an author or a free lesson needs no
    // lookup, and the rule itself is decided by decideAccess above.
    let hasEntitlement = false
    if (!isAuthor && lesson.price_cents > 0) {
      const { data: owned } = await db.from('entitlements').select('id').eq('student_id', caller.id).eq('lesson_id', lessonId).maybeSingle()
      hasEntitlement = Boolean(owned)
    }

    const verdict = decideAccess({ authorId: lesson.author_id, priceCents: lesson.price_cents, published: lesson.published, viewerId: caller.id, hasEntitlement })
    if (!verdict.allow && verdict.reason === 'not_found') throw new HttpError(404, 'not_found', 'No such lesson.')

    if (!verdict.allow) {
      // 402 Payment Required, with the teaser fields only — enough to render a buy page,
      // nothing that is being sold.
      return json(
        {
          error: 'payment_required',
          entitled: false,
          lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary, priceCents: lesson.price_cents, currency: lesson.currency },
        },
        402,
      )
    }

    const { data: taskRows, error: taskError } = await db
      .from('custom_tasks')
      .select('id, kind, prompt, points, options, starter, answer_index, position')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: true })
    if (taskError) throw new HttpError(500, 'read_failed', taskError.message)

    // The author gets the answer key back — they wrote it, and the builder needs it to edit.
    // Everyone else gets the same rows with that field absent, not blanked.
    const tasks = (taskRows ?? []).map((task) => publicTask(task, isAuthor))

    let material: { name: string; mime: string; size: number; url: string } | null = null
    if (lesson.material_path) {
      const { data: signed } = await db.storage.from('lesson-materials').createSignedUrl(lesson.material_path, MATERIAL_URL_TTL_SECONDS)
      if (signed?.signedUrl) {
        material = {
          name: lesson.material_name ?? 'material',
          mime: lesson.material_mime ?? 'application/octet-stream',
          size: lesson.material_size ?? 0,
          url: signed.signedUrl,
        }
      }
    }

    return json({
      entitled: true,
      lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary, priceCents: lesson.price_cents, currency: lesson.currency, authorId: lesson.author_id },
      tasks,
      material,
    })
  } catch (error) {
    return fail(error)
  }
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
