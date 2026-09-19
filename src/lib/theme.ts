/**
 * Theme: light, dark, or follow the system. The chosen mode is written to
 * `<html data-theme>`, which every colour token in index.css keys off.
 *
 * index.html applies the stored choice before first paint, so there is no flash.
 */
import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 's7-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export const resolveTheme = (choice: ThemeChoice): 'light' | 'dark' => (choice === 'system' ? (media().matches ? 'dark' : 'light') : choice)

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* storage blocked — fall through to system */
  }
  return 'system'
}

export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolveTheme(choice)
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* storage blocked — the theme still applies for this session */
  }
}

/**
 * Reads the theme that is currently applied, without owning the choice.
 *
 * `useTheme` writes `<html data-theme>` on mount, so anything that merely needs to *know* the
 * theme must not call it — two owners would fight over the attribute. This observes instead,
 * which also means it picks up a change made by the pre-paint script in index.html.
 */
export function useAppliedTheme(): 'light' | 'dark' {
  const read = () => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const [theme, setTheme] = useState<'light' | 'dark'>(read)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setTheme(el.dataset.theme === 'dark' ? 'dark' : 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}

/**
 * True when the visitor has asked for less motion.
 *
 * index.css collapses CSS animation and transition durations under this preference, but that
 * rule reaches neither WebGL nor JavaScript-driven animation — both have to ask for themselves.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return reduced
}

/** Single source of truth for the toggle; also follows the OS while set to `system`. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice)

  useEffect(() => {
    applyTheme(choice)
    if (choice !== 'system') return
    const mq = media()
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])

  return { choice, resolved: resolveTheme(choice), setChoice }
}
