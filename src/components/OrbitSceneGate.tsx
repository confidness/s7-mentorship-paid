import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'
import { useAppliedBackdrop } from '../lib/backdrop'
import { vantage } from './nav'
import type { OrbitSceneProps, SceneMode, StageBox } from './OrbitScene'

/**
 * The light half of the orbit scene: decides whether it runs, and with what.
 *
 * Mounted once, above the router's pages, rather than once per screen. The scene is a single
 * continuous world — signing in flies the camera from the sign-in vantage to the catalogue,
 * and moving between sections glides it between stations — which is only possible if the
 * canvas survives the navigation. A canvas per page would restart the world on every click
 * and pay for a new WebGL context each time.
 *
 * Whether it runs is not decided here. `resolveBackdrop` answers that for every background at
 * once, and says `orbit` only under the orbit skin with the background on Auto: a look chosen
 * in settings replaces the world, and Off leaves the skin's CSS sky. The root Backdrop reads
 * the same answer, so the two can never both draw.
 *
 * Same discipline as the other scenes: it freezes for reduced motion and a hidden tab, is
 * `aria-hidden` and takes no pointer events. Anything that goes wrong in WebGL — no context,
 * a lost chunk — leaves the stylesheet's own sky showing, never the crash screen.
 */
const Scene = lazy(() => import('./OrbitScene'))

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

let webgl: boolean | undefined
function hasWebGL() {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement('canvas')
      const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
      webgl = !!context
      context?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webgl = false
    }
  }
  return webgl
}

/**
 * True once the first screen has painted and the browser has had a moment to itself.
 *
 * The world is the heaviest thing the app loads — three, the renderer, a shader compile — and
 * it is the default, so everybody pays for it. Fetched in the same breath as the first screen
 * it would compete with that screen's own code for the network and the main thread; started
 * from an idle callback it arrives once the page is already usable, with the CSS sky standing
 * in until then. Two frames, because the first runs before the paint and the second after it.
 * Safari has no idle callback, so there it waits a beat instead.
 */
function useAfterFirstPaint() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let frame = 0
    let idle = 0
    let timer = 0
    const go = () => setReady(true)
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(go, { timeout: 2000 })
        else timer = window.setTimeout(go, 300)
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      if (idle) window.cancelIdleCallback?.(idle)
      window.clearTimeout(timer)
    }
  }, [])

  return ready
}

/**
 * Where the page has left room for the mark, if it has: `OrbitStage`'s box, in page pixels.
 *
 * Read on navigation, on resize and when the fonts arrive — words set in a fallback face end
 * somewhere else — and never per frame. The scene does the rest, from the scroll position.
 */
function useStage(active: boolean, pathname: string): StageBox | null {
  const [stage, setStage] = useState<StageBox | null>(null)

  useEffect(() => {
    if (!active) return
    let frame = 0
    let live = true
    const measure = () => {
      frame = 0
      const rect = document.querySelector('[data-orbit-stage]')?.getBoundingClientRect()
      const next = rect && rect.height > 0 ? { top: Math.round(rect.top + window.scrollY), height: Math.round(rect.height) } : null
      setStage((was) => (was?.top === next?.top && was?.height === next?.height ? was : next))
    }
    const schedule = () => {
      if (live && !frame) frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    window.addEventListener('resize', schedule)
    void document.fonts?.ready.then(schedule)
    schedule()
    return () => {
      live = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [active, pathname])

  return active ? stage : null
}

/**
 * How much canvas colour sits over the scene.
 *
 * None on sign-in, which carries a headline and a form and nothing else. Inside the app — and
 * on the front door, whose section headings and ledes sit straight on the scene below the
 * hero — this is what keeps their contrast measured rather than lucky.
 */
const VEIL: Record<SceneMode, { light: number; dark: number }> = {
  hero: { light: 0, dark: 0 },
  front: { light: 0.3, dark: 0.2 },
  app: { light: 0.36, dark: 0.26 },
}

export default function OrbitSceneGate() {
  const look = useAppliedBackdrop()
  const theme = useAppliedTheme()
  const reduced = usePrefersReducedMotion()
  const { pathname } = useLocation()
  const painted = useAfterFirstPaint()
  const { mode, station } = vantage(pathname)
  const stage = useStage(look === 'orbit' && mode === 'front', pathname)
  const [hidden, setHidden] = useState(false)
  // Phones and small machines get fewer particles and a cheaper sky. Read once: this is a
  // property of the device, not of the moment.
  const [lowPower] = useState(() => window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4)

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  if (look !== 'orbit' || !painted || !hasWebGL()) return null

  return <Layer theme={theme} mode={mode} station={station} still={reduced || hidden} lowPower={lowPower} reduced={reduced} stage={stage} />
}

/**
 * Room for the world's mark on a page that would otherwise put words over it.
 *
 * On a portrait screen the front door's text runs the full width, so the camera stands the mark
 * below the buttons; this is the empty space it stands in, measured by `useStage` and aimed at
 * by the scene. It is there only while the world is actually drawn — under a background chosen
 * in settings, or without WebGL, it would be a hole in the page — and only in portrait, which
 * is when the camera takes that pose (index.css).
 */
export function OrbitStage() {
  const look = useAppliedBackdrop()
  if (look !== 'orbit' || !hasWebGL()) return null
  return <div aria-hidden="true" data-orbit-stage className="orbit-stage" />
}

/**
 * The canvas and its veil, faded in once the world has drawn its first frame.
 *
 * A child of its own so that leaving the orbit world — a background chosen in settings, another
 * skin — unmounts it and its fade with it, and coming back fades in again rather than popping.
 */
function Layer({ reduced, ...scene }: Omit<OrbitSceneProps, 'onReady'> & { reduced: boolean }) {
  const [shown, setShown] = useState(false)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: shown ? 1 : 0, transition: reduced ? 'none' : 'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      <Quiet>
        <Suspense fallback={null}>
          <Scene {...scene} onReady={() => setShown(true)} />
        </Suspense>
      </Quiet>
      <div className="absolute inset-0 transition-opacity duration-1000" style={{ backgroundColor: 'var(--color-canvas)', opacity: VEIL[scene.mode][scene.theme] }} />
    </div>
  )
}
