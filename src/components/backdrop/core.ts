/**
 * What the three backgrounds share: reading the palette, judging the frame rate, and the
 * one loop that draws a full-screen triangle at thirty frames a second.
 *
 * Each look is a fragment shader and a function that sets its uniforms. Everything that
 * decides *when* to draw — the frame cap, the hidden tab, reduced motion, a lost context,
 * the quality ladder — lives here once, so the three looks cannot disagree about it.
 *
 * The top half is pure and runs under node in test/backdrop.test.ts. Nothing at module
 * level touches the DOM.
 */

/* ------------------------------------------------------------------ colour */

/** sRGB, each channel 0..1. */
export type RGB = [number, number, number]

export interface Palette {
  canvas: RGB
  brand: RGB
  accent: RGB
  /** Secondary text: the colour every pixel under on-canvas text has to keep AA against. */
  ink500: RGB
  ink900: RGB
  /** From the canvas, not from the theme: cinema's light theme is a dark room. */
  dark: boolean
}

/**
 * Hex (3, 4, 6 or 8 digits) and `rgb()`/`rgba()` in either comma or space syntax. Anything
 * else is null, and the browser side hands it to a 2D canvas to normalise instead.
 */
export function parseColor(input: string | null | undefined): RGB | null {
  const s = (input ?? '').trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const num = (p: string) => (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/.test(p) ? Number(p.replace('%', '')) : NaN)
  if (parts.some((p) => Number.isNaN(num(p)))) return null
  return parts.slice(0, 3).map((p) => Math.min(1, Math.max(0, p.endsWith('%') ? num(p) / 100 : num(p) / 255))) as RGB
}

const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** WCAG relative luminance. */
export const luminance = (c: RGB) => 0.2126 * decode(c[0]) + 0.7152 * decode(c[1]) + 0.0722 * decode(c[2])

/** WCAG contrast ratio between two colours. */
export const contrast = (a: RGB, b: RGB) => {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Linear for the shaders. Gamma 2.2 rather than the exact sRGB curve, because every shader
 * writes gamma 2.2 back out: decoded and encoded the same way, the empty parts of the frame
 * come out at exactly `--color-canvas`, so there is no seam where the page shows through.
 */
export const linear = (c: RGB): RGB => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2]

const same = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]) < 0.5 / 255)

/** The default skin, which the others inherit any token they never set. */
export const PLAIN = {
  canvas: '#f4f6fa',
  brand: '#6366f1',
  accent: '#4f46e5',
  ink500: '#5a6779',
  ink900: '#0f172a',
}

/**
 * The palette a look is painted in, from the live tokens.
 *
 * `brand` is `--color-brand-500`, except where a skin never set its own: atelier and editorial
 * only override the 600, so their 500 is plain's indigo inherited from `:root`, and their real
 * brand colour is the 600. `accent` is `--color-accent-400`, the fill of the primary action.
 */
export function paletteFrom(token: (name: string) => string, skin: string, parse: (value: string) => RGB | null = parseColor): Palette {
  const read = (name: string) => parse(token(name))
  const plain = (key: keyof typeof PLAIN) => parseColor(PLAIN[key]) as RGB
  const b500 = read('--color-brand-500')
  const b600 = read('--color-brand-600')
  const inherited = skin !== 'plain' && b500 !== null && same(b500, plain('brand'))
  const canvas = read('--color-canvas') ?? plain('canvas')
  return {
    canvas,
    brand: (!inherited && b500) || b600 || b500 || plain('brand'),
    accent: read('--color-accent-400') ?? plain('accent'),
    ink500: read('--color-ink-500') ?? plain('ink500'),
    ink900: read('--color-ink-900') ?? plain('ink900'),
    dark: luminance(canvas) < 0.25,
  }
}

/** Part way from one palette to another, in sRGB, which is where a crossfade looks even. */
export function mixPalette(a: Palette, b: Palette, k: number): Palette {
  const mix = (x: RGB, y: RGB): RGB => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]
  const canvas = mix(a.canvas, b.canvas)
  return { canvas, brand: mix(a.brand, b.brand), accent: mix(a.accent, b.accent), ink500: mix(a.ink500, b.ink500), ink900: mix(a.ink900, b.ink900), dark: luminance(canvas) < 0.25 }
}

let probe: CanvasRenderingContext2D | null | undefined

/**
 * Any colour the browser understands, as sRGB.
 *
 * Tokens here are hex today, but a token written as `oklch()` or `color-mix()` tomorrow should
 * not turn a background grey. A 2D canvas is the browser's own colour parser: an invalid value
 * leaves `fillStyle` where it was, so it is tried after two different starts, and a colour that
 * comes back in a syntax this file does not read is painted and read off the pixel instead.
 */
export function normaliseColor(value: string): RGB | null {
  const direct = parseColor(value)
  if (direct || !value.trim()) return direct
  if (probe === undefined) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    probe = c.getContext('2d', { willReadFrequently: true })
  }
  if (!probe) return null
  probe.fillStyle = '#000'
  probe.fillStyle = value
  const a = String(probe.fillStyle)
  probe.fillStyle = '#fff'
  probe.fillStyle = value
  if (String(probe.fillStyle) !== a) return null
  const round = parseColor(a)
  if (round) return round
  probe.clearRect(0, 0, 1, 1)
  probe.fillRect(0, 0, 1, 1)
  const d = probe.getImageData(0, 0, 1, 1).data
  return [d[0] / 255, d[1] / 255, d[2] / 255]
}

/** The palette on screen right now. Called when the skin or theme changes, never per frame. */
export function readPalette(): Palette {
  const html = document.documentElement
  const style = getComputedStyle(html)
  return paletteFrom((name) => style.getPropertyValue(name), html.dataset.skin ?? 'plain', normaliseColor)
}

/* ------------------------------------------------------------------ quality ladder */

/** Milliseconds ignored after a start: shader compile and page-load jank are not the GPU's fault. */
export const LADDER_WARMUP = 1500
/** Milliseconds per verdict. Time rather than frames, so a slow device is judged as soon as a fast one. */
export const LADDER_WINDOW = 1000

export interface Ladder {
  level: number
  frames: number
  /** Real milliseconds in the current window. */
  elapsed: number
  /** The same frames with each stall clamped: what the average is taken over. */
  total: number
  slow: number
  skip: number
}

export const ladderStart = (level: number): Ladder => ({ level, frames: 0, elapsed: 0, total: 0, slow: 0, skip: LADDER_WARMUP })

/**
 * One drawn frame's verdict on quality. Pure: state, how long the frame took, the budget.
 *
 * Frames are judged a second at a time. A second whose frames average more than 1.35× the
 * budget is slow; two slow windows in a row step down one level, or two levels when the second ran more
 * than 2.5× over. One slow window alone is a long task on the main thread — a page rendering, a
 * tab switch — and not a reason to blur the background for the rest of the visit.
 *
 * It never steps back up. Under a frame cap a fast GPU and a barely-keeping-up one both
 * deliver frames on time, so there is no honest signal to climb on, and a ladder that climbs
 * on a guess is a ladder that oscillates.
 */
export function ladderStep(s: Ladder, dt: number, budget: number, levels: number): Ladder {
  if (s.skip > 0) return { ...s, skip: s.skip - dt }
  const frames = s.frames + 1
  const elapsed = s.elapsed + dt
  // A single stall — a tab switch, a page rendering — counts as four frames' worth, not ten
  // seconds, and a window needs a handful of frames before it says anything at all.
  const total = s.total + Math.min(dt, budget * 4)
  if (elapsed < LADDER_WINDOW || frames < 5) return { ...s, frames, elapsed, total }
  const ratio = total / frames / budget
  const slow = ratio > 1.35 ? s.slow + 1 : 0
  if (slow < 2) return { level: s.level, frames: 0, elapsed: 0, total: 0, slow, skip: 0 }
  return { level: Math.min(levels - 1, s.level + (ratio > 2.5 ? 2 : 1)), frames: 0, elapsed: 0, total: 0, slow: 0, skip: 0 }
}

/* ------------------------------------------------------------------ calm zone */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where the page needs the background to be quiet, in CSS pixels of the viewport.
 *
 * `text` is where words sit straight on the canvas. `stage` is the horizontal span left free
 * of opaque content, where a look with a subject — the sculpture, the glass — should put it.
 * `bare` is a page with no header or tab bar over its edges (the front door, sign-in, a
 * missing page): on a phone its text runs everywhere, corners included.
 */
export interface CalmZone {
  text: Box | null
  stage: { left: number; right: number } | null
  bare?: boolean
}

/** The same, in 0..1 of the viewport with the origin top-left, as the shaders want it. */
export interface Calm {
  /** Under 768 px: text runs the full width and scrolls over everything. */
  phone: boolean
  bare: boolean
  text: [number, number, number, number] | null
  stage: [number, number]
}

export function normaliseCalm(zone: CalmZone | null, w: number, h: number): Calm {
  const text = zone?.text ? ([zone.text.left / w, zone.text.top / h, zone.text.right / w, zone.text.bottom / h] as Calm['text']) : null
  const stage: [number, number] = zone?.stage ? [zone.stage.left / w, zone.stage.right / w] : [text ? text[2] : 0.62, 1]
  return { phone: w < 768, bare: !!zone?.bare, text, stage }
}

/**
 * Part way from one calm zone to the next, so moving from the front door to sign-in slides
 * the sculpture into its new gap rather than cutting to it. A zone appearing or going away,
 * or a phone becoming a desktop, has nothing in between and simply arrives.
 */
export function mixCalm(a: Calm, b: Calm, k: number): Calm {
  const lerp = (x: number, y: number) => x + (y - x) * k
  if (!a.text || !b.text || a.phone !== b.phone) return b
  return {
    phone: b.phone,
    bare: b.bare,
    text: [lerp(a.text[0], b.text[0]), lerp(a.text[1], b.text[1]), lerp(a.text[2], b.text[2]), lerp(a.text[3], b.text[3])],
    stage: [lerp(a.stage[0], b.stage[0]), lerp(a.stage[1], b.stage[1])],
  }
}

/* ------------------------------------------------------------------ the runtime */

export interface Tier {
  /** Internal resolution as a fraction of CSS (or device) pixels. */
  scale: number
  /** The march budget. */
  steps: number
  /** Anything else a look varies per tier. */
  extra?: number
  /** A lower frame cap, for the last rungs: past a point, fewer frames look better than fewer pixels. */
  fps?: number
}

export interface Frame {
  /** Seconds on the look's own clock, which only runs while frames are drawn. */
  t: number
  w: number
  h: number
  cssW: number
  cssH: number
  tier: Tier
  palette: Palette
  /** Eased pointer, -1..1, zero when still or on a coarse pointer. */
  ptr: [number, number]
  calm: Calm
}

export type Uniforms = Record<string, WebGLUniformLocation | null>

export interface LookSpec {
  name: string
  frag: string
  uniforms: readonly string[]
  /** Best first. */
  tiers: Tier[]
  startTier: (phone: boolean, coarse: boolean) => number
  /** Internal pixels, at most. */
  pixelBudget: number
  /**
   * Never fewer than this many internal pixels per CSS pixel, whatever the tier says. A thin
   * rim drawn one internal pixel wide and scaled up three times is a staircase; a look with
   * thin, bright edges stops here and gives up frames instead.
   */
  minScale?: number
  /** Scale device pixels (DPR capped at 2) rather than CSS pixels. */
  devicePixels: boolean
  /** The composed moment: the still frame, and where the clock starts so motion never jumps. */
  stillTime: number
  /** Pointer easing time constant, ms. */
  ease: number
  draw: (gl: WebGL2RenderingContext, u: Uniforms, f: Frame) => void
}

export interface EngineOptions {
  palette: Palette
  still: boolean
  /** The layout's calm zone, if it is known already, so the very first frame respects it. */
  calm?: CalmZone | null
  onFirstFrame?: () => void
  /** The context went away; the page should show its own canvas colour until it is back. */
  onLost?: () => void
}

export interface Engine {
  setPalette: (palette: Palette) => void
  setCalmZone: (zone: CalmZone | null) => void
  setPointer: (x: number, y: number) => void
  setStill: (still: boolean) => void
  pause: () => void
  resume: () => void
  dispose: () => void
}

const FPS = 30
const PALETTE_EASE = 400
const CALM_EASE = 600

const VERT = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0, 0, 1); }`

/** A soft-edged box, 1 inside: the calm zone as the shaders draw it. Shared by all three. */
export const CALM_GLSL = `
float calmBox(vec2 s, vec4 b, vec4 f){
  return smoothstep(b.x - f.x, b.x, s.x)*(1.0 - smoothstep(b.z, b.z + f.z, s.x))*smoothstep(b.y - f.y, b.y, s.y)*(1.0 - smoothstep(b.w, b.w + f.w, s.y));
}`

function build(gl: WebGL2RenderingContext, look: LookSpec): { program: WebGLProgram; u: Uniforms } | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) || gl.isContextLost()) return s
    // A broken shader is a bug worth seeing in development; in production the page just
    // keeps its plain canvas, which is what it would show without WebGL at all.
    if (import.meta.env?.DEV) console.warn(`backdrop ${look.name}:`, gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, look.frag)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    gl.deleteProgram(program)
    return null
  }
  const u: Uniforms = {}
  for (const name of look.uniforms) u[name] = gl.getUniformLocation(program, name)
  return { program, u }
}

/**
 * Starts a look on a canvas, or returns null when there is no WebGL2 — in which case nothing
 * is drawn and the page is simply its canvas colour, which `html` already carries.
 */
export function start(canvas: HTMLCanvasElement, look: LookSpec, opts: EngineOptions): Engine | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  })
  if (!gl || gl.isContextLost()) return null
  let prog = build(gl, look)
  if (!prog) return null

  const coarse = matchMedia('(pointer: coarse)').matches
  let cssW = Math.max(1, canvas.clientWidth)
  let cssH = Math.max(1, canvas.clientHeight)
  let ladder = ladderStart(Math.min(look.tiers.length - 1, look.startTier(cssW < 768, coarse)))
  let still = opts.still
  let raf = 0
  let last = 0
  let clock = look.stillTime
  let shown = false
  let paused = false
  let lost = false
  let disposed = false
  let from = opts.palette
  let to = opts.palette
  let t0 = 0
  let zone: CalmZone | null = opts.calm ?? null
  let calmFrom: Calm | null = null
  let calmTo = normaliseCalm(zone, cssW, cssH)
  let calmT0 = 0
  const target: [number, number] = [0, 0]
  const frame: Frame = {
    t: clock,
    w: 1,
    h: 1,
    cssW,
    cssH,
    tier: look.tiers[ladder.level],
    palette: opts.palette,
    ptr: [0, 0],
    calm: calmTo,
  }

  const calm = (now: number) => {
    const k = (now - calmT0) / CALM_EASE
    if (!calmFrom || k >= 1) {
      calmFrom = null
      return calmTo
    }
    return mixCalm(calmFrom, calmTo, k * k * (3 - 2 * k))
  }

  const palette = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / PALETTE_EASE))
    return k >= 1 ? to : mixPalette(from, to, k * k * (3 - 2 * k))
  }

  const draw = (now: number, dt: number) => {
    if (lost || disposed) return
    const k = still ? 1 : 1 - Math.exp(-dt / look.ease)
    frame.ptr[0] += ((still ? 0 : target[0]) - frame.ptr[0]) * k
    frame.ptr[1] += ((still ? 0 : target[1]) - frame.ptr[1]) * k
    frame.t = clock
    frame.palette = palette(now)
    frame.tier = look.tiers[ladder.level]
    frame.calm = calm(now)
    gl.useProgram(prog!.program)
    gl.viewport(0, 0, frame.w, frame.h)
    look.draw(gl, prog!.u, frame)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (!shown) {
      shown = true
      opts.onFirstFrame?.()
    }
  }

  /**
   * Resizing clears the drawing buffer, so a visible canvas gets its next frame in the same
   * task rather than showing a cleared one for a frame. Nothing changed, nothing is drawn.
   */
  const size = (redraw = true) => {
    if (lost || disposed) return
    const dpr = look.devicePixels ? Math.min(window.devicePixelRatio || 1, 2) : 1
    const s = Math.min(Math.max(look.tiers[ladder.level].scale * dpr, look.minScale ?? 0), Math.sqrt(look.pixelBudget / (cssW * cssH)))
    const w = Math.max(1, Math.round(cssW * s))
    const h = Math.max(1, Math.round(cssH * s))
    const moved = frame.cssW !== cssW || frame.cssH !== cssH
    const changed = moved || canvas.width !== w || canvas.height !== h
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    frame.w = w
    frame.h = h
    frame.cssW = cssW
    frame.cssH = cssH
    // A resize moves the layout under the zone at once, so the zone follows at once too.
    if (moved) {
      calmTo = normaliseCalm(zone, cssW, cssH)
      calmFrom = null
    }
    if (changed && redraw && (shown || still || !raf)) draw(performance.now(), 0)
  }

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const interval = 1000 / (look.tiers[ladder.level].fps ?? FPS)
    const dt = last ? now - last : interval
    if (last && dt < interval - 2) return
    last = now
    // The clock only runs while frames are drawn, and a long gap counts as one frame: a tab
    // that was hidden for an hour picks up where it was, not an hour later.
    clock += Math.min(dt, 100) / 1000
    const next = ladderStep(ladder, dt, interval, look.tiers.length)
    const stepped = next.level !== ladder.level
    ladder = next
    if (stepped) size(false)
    draw(now, dt)
  }

  const stop = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }

  const go = () => {
    stop()
    if (paused || lost || disposed || document.hidden) return
    if (still) {
      clock = look.stillTime
      draw(performance.now(), 0)
      return
    }
    last = 0
    ladder = ladderStart(ladder.level)
    raf = requestAnimationFrame(tick)
  }

  const onVisibility = () => (document.hidden ? stop() : go())
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
    shown = false
    stop()
    opts.onLost?.()
  }
  const onRestored = () => {
    if (disposed) return
    prog = build(gl, look)
    if (!prog) return
    lost = false
    size()
    go()
  }
  const observer = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect
    if (box.width < 1 || box.height < 1) return
    cssW = box.width
    cssH = box.height
    size()
  })

  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  observer.observe(canvas)
  size(false)
  go()

  /** A still frame is redrawn on any change; a running one picks it up next frame. */
  const refresh = () => {
    if (!raf && !paused && !document.hidden) draw(performance.now(), 0)
  }

  return {
    setPalette: (next) => {
      const now = performance.now()
      if (raf) {
        from = palette(now)
        t0 = now
      } else {
        from = next
      }
      to = next
      refresh()
    },
    setCalmZone: (next) => {
      // Re-measured on every layout change; most of them move nothing the shader can see.
      if (JSON.stringify(next) === JSON.stringify(zone)) return
      const now = performance.now()
      zone = next
      calmFrom = raf ? calm(now) : null
      calmTo = normaliseCalm(next, cssW, cssH)
      calmT0 = now
      refresh()
    },
    setPointer: (x, y) => {
      target[0] = x
      target[1] = y
    },
    setStill: (next) => {
      if (next === still) return
      still = next
      go()
    },
    pause: () => {
      paused = true
      stop()
    },
    resume: () => {
      paused = false
      go()
    },
    dispose: () => {
      disposed = true
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      if (prog && !gl.isContextLost()) gl.deleteProgram(prog.program)
      prog = null
    },
  }
}
