import { LiquidMetal } from '@paper-design/shaders-react'

/**
 * The heavy half of the liquid-metal background: the shader itself.
 *
 * This is the only module that imports `@paper-design/shaders-react`. `LiquidMetalBackground`
 * is the gate, and it loads this file only under the skin that shows it — the same split as
 * `AtelierSceneGate` and `AtelierScene`. Render the gate, never this file directly, or the
 * shader package lands back in the first download for every skin that never draws it.
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

export default function LiquidMetalField({ theme, still }: { theme: 'light' | 'dark'; still: boolean }) {
  return (
    <LiquidMetal
      {...FIELD}
      {...(theme === 'dark' ? DARK : LIGHT)}
      speed={still ? 0 : 1}
      // A frozen shader still shows its pattern; `frame` picks which moment, so the still is
      // composed rather than whatever instant the animation happened to stop on.
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
  )
}
