/**
 * The demand board.
 *
 * GET   — open requests, loudest first, with the answers each already has.
 * POST  — publish a request.
 * PATCH — vote, unvote, withdraw, or answer one with a course you wrote.
 *
 * Reading, posting and voting run as `caller.db`, so the policies in 0008 are the boundary
 * and this file is only the shape of the conversation.
 *
 * Answering a request is the exception and uses the service role, for two reasons that are
 * the same reason: it writes rows the caller may not write. It records a fulfilment, and it
 * puts a notification in the inbox of everyone who voted — and since 0007 no browser may
 * write a notification at all, because after teaching became self-serve `is_mentor()` stopped
 * being evidence of anything.
 *
 * That makes this the platform's only fan-out, pointed at a link the fan-out's author chose.
 * `announced_at` is therefore load-bearing: a request is announced once, ever. Notifications
 * have no delete policy by design, so there is no taking one back.
 */

import { HttpError, adminClient, fail, json, readJson, requireMethod, requireUser, type Caller } from './_lib/server'

/** Enough to fill a board. Beyond this nobody scrolls, and the votes have said what matters. */
const PAGE = 100

/** One notification per voter, and a busy request should not turn into a mail-out. */
const MAX_ANNOUNCE = 200

interface CreateBody {
  title?: unknown
  body?: unknown
  budgetCents?: unknown
  currency?: unknown
  deadline?: unknown
}

interface PatchBody {
  id?: unknown
  action?: 'vote' | 'unvote' | 'withdraw' | 'fulfil'
  lessonId?: unknown
}

export default async function handler(req: Request): Promise<Response> {
  try {
    requireMethod(req, 'GET', 'POST', 'PATCH')
    const caller = await requireUser(req)
    if (req.method === 'GET') return await list(caller)
    if (req.method === 'POST') return await create(req, caller)
    return await act(req, caller)
  } catch (error) {
    return fail(error)
  }
}

const SELECT = 'id, author_id, title, body, budget_cents, currency, deadline, status, votes, created_at'

/**
 * The board, plus what the caller has already voted for.
 *
 * Their own votes come back as a separate list rather than as a flag per row: the policy
 * lets anyone read all votes, so filtering to `auth.uid()` here is one small query instead
 * of pulling every vote on the board to work out which three are theirs.
 */
async function list(caller: Caller): Promise<Response> {
  const [requests, mine, answers] = await Promise.all([
    caller.db.from('course_requests').select(SELECT).eq('status', 'open').order('votes', { ascending: false }).order('created_at', { ascending: false }).limit(PAGE),
    caller.db.from('course_request_votes').select('request_id').eq('user_id', caller.id).limit(1000),
    caller.db.from('request_fulfilments').select('request_id, lesson_id, mentor_id').limit(1000),
  ])
  if (requests.error) throw new HttpError(500, 'read_failed', requests.error.message)

  const byRequest = new Map<string, { lessonId: string; mentorId: string }[]>()
  for (const row of answers.data ?? []) {
    const list = byRequest.get(row.request_id as string) ?? []
    list.push({ lessonId: row.lesson_id as string, mentorId: row.mentor_id as string })
    byRequest.set(row.request_id as string, list)
  }

  return json({
    requests: (requests.data ?? []).map((r) => ({
      id: r.id,
      authorId: r.author_id,
      title: r.title,
      body: r.body,
      budgetCents: r.budget_cents,
      currency: r.currency,
      deadline: r.deadline ?? undefined,
      status: r.status,
      votes: r.votes,
      createdAt: r.created_at,
      answers: byRequest.get(r.id as string) ?? [],
    })),
    voted: (mine.data ?? []).map((row) => row.request_id as string),
  })
}

async function create(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<CreateBody>(req)
  const title = String(body.title ?? '').trim()
  if (title.length < 4) throw new HttpError(400, 'invalid_input', 'Say in a few words what you want to learn.')

  const budgetCents = Number(body.budgetCents ?? 0)
  if (!Number.isInteger(budgetCents) || budgetCents < 0) throw new HttpError(400, 'invalid_input', 'The budget must be a whole number of minor units.')

  // A date, or nothing. An unparseable string becomes nothing rather than an error: a
  // deadline is the least important field here and is not worth refusing a request over.
  const deadline = typeof body.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline) ? body.deadline : null

  const { data, error } = await caller.db
    .from('course_requests')
    .insert({
      author_id: caller.id,
      title: title.slice(0, 140),
      body: String(body.body ?? '').trim().slice(0, 2000),
      budget_cents: budgetCents,
      currency: String(body.currency ?? 'usd').toLowerCase().slice(0, 3),
      deadline,
    })
    .select('id')
    .single()
  if (error) throw new HttpError(500, 'write_failed', error.message)

  // Asking for something is wanting it. Voting for your own request separately would be a
  // step everybody takes and nobody means.
  await caller.db.from('course_request_votes').insert({ request_id: data.id, user_id: caller.id })

  return json({ ok: true, id: data.id }, 201)
}

async function act(req: Request, caller: Caller): Promise<Response> {
  const body = await readJson<PatchBody>(req)
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) throw new HttpError(400, 'invalid_input', 'Which request?')

  if (body.action === 'vote') {
    // A second vote by the same person collides with the primary key, which is the guard
    // working. It is not an error worth showing anyone.
    const { error } = await caller.db.from('course_request_votes').insert({ request_id: id, user_id: caller.id })
    if (error && !/duplicate key|unique constraint/i.test(error.message)) throw new HttpError(500, 'write_failed', error.message)
    return json({ ok: true })
  }

  if (body.action === 'unvote') {
    const { error } = await caller.db.from('course_request_votes').delete().eq('request_id', id).eq('user_id', caller.id)
    if (error) throw new HttpError(500, 'write_failed', error.message)
    return json({ ok: true })
  }

  if (body.action === 'withdraw') {
    // `status` is not a column the browser may write (0008 grants the author their own
    // wording and nothing else), so the write happens here, filtered to their own row.
    const { data, error } = await adminClient().from('course_requests').update({ status: 'withdrawn' }).eq('id', id).eq('author_id', caller.id).select('id').maybeSingle()
    if (error) throw new HttpError(500, 'write_failed', error.message)
    if (!data) throw new HttpError(403, 'forbidden', 'That is not your request.')
    return json({ ok: true })
  }

  if (body.action !== 'fulfil') throw new HttpError(400, 'invalid_input', 'Unknown action.')
  return await fulfil(id, String(body.lessonId ?? ''), caller)
}

/**
 * Answer a request with a course.
 *
 * The status of the request is deliberately left alone. Whether a request has been answered
 * *well enough* is the asker's judgement, not the answerer's — so a fulfilment is a fact
 * recorded alongside the request, and closing it stays with the person who opened it.
 */
async function fulfil(requestId: string, lessonId: string, caller: Caller): Promise<Response> {
  if (!lessonId) throw new HttpError(400, 'invalid_input', 'Which course answers it?')
  const db = adminClient()

  // Ownership and publication, checked here because the browser has no insert policy on
  // this table to check them for us. Announcing an unpublished lesson would send everyone
  // who voted to a page they cannot open.
  const { data: lesson } = await db.from('custom_lessons').select('author_id, title, published').eq('id', lessonId).maybeSingle()
  if (!lesson) throw new HttpError(404, 'not_found', 'No such course.')
  if (lesson.author_id !== caller.id) throw new HttpError(403, 'forbidden', 'You can only answer with a course you wrote.')
  if (!lesson.published) throw new HttpError(409, 'not_published', 'Publish the course first.')

  const { data: request } = await db.from('course_requests').select('title, status').eq('id', requestId).maybeSingle()
  if (!request) throw new HttpError(404, 'not_found', 'No such request.')
  if (request.status === 'withdrawn') throw new HttpError(409, 'withdrawn', 'That request was withdrawn.')

  const { error } = await db.from('request_fulfilments').insert({ request_id: requestId, lesson_id: lessonId, mentor_id: caller.id })
  if (error) {
    if (isDuplicate(error.message)) throw new HttpError(409, 'already_answered', 'That course is already attached to this request.')
    throw new HttpError(500, 'write_failed', error.message)
  }

  return json({ ok: true, requestId, lessonId, announced: await announce(requestId, lessonId, request.title as string, lesson.title as string, caller.id) })
}

const isDuplicate = (message: string) => /duplicate key|unique constraint/i.test(message)

/**
 * Tell the people who asked — once.
 *
 * This is the whole point of the board: a request with forty votes is forty people who said
 * they wanted this, and they should hear the day it exists rather than come across it
 * months later. It is also the one place on the platform where one person's action puts a
 * link in hundreds of inboxes, so the guard is a conditional write rather than a check: the
 * `announced_at is null` filter settles two mentors answering in the same second, exactly as
 * `api/projects.ts` settles two reviewers deciding at once.
 *
 * A second course answering the same request is recorded and stays silent. The people who
 * voted have already been told the thing they asked for exists; the rest is the board's job.
 */
async function announce(requestId: string, lessonId: string, requestTitle: string, lessonTitle: string, mentorId: string): Promise<number> {
  const db = adminClient()

  const { data: claimed } = await db
    .from('request_fulfilments')
    .update({ announced_at: new Date().toISOString() })
    .eq('request_id', requestId)
    .eq('lesson_id', lessonId)
    .is('announced_at', null)
    .select('request_id')
    .maybeSingle()
  if (!claimed) return 0

  // Already announced for this request by an earlier answer? Then this one stays quiet.
  const { count } = await db.from('request_fulfilments').select('request_id', { count: 'exact', head: true }).eq('request_id', requestId).not('announced_at', 'is', null)
  if ((count ?? 0) > 1) return 0

  const { data: voters } = await db.from('course_request_votes').select('user_id').eq('request_id', requestId).limit(MAX_ANNOUNCE)
  const audience = (voters ?? []).map((v) => v.user_id as string).filter((userId) => userId !== mentorId)
  if (!audience.length) return 0

  const { error } = await db.from('notifications').insert(
    audience.map((userId) => ({
      user_id: userId,
      title: 'notif_request_answered',
      body: 'notif_request_answered_body',
      vars: { request: requestTitle, title: lessonTitle },
      kind: 'system',
      href: `/assigned/${lessonId}`,
    })),
  )
  // Not fatal. The fulfilment is recorded and the board shows it either way, and a retry
  // would announce twice — which is the one thing this function exists to prevent.
  if (error) {
    console.error('request answered but not announced:', error.message)
    return 0
  }
  return audience.length
}

/** Node runtime: the Supabase SDK is not edge-compatible. */
export const config = { runtime: 'nodejs' }
