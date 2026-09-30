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

/* ------------------------------------------------------------------ skins */

/**
 * The second axis: what the interface is made of.
 *
 * Deliberately separate from light/dark. Someone who wants the editorial skin at night wants
 * the editorial skin at night, not a different one — so a skin defines both themes and the
 * two choices never collapse into a single list of five hybrid options.
 *
 * `orbit` is the default: the platform's own world, a live 3D scene under frosted glass. The
 * rest are a choice taken in settings — `plain` among them, for anyone who would rather the
 * interface got out of the way.
 */
export type SkinChoice = 'orbit' | 'plain' | 'editorial' | 'atelier' | 'brutal' | 'terminal' | 'marketplace' | 'academy' | 'streak' | 'cinema' | 'poster'

export const DEFAULT_SKIN: SkinChoice = 'orbit'

/**
 * Two families, and the split is where they came from.
 *
 * The first six are made here — the house scene, then design disciplines: minimalism, agency
 * work, brutalism, terminal UI.
 * The second five were read off the platforms this product competes with, whose visual
 * languages are each a bet about what sells a course. Keeping the groups apart in the picker
 * is the difference between a choice and a list of ten.
 */
export const HOUSE_SKINS: SkinChoice[] = ['orbit', 'plain', 'editorial', 'atelier', 'brutal', 'terminal']
export const INDUSTRY_SKINS: SkinChoice[] = ['marketplace', 'academy', 'streak', 'cinema', 'poster']

export const SKINS: SkinChoice[] = [...HOUSE_SKINS, ...INDUSTRY_SKINS]

const SKIN_KEY = 's7-skin'

export function readSkin(): SkinChoice {
  try {
    const saved = localStorage.getItem(SKIN_KEY)
    if (saved && (SKINS as string[]).includes(saved)) return saved as SkinChoice
  } catch {
    /* storage blocked — fall through to the default */
  }
  return DEFAULT_SKIN
}

export function applySkin(skin: SkinChoice) {
  document.documentElement.dataset.skin = skin
  try {
    localStorage.setItem(SKIN_KEY, skin)
  } catch {
    /* storage blocked — the skin still applies for this session */
  }
}

/**
 * Reads the skin that is currently applied, without owning the choice.
 *
 * The same split as `useAppliedTheme`: `useSkin` writes the attribute, so anything that
 * merely needs to *know* which skin is on must observe instead, or two owners end up
 * fighting over `<html data-skin>`.
 */
export function useAppliedSkin(): SkinChoice {
  const read = (): SkinChoice => {
    const value = typeof document !== 'undefined' ? document.documentElement.dataset.skin : undefined
    return value && (SKINS as string[]).includes(value) ? (value as SkinChoice) : DEFAULT_SKIN
  }
  const [skin, setSkin] = useState<SkinChoice>(read)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setSkin(read())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['data-skin'] })
    return () => observer.disconnect()
  }, [])

  return skin
}

/** Single owner of `<html data-skin>`, the same way `useTheme` owns `data-theme`. */
export function useSkin() {
  const [skin, setSkin] = useState<SkinChoice>(readSkin)

  useEffect(() => {
    applySkin(skin)
  }, [skin])

  return { skin, setSkin }
}
