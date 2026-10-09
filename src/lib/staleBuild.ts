/**
 * A tab that outlives a deploy.
 *
 * Every deploy replaces the files under /assets with new names. A page loaded before it still
 * knows only the old names, so the first time it opens a screen it had not loaded yet — the
 * catalogue after signing in, say — the import asks for a file that no longer exists and fails.
 * Nothing in that tab can recover: the cure is the new index.html, which knows the new names.
 *
 * So the app reloads itself, once. A second failure inside the window is not a stale tab — it is
 * a deploy that is broken or still uploading — and is left to reach the crash screen, which says
 * so, rather than reloading in a loop.
 */

const KEY = 's7-stale-reload'
const WINDOW_MS = 10_000

/** The messages browsers give a dynamic import that could not be fetched. */
const STALE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export const isStaleBuildError = (error: unknown): boolean => error instanceof Error && STALE.test(error.message)

interface Clock {
  now: () => number
  read: () => string | null
  write: (value: string) => void
}

/**
 * Whether this failure may spend the one reload, recording it if so.
 *
 * Storage that cannot be read or written answers no: without a record of the last attempt there
 * is no way to tell the first failure from the fifth, and a page that reloads forever is worse than
 * one that shows the crash screen.
 */
export function claimReload(clock: Clock): boolean {
  try {
    const last = Number(clock.read() ?? 0)
    if (clock.now() - last < WINDOW_MS) return false
    clock.write(String(clock.now()))
    return true
  } catch {
    return false
  }
}

let reloading = false

/** True between deciding to reload and the page going away, so the crash screen can stay out of it. */
export const isReloadingForNewBuild = () => reloading

/** Listens for Vite's report of a failed lazy import, from main.tsx, before anything renders. */
export function reloadOnStaleBuild() {
  const clock: Clock = {
    now: () => Date.now(),
    read: () => sessionStorage.getItem(KEY),
    write: (value) => sessionStorage.setItem(KEY, value),
  }
  window.addEventListener('vite:preloadError', (event) => {
    if (!claimReload(clock)) return
    reloading = true
    event.preventDefault()
    window.location.reload()
  })
}
