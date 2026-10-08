import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppliedBackdrop } from '../lib/backdrop'
import { useAppliedSkin, useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'
import { drawsHere } from './backdrop/looks'
import type { CalmZone, Engine, EngineOptions, Palette } from './backdrop/core'

/**
 * The background every page is drawn on.
 *
 * Mounted once, beside the routes rather than inside them, so the canvas and its WebGL
 * context outlive every navigation: moving from the catalogue to a lesson does not start a
 * second context or show the plain colour for a frame in between.
 *
 * This file is the gate and stays small, because it ships to everybody. Each look is its own
 * chunk, fetched the first time it is shown; somebody who never leaves the default never
 * downloads the other two, and somebody who switches it off downloads none.
 *
 * Until the first frame is drawn the canvas is transparent and the page is its own canvas
 * colour, which `html` carries for exactly this reason — so a slow GPU, a missing WebGL2 or a
 * lost context all look like the plain skin rather than like something broken.
 */
interface LookModule {
  create: (canvas: HTMLCanvasElement, opts: EngineOptions) => Engine | null
  readPalette: () => Palette
}

const LOAD: Record<'silk' | 'sculpture' | 'glass', () => Promise<LookModule>> = {
  silk: () => import('./backdrop/silk'),
  sculpture: () => import('./backdrop/sculpture'),
  glass: () => import('./backdrop/glass'),
}

/**
 * Where the page needs quiet, read off the layout.
 *
 * A page marks its text with `data-backdrop-calm`: `column` for a column text runs down as
 * the page scrolls (optionally only its first `data-backdrop-measure` pixels, where the
 * headings and ledes actually reach), `text` for the same but measured off the words
 * themselves, and `box` for a block that stays where it is. `data-backdrop-avoid` marks an
 * opaque surface a look with a subject should not hide it behind.
 *
 * Read on navigation and resize only. Nothing here runs per frame.
 */
function measureCalm(): CalmZone | null {
  const el = document.querySelector<HTMLElement>('[data-backdrop-calm]')
  if (!el) return null
  const mode = el.dataset.backdropCalm
  const rect = mode === 'text' ? textExtent(el) : el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const measure = Number(el.dataset.backdropMeasure) || Infinity
  const column = mode !== 'box'
  const text = {
    left: rect.left,
    right: Math.min(rect.right, rect.left + measure),
    top: column ? 0 : rect.top,
    bottom: column ? window.innerHeight : rect.bottom,
  }
  const avoid = document.querySelector('[data-backdrop-avoid]')?.getBoundingClientRect()
  const stage = avoid && avoid.width > 0 && avoid.left > text.right ? { left: text.right, right: avoid.left } : null
  // Only the app's column has chrome over its top and bottom edges; every other page is bare.
  return { text, stage, bare: mode !== 'column' }
}

/**
 * The box the words in an element actually occupy.
 *
 * Text node by text node, because a range over the whole element also counts each child
 * element's own box — and a headline allowed to grow to 56rem is a 56rem box even when its
 * longest line stops well short of that.
 */
function textExtent(el: HTMLElement): DOMRect {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    left = Math.min(left, r.left)
    top = Math.min(top, r.top)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  return right > left ? new DOMRect(left, top, right - left, bottom - top) : new DOMRect()
}

export default function Backdrop() {
  const look = useAppliedBackdrop()
  const skin = useAppliedSkin()
  const theme = useAppliedTheme()
  const reduced = usePrefersReducedMotion()
  const { pathname } = useLocation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const palette = useRef<(() => Palette) | null>(null)
  const zone = useRef<CalmZone | null>(null)
  const [shown, setShown] = useState(false)
  const drawn = drawsHere(look)

  // One engine per look. Switching looks keeps the canvas and swaps what draws on it.
  useEffect(() => {
    if (!drawsHere(look)) return
    let cancelled = false
    LOAD[look]()
      .then((mod) => {
        if (cancelled || !canvas.current) return
        const created = mod.create(canvas.current, {
          palette: mod.readPalette(),
          // Read directly rather than from the hook, whose first render always says "no".
          still: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          calm: zone.current,
          onFirstFrame: () => setShown(true),
          onLost: () => setShown(false),
        })
        if (!created) return
        engine.current = created
        palette.current = mod.readPalette
      })
      // A chunk that fails to arrive leaves the plain canvas, which is a fine background.
      .catch(() => {})
    return () => {
      cancelled = true
      engine.current?.dispose()
      engine.current = null
      palette.current = null
      // Hidden until the next look has drawn its first frame, so it fades in rather than cuts.
      setShown(false)
    }
  }, [look])

  // The tokens changed under it: read them again and let the engine ease across.
  useEffect(() => {
    if (engine.current && palette.current) engine.current.setPalette(palette.current())
  }, [skin, theme])

  useEffect(() => {
    engine.current?.setStill(reduced)
  }, [reduced])

  useEffect(() => {
    if (!drawsHere(look)) return
    let frame = 0
    let live = true
    const measure = () => {
      frame = 0
      zone.current = measureCalm()
      engine.current?.setCalmZone(zone.current)
    }
    const schedule = () => {
      if (live && !frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    document.querySelectorAll('[data-backdrop-calm], [data-backdrop-avoid]').forEach((el) => observer.observe(el))
    window.addEventListener('resize', schedule)
    // Words measured in a fallback font are not where they will be once the real one arrives.
    void document.fonts?.ready.then(schedule)
    schedule()
    return () => {
      live = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
    // The skin is here for its fonts: a serif headline is not as wide as a grotesque one.
  }, [look, pathname, skin])

  // Parallax for a mouse or a trackpad only: on touch, the pointer is a finger reading, and a
  // background that follows it would move every time somebody scrolled.
  useEffect(() => {
    if (!drawsHere(look) || reduced || !window.matchMedia('(pointer: fine)').matches) return
    let frame = 0
    let x = 0
    let y = 0
    const flush = () => {
      frame = 0
      engine.current?.setPointer((x / window.innerWidth) * 2 - 1, (y / window.innerHeight) * 2 - 1)
    }
    const onMove = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (!frame) frame = requestAnimationFrame(flush)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
      engine.current?.setPointer(0, 0)
    }
  }, [look, reduced])

  if (!drawn) return null

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      // The large viewport height, so a phone's address bar sliding away is not a resize.
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 block h-screen w-full supports-[height:100lvh]:h-lvh"
      style={{ opacity: shown ? 1 : 0, transition: reduced ? 'none' : 'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    />
  )
}
