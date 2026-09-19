import type { ProgressOp } from './progress'
import * as api from './api'

/**
 * The queue between doing something and the server hearing about it.
 *
 * This is the only impure part of the sync: `progress.ts` is pure and testable, and every
 * decision that needs a clock, a network or storage is here instead.
 *
 * The existing localStorage blob is already the offline cache, so there is no Service Worker
 * and no IndexedDB. A dropped network means operations pile up here and the lesson renders
 * from local state exactly as it does today — which is also why `backendConfigured === false`
 * needs no special handling. It is the same code path as being offline forever.
 */

const KEY = 's7.outbox.v1'

/**
 * A cap, because an unbounded queue is a silent failure.
 *
 * A browser that never reconnects would otherwise grow this until a quota exception lands in
 * the persist effect's empty catch, and the user would believe their work was backed up while
 * it was being dropped. Oldest first, so the loss is at least the least recent.
 */
const MAX_QUEUED = 2000

/** Failing the same batch forever is the poisoned-queue case: one bad op blocks everything behind it. */
const MAX_ATTEMPTS = 5

/** Eager rather than polled: work that has just happened is the work most likely to be lost. */
const DEBOUNCE_MS = 2000

interface Queued {
  op: ProgressOp
  attempts: number
}

let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let currentUser: (() => string | null) | null = null

function read(): Queued[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Queued[]) : []
  } catch {
    return []
  }
}

function write(rows: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX_QUEUED)))
  } catch {
    /* storage full or blocked — the operations are still in memory for this session */
  }
}

export const pending = () => read().length

/** Queues operations and schedules a flush. Safe to call with an empty array. */
export function push(ops: ProgressOp[]) {
  if (!ops.length) return
  write([...read(), ...ops.map((op) => ({ op, attempts: 0 }))])
  schedule()
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), DEBOUNCE_MS)
}

/**
 * Sends what is queued, oldest first.
 *
 * A batch that fails is kept and retried. A batch that has failed `MAX_ATTEMPTS` times is
 * dropped rather than left at the head of the queue forever — one operation the server will
 * never accept would otherwise block every operation behind it, which is worse than losing
 * the one. The count is per operation, so a network outage does not consume attempts for
 * everything at once: a transport failure leaves the count alone.
 */
export async function flush(): Promise<void> {
  if (flushing) return
  const rows = read()
  if (!rows.length) return
  if (!currentUser?.()) return

  flushing = true
  try {
    const batch = rows.slice(0, 500)
    try {
      await api.pushProgress(batch.map((r) => r.op))
      write(rows.slice(batch.length))
    } catch (error) {
      const status = (error as { status?: number }).status
      // 4xx is the server refusing this content and it will refuse it again; 5xx and a dead
      // network are worth retrying without spending an attempt.
      const permanent = typeof status === 'number' && status >= 400 && status < 500 && status !== 429
      if (!permanent) return
      const bumped = batch.map((r) => ({ ...r, attempts: r.attempts + 1 }))
      const kept = bumped.filter((r) => r.attempts < MAX_ATTEMPTS)
      const dropped = bumped.length - kept.length
      if (dropped) console.warn(`outbox: dropped ${dropped} operation(s) the server kept refusing`)
      write([...kept, ...rows.slice(batch.length)])
    }
  } finally {
    flushing = false
  }
  // More waiting behind this batch.
  if (read().length) schedule()
}

/**
 * Starts listening. Idempotent, so a re-render cannot stack listeners.
 *
 * `getUserId` is checked rather than captured: the outbox must not post one account's work
 * under another's session, which is the failure mode that would be hardest to notice and
 * impossible to undo.
 */
let installed = false
export function install(getUserId: () => string | null) {
  currentUser = getUserId
  if (installed) return
  installed = true
  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => {
    // Hidden is the last moment anything is guaranteed to run, so flush on the way out too.
    void flush()
  })
}
