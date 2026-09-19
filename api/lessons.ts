/**
 * Authoring and publishing lessons, and the catalogue students browse.
 *
 * The rule enforced here and nowhere else that counts: a lesson may only be published with a
 * price once its author is approved AND Stripe will accept charges for them. The builder
 * disables the button too, but a disabled button is a courtesy, not a control — this is the
 * check that holds when someone posts to the endpoint directly.
 *
 * GET           — the catalogue: published lessons as teasers, plus what the caller owns.
 * GET  ?mine=1  — the caller's own lessons, drafts included.
 * POST          — create or update a lesson and its tasks.
 * PATCH         — publish or unpublish.
 * DELETE        — remove a lesson the caller wrote.
 */

import { HttpError, adminClient, fail, json, readJson, requireMethod, requireSellingMentor, requireUser, type Caller } from './_lib/server'

const MAX_TASKS_PER_LESSON = 10

interface TaskInput {
  id?: unknown
  kind?: unknown
  prompt?: unknown
  points?: unknown
  options?: unknown
  answerIndex?: unknown
  starter?: unknown
}

interface LessonInput {
  id?: unknown
  title?: unknown
  summary?: unknown
  priceCents?: unknown
  currency?: unknown
  materialPath?: unknown
  materialName?: unknown
  materialMime?: unknown
  materialSize?: unknown
  tasks?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST', 'PATCH', 'DELETE')
    const caller = await requireUser(req)

    if (req.method === 'GET') return await list(req, caller)
    if (req.method === 'POST') return await save(req, caller)
    if (req.method === 'PATCH') return await setPublished(req, caller)
    return await remove(req, caller)
  } catch (error) {
    return fail(error)
  }
}

async function list(req: Request, caller: Caller): Promise<Response> {
  const db = adminClient()
  const mine = new URL(req.url).searchParams.get('mine') === '1'

  if (mine) {
    const { data, error } = await db
      .from('custom_lessons')
      .select('id, title, summary, price_cents, currency, published, material_name, created_at, updated_at')
      .eq('author_id', caller.id)
      .order('updated_at', { ascending: false })
    if (error) throw new HttpError(500, 'read_failed', error.message)
    return json({ lessons: (data ?? []).map(toTeaser) })
  }

  // The storefront. Prices and titles are public to signed-in users by design — a student
  // has to see what a lesson costs before deciding to buy it.
  const [{ data: lessons, error }, { data: owned }] = await Promise.all([
    db
      .from('custom_lessons')
      .select('id, author_id, title, summary, price_cents, currency, published, material_name, created_at, updated_at, profiles:author_id (name)')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(200),
    db.from('entitlements').select('lesson_id').eq('student_id', caller.id),
  ])
  if (error) throw new HttpError(500, 'read_failed', error.message)

  const entitlements = (owned ?? []).map((row) => row.lesson_id as string)
  return json({
    lessons: (lessons ?? []).map((row) => ({
      ...toTeaser(row),
      authorId: row.author_id,
      authorName: (row.profiles as { name?: string } | null)?.name ?? '',
      // Free, bought, or written by you — the three ways a lesson is already open.
      owned: entitlements.includes(row.id as string) || row.price_cents <= 0 || row.author_id === caller.id,
    })),
    entitlements,
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toTeaser = (row: any) => ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  priceCents: row.price_cents,
  currency: row.currency,
  published: row.published,
  materialName: row.material_name ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

function cleanTasks(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_TASKS_PER_LESSON).map((entry, index) => {
    const task = entry as TaskInput
    const kind = task.kind === 'quiz' || task.kind === 'code' || task.kind === 'open' ? task.kind : 'open'
    const prompt = String(task.prompt ?? '').trim()
    if (!prompt) throw new HttpError(400, 'invalid_input', `Question ${index + 1} has no prompt.`)

    const points = Number(task.points)
    if (!Number.isInteger(points) || points < 0 || points > 100) throw new HttpError(400, 'invalid_input', `Question ${index + 1} has invalid points.`)

    const options = kind === 'quiz' && Array.isArray(task.options) ? task.options.map((o) => String(o).trim()).filter(Boolean) : null
    if (kind === 'quiz' && (!options || options.length < 2)) throw new HttpError(400, 'invalid_input', `Question ${index + 1} needs at least two options.`)

    const answerIndex = kind === 'quiz' ? Number(task.answerIndex) : null
    if (kind === 'quiz' && (!Number.isInteger(answerIndex as number) || (answerIndex as number) < 0 || (answerIndex as number) >= (options as string[]).length)) {
      throw new HttpError(400, 'invalid_input', `Question ${index + 1} needs a correct answer.`)
    }

    return {
      position: index,
      kind,
      prompt,
      points,
      options,
      answer_index: answerIndex,
      starter: kind === 'code' && task.starter ? String(task.starter) : null,
    }
  })
}

async function save(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<LessonInput>(req)
  const db = adminClient()

  const title = String(body.title ?? '').trim()
  const summary = String(body.summary ?? '').trim()
  if (title.length < 3) throw new HttpError(400, 'invalid_input', 'Give the lesson a title.')
  if (summary.length < 10) throw new HttpError(400, 'invalid_input', 'Write a short summary.')

  const priceCents = Number(body.priceCents ?? 0)
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new HttpError(400, 'invalid_input', 'The price must be a whole number of minor units.')
  const currency = String(body.currency ?? 'usd').toLowerCase()
  if (currency.length !== 3) throw new HttpError(400, 'invalid_input', 'Unknown currency.')

  // A material path must live under the author's own prefix, matching the Storage policy.
  const materialPath = body.materialPath ? String(body.materialPath) : null
  if (materialPath && (materialPath.includes('..') || !materialPath.startsWith(`${caller.id}/`))) {
    throw new HttpError(400, 'invalid_input', 'That material was not uploaded by you.')
  }

  const tasks = cleanTasks(body.tasks)
  const id = typeof body.id === 'string' && body.id ? body.id : null

  const row = {
    author_id: caller.id,
    title,
    summary,
    price_cents: priceCents,
    currency,
    material_path: materialPath,
    material_name: body.materialName ? String(body.materialName) : null,
    material_mime: body.materialMime ? String(body.materialMime) : null,
    material_size: body.materialSize ? Number(body.materialSize) : null,
    updated_at: new Date().toISOString(),
  }

  let lessonId: string
  if (id) {
    const { data: existing } = await db.from('custom_lessons').select('author_id').eq('id', id).maybeSingle()
    if (!existing) throw new HttpError(404, 'not_found', 'No such lesson.')
    if (existing.author_id !== caller.id) throw new HttpError(403, 'forbidden', 'That is not your lesson.')

    const { error } = await db.from('custom_lessons').update(row).eq('id', id)
    if (error) throw new HttpError(500, 'write_failed', error.message)
    lessonId = id
  } else {
    const { data, error } = await db.from('custom_lessons').insert(row).select('id').single()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    lessonId = data.id
  }

  // Tasks are replaced wholesale. Diffing them would buy nothing: there are at most ten,
  // and a stale row surviving an edit is worse than a rewrite.
  const { error: clearError } = await db.from('custom_tasks').delete().eq('lesson_id', lessonId)
  if (clearError) throw new HttpError(500, 'write_failed', clearError.message)
  if (tasks.length) {
    const { error: insertError } = await db.from('custom_tasks').insert(tasks.map((task) => ({ ...task, lesson_id: lessonId })))
    if (insertError) throw new HttpError(500, 'write_failed', insertError.message)
  }

  return json({ ok: true, id: lessonId })
}

async function setPublished(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<{ id?: unknown; published?: unknown }>(req)
  const id = typeof body.id === 'string' ? body.id : ''
  const published = Boolean(body.published)
  if (!id) throw new HttpError(400, 'invalid_input', 'Which lesson?')

  const db = adminClient()
  const { data: lesson } = await db.from('custom_lessons').select('author_id, price_cents').eq('id', id).maybeSingle()
  if (!lesson) throw new HttpError(404, 'not_found', 'No such lesson.')
  if (lesson.author_id !== caller.id) throw new HttpError(403, 'forbidden', 'That is not your lesson.')

  // The gate. Unpublishing is always allowed — withdrawing a lesson must never be blocked
  // by a payout problem — and a free lesson needs no Stripe account at all.
  if (published && lesson.price_cents > 0) await requireSellingMentor(caller)

  const { error } = await db.from('custom_lessons').update({ published, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new HttpError(500, 'write_failed', error.message)

  return json({ ok: true, id, published })
}

async function remove(req: Request, caller: Caller): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) throw new HttpError(400, 'invalid_input', 'Which lesson?')

  const db = adminClient()
  const { data: lesson } = await db.from('custom_lessons').select('author_id').eq('id', id).maybeSingle()
  if (!lesson) throw new HttpError(404, 'not_found', 'No such lesson.')
  if (lesson.author_id !== caller.id) throw new HttpError(403, 'forbidden', 'That is not your lesson.')

  // Sold lessons are withdrawn, not deleted: the orders row references the lesson, and
  // someone who paid keeps what they paid for.
  const { count } = await db.from('entitlements').select('id', { count: 'exact', head: true }).eq('lesson_id', id)
  if (count && count > 0) {
    const { error } = await db.from('custom_lessons').update({ published: false }).eq('id', id)
    if (error) throw new HttpError(500, 'write_failed', error.message)
    return json({ ok: true, id, withdrawn: true, reason: 'students_own_this_lesson' })
  }

  const { error } = await db.from('custom_lessons').delete().eq('id', id)
  if (error) throw new HttpError(500, 'write_failed', error.message)
  return json({ ok: true, id, deleted: true })
}

/** Node runtime: the Supabase and Stripe SDKs are not edge-compatible. */
export const config = { runtime: 'nodejs' }
