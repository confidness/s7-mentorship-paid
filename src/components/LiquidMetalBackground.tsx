import { useEffect, useState } from 'react'
import { LiquidMetal } from '@paper-design/shaders-react'
import { useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'

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
 */

/** The brief's parameters, verbatim. Light mode is the palette they were chosen for. */
const LIGHT = { colorBack: '#aaaaac', colorTint: '#ffffff' }

/**
 * Dark mode is not in the brief and cannot be, since one grey cannot serve both. These keep the
 * same metal read — a cool, desaturated pair — against the dark canvas rather than glowing on it.
 */
const DARK = { colorBack: '#1b1b21', colorTint: '#6f7790' }

/**
 * The brief's parameters, verbatim.
 *
 * Unlike the first set these are composed as a background rather than as a portrait of a
 * shape: metaballs at fit cover and scale 1 fill the frame edge to edge, with nothing left to
 * recognise as an object. One setting now serves every surface, and only the veil changes.
 */
const FIELD = {
  shape: 'metaballs',
  repetition: 1.5,
  softness: 0.05,
  shiftRed: 0.3,
  shiftBlue: 0.3,
  distortion: 0.1,
  contour: 0.43,
  angle: 202,
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  fit: 'cover',
} as const

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
  const reduced = usePrefersReducedMotion()
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  const colors = theme === 'dark' ? DARK : LIGHT
  const veil = VEIL[depth][theme]
  // A frozen shader still shows its pattern; `frame` picks which moment, so the still is composed
  // rather than whatever instant the animation happened to stop on.
  const still = reduced || hidden

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}>
      <LiquidMetal
        {...FIELD}
        {...colors}
        speed={still ? 0 : 1}
        frame={still ? 8000 : 0}
        // Retina at full resolution costs several times the fill rate for an effect that is
        // blurred behind glass anyway.
        maxPixelCount={1280 * 800}
        // Size through the component's own props: it puts them on the element its
        // ResizeObserver watches, and the drawing buffer follows from that.
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      />
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-canvas)', opacity: veil }} />
    </div>
  )
}
