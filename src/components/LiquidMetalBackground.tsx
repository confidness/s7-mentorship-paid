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
 * **Contrast.** The brief's background is `#aaaaac`, a mid grey. Every glass surface in
 * index.css was measured against a pale canvas in light mode and a near-black one in dark, at
 * WCAG AA. A mid-grey field moving behind frosted cards makes that measurement vary frame to
 * frame. So `veil` is not decoration: it is a canvas-coloured layer at the opacity that keeps
 * the measured contrast, and the shader runs uncovered only where there is no dense text.
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
const DARK = { colorBack: '#101724', colorTint: '#5f7fae' }

/**
 * The brief's parameters, verbatim.
 *
 * They come from a shader *preview* URL, where the diamond is the subject of the picture — so at
 * `scale: 0.6` with `fit: 'contain'` they draw a discrete object centred in the frame, not an
 * ambient field. That is exactly right for a hero and wrong for a page behind dense text, where
 * a recognisable silhouette drifting under the cards reads as a rendering fault. Hence two
 * settings of the same shader rather than two shaders.
 */
const HERO = {
  shape: 'diamond',
  repetition: 2,
  softness: 0.1,
  shiftRed: 0.3,
  shiftBlue: 0.3,
  distortion: 0.07,
  contour: 0.4,
  angle: 70,
  scale: 0.6,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  fit: 'contain',
} as const

/**
 * The same diamond, enlarged past the viewport so only its interior shows. What is left is the
 * metal itself — a slow shift of light with no edge to recognise. Softer and less contoured for
 * the same reason: an edge is what the eye would catch behind a paragraph.
 */
const FIELD = {
  ...HERO,
  softness: 0.55,
  contour: 0.15,
  distortion: 0.12,
  scale: 3.4,
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
  hero: { light: 0.3, dark: 0.42 },
  app: { light: 0.82, dark: 0.92 },
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
        {...(depth === 'hero' ? HERO : FIELD)}
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
