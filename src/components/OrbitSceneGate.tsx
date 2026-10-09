import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAppliedSkin, useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'
import { sectionIndex } from './nav'

/**
 * The light half of the orbit scene: decides whether it runs, and with what.
 *
 * Mounted once, above the router's pages, rather than once per screen. The scene is a single
 * continuous world — signing in flies the camera from the sign-in vantage to the catalogue,
 * and moving between sections glides it between stations — which is only possible if the
 * canvas survives the navigation. A canvas per page would restart the world on every click
 * and pay for a new WebGL context each time.
 *
 * Same discipline as the other two scenes: it self-gates by skin, freezes for reduced motion
 * and a hidden tab, is `aria-hidden` and takes no pointer events. Anything that goes wrong in
 * WebGL — no context, a lost chunk — leaves the stylesheet's own gradient showing, never the
 * crash screen.
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
 * How much canvas colour sits over the scene.
 *
 * None on sign-in, which carries a headline and a form and nothing else. Inside the app the
 * page headings sit straight on the scene with no glass under them, and this is what keeps
 * their contrast measured rather than lucky.
 */
const VEIL = { hero: { light: 0, dark: 0 }, app: { light: 0.36, dark: 0.26 } } as const

export default function OrbitSceneGate() {
  const skin = useAppliedSkin()
  const theme = useAppliedTheme()
  const reduced = usePrefersReducedMotion()
  const { pathname } = useLocation()
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

  if (skin !== 'orbit' || !hasWebGL()) return null

  const mode = pathname === '/login' || pathname === '/register' ? 'hero' : 'app'
  // A page outside the five sections — one course, one lesson — takes the vantage of the
  // section it is reached from.
  const found = sectionIndex(pathname)
  const station = found >= 0 ? found : pathname.startsWith('/learn/') ? 1 : 0

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Quiet>
        <Suspense fallback={null}>
          <Scene theme={theme} mode={mode} station={station} still={reduced || hidden} lowPower={lowPower} />
        </Suspense>
      </Quiet>
      <div className="absolute inset-0 transition-opacity duration-1000" style={{ backgroundColor: 'var(--color-canvas)', opacity: VEIL[mode][theme] }} />
    </div>
  )
}
