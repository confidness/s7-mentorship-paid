import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppliedSkin, useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'

/**
 * The liquid-metal field the interface sits on.
 *
 * `LiquidMetal` comes from Paper Design's own package — the library behind shaders.paper.design —
 * so the brief's shader URL translates parameter for parameter and no WebGL is written here.
 *
 * Two things this component exists to get right, both of which a bare <LiquidMetal> would get
 * wrong:
 *
 * **Contrast.** Since the interface went brutalist every panel is opaque, so nothing reads
 * *through* the shader any more and the veil could be thinned a long way — the metal is
 * properly visible now. It cannot go to zero: page headings and section subtitles sit
 * directly on the background with no sheet under them, and those are what the veil protects.
 *
 * **Motion.** index.css collapses CSS animation under `prefers-reduced-motion`, but that rule
 * cannot reach WebGL. The canvas has to read the preference itself, which it does by dropping
 * to `speed={0}` — a still frame of the same image, not a blank space.
 *
 * It also stops when the tab is hidden. A full-viewport shader animating behind a background tab
 * is a laptop fan and a battery complaint.
 *
 * And it loads only when it is shown. This file is the gate; the shader package is imported by
 * `LiquidMetalField` alone, fetched the first time the brutal skin is on. Nine skins out of ten
 * never draw the field, and imported here they would all have downloaded it anyway — the same
 * reasoning, and the same split, as `AtelierSceneGate`.
 */
const Field = lazy(() => import('./LiquidMetalField'))

/**
 * How much canvas colour sits between the shader and the content.
 *
 * `hero` is for surfaces carrying a headline and little else — login, register, a certificate.
 * `app` is everywhere with real text on glass, and is opaque enough that the measured contrast
 * of every card above it still holds; the metal reads as a slow shift in the light, not a field.
 */
export type Depth = 'hero' | 'app'

const VEIL: Record<Depth, { light: number; dark: number }> = {
  hero: { light: 0.12, dark: 0.2 },
  app: { light: 0.66, dark: 0.72 },
}

export default function LiquidMetalBackground({ depth = 'app', className = '' }: { depth?: Depth; className?: string }) {
  const theme = useAppliedTheme()
  const skin = useAppliedSkin()
  const reduced = usePrefersReducedMotion()
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  /**
   * Only under the skin whose palette came out of it.
   *
   * These colours were read off this shader — the near-black at the centre of a metaball,
   * the cool slate of its shadow side, the yellow the aberration throws along an edge — so
   * the field belongs to `brutal` and looks like a stray photograph behind any of the
   * others. Skipping it also means four of the five skins never start a WebGL context at
   * all, which the default in particular has no use for.
   */
  if (skin !== 'brutal') return null

  const veil = VEIL[depth][theme]

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}>
      {/* Nothing while the shader arrives: the body is already the canvas colour, so for
          that moment the page is simply the plain background. */}
      <Suspense fallback={null}>
        <Field theme={theme} still={reduced || hidden} />
      </Suspense>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-canvas)', opacity: veil }} />
    </div>
  )
}
