/**
 * The third choice next to theme and skin: what the page is drawn on.
 *
 * Stored per browser like the other two, and written to `<html data-backdrop>` so anything
 * that only needs to know can observe the attribute instead of owning the choice. index.html
 * does not apply it before first paint, and does not need to: nothing is drawn until the
 * first frame is ready, and until then the page is its plain canvas colour either way.
 */
import { useEffect, useState } from 'react'
import { useAppliedSkin } from './theme'
import { isBackdropChoice, resolveBackdrop, type BackdropChoice, type Look } from '../components/backdrop/looks'

const KEY = 's7-backdrop'

export function readBackdropChoice(): BackdropChoice {
  try {
    const saved = localStorage.getItem(KEY)
    if (isBackdropChoice(saved)) return saved
  } catch {
    /* storage blocked — fall through to the default */
  }
  return 'auto'
}

export function applyBackdropChoice(choice: BackdropChoice) {
  document.documentElement.dataset.backdrop = choice
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* storage blocked — the choice still applies for this session */
  }
}

/**
 * The choice currently applied, without owning it.
 *
 * The attribute is set the first time somebody picks, so before that this falls back to what
 * is stored — which is the same answer, read from the other place it lives.
 */
export function useAppliedBackdropChoice(): BackdropChoice {
  const read = (): BackdropChoice => {
    const value = typeof document !== 'undefined' ? document.documentElement.dataset.backdrop : undefined
    return isBackdropChoice(value) ? value : readBackdropChoice()
  }
  const [choice, setChoice] = useState<BackdropChoice>(read)

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setChoice(read())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['data-backdrop'] })
    return () => observer.disconnect()
  }, [])

  return choice
}

/** What is actually on screen: the choice, with Auto answered for the skin that is on. */
export function useAppliedBackdrop(): Look {
  return resolveBackdrop(useAppliedBackdropChoice(), useAppliedSkin())
}

/** Single owner of `<html data-backdrop>`, the way `useSkin` owns `data-skin`. */
export function useBackdropChoice() {
  const [choice, setChoice] = useState<BackdropChoice>(readBackdropChoice)

  useEffect(() => {
    applyBackdropChoice(choice)
  }, [choice])

  return { choice, setChoice }
}
