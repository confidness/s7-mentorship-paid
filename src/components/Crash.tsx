import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isReloadingForNewBuild, isStaleBuildError } from '../lib/staleBuild'

/**
 * Anything rather than a white screen.
 *
 * React unmounts the whole tree when a render throws, so one bad read — a profile that is not
 * there, an id that moved — takes the entire app down to a blank page with nothing written on
 * it. That is the worst possible failure: nothing to read, nothing to click, and a reload
 * reproduces it exactly, because the state that caused it is still in localStorage.
 *
 * This does not fix crashes. It makes them legible, and gives back the one action that gets a
 * person moving again — clearing the saved state that the next reload would load right back.
 *
 * Deliberately not translated. It renders when the app is already broken, and reaching for
 * the dictionary here is one more thing that can throw on the way to saying so.
 *
 * Colours come from the theme tokens, not white. This screen used to paint a white card and
 * then write on it in `ink-900` — which the dark theme turns near-white — so in the dark the
 * one screen meant to explain a failure could not be read.
 */
export default class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render failed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    // The page is already on its way to the new version; a crash screen would flash for nothing.
    if (isReloadingForNewBuild()) return null

    // An update published while this tab was open, and the automatic reload either already ran
    // or could not. Saying so is more use than a module URL.
    const stale = isStaleBuildError(error)

    return (
      <div className="grid min-h-screen place-items-center bg-[var(--color-canvas)] p-6 text-ink-900">
        <div className="w-full max-w-lg border-2 border-ink-900 bg-ink-50 p-6 shadow-[6px_6px_0_0_var(--color-ink-900)]">
          <h1 className="text-2xl font-bold tracking-[-0.03em]">{stale ? 'The site was updated' : 'Something broke on this screen'}</h1>
          <p className="mt-2 text-sm text-ink-600">
            {stale
              ? 'A new version went live while this page was open, and part of the old one is no longer there to load. Reloading fetches the new version; nothing you saved is lost.'
              : 'The page stopped rendering rather than showing you something wrong. The message below is what went wrong.'}
          </p>

          <pre className="mt-4 max-h-48 overflow-auto border-2 border-ink-900 bg-ink-100 p-3 text-xs whitespace-pre-wrap text-ink-800">
            {error.message}
          </pre>

          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => window.location.reload()} className="border-2 border-ink-900 bg-accent-400 px-5 py-2.5 text-sm font-semibold text-on-accent shadow-[4px_4px_0_0_var(--color-ink-900)]">
              Reload
            </button>
            {/* The saved blob is usually what is broken, and reloading alone loads it again — but not
                when the site was simply updated, where clearing it would throw away work for nothing. */}
            {!stale && (
            <button
              onClick={() => {
                try {
                  localStorage.clear()
                } catch {
                  /* blocked storage — the reload is still worth trying */
                }
                window.location.href = '/'
              }}
              className="border-2 border-ink-900 bg-ink-50 px-5 py-2.5 text-sm font-semibold text-ink-900 shadow-[4px_4px_0_0_var(--color-ink-900)]"
            >
              Clear saved data and start over
            </button>
            )}
          </div>
        </div>
      </div>
    )
  }
}
