import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppliedSkin, useAppliedTheme, usePrefersReducedMotion } from '../lib/theme'
import { useAppliedBackdrop } from '../lib/backdrop'

/**
 * Loads the Three.js scene only for the one skin that uses it.
 *
 * `three` and `@react-three/fiber` are genuinely heavy next to everything else this
 * interface ships — a skin without a scene has no reason to ever fetch that code. The gate
 * that decides "is this atelier, on a screen wide enough to show it" has to live in a module
 * that does not itself import `three`, or the decision arrives after the bytes already did.
 * `AtelierScene.tsx` carries the import; this file deliberately does not, and everything
 * outside this pair should render `<AtelierSceneGate />`, never the scene directly.
 *
 * Same discipline as `LiquidMetalBackground`: it self-gates by skin, freezes for
 * prefers-reduced-motion and a backgrounded tab, and is `aria-hidden` and `pointer-events-none`
 * since it decorates, it does not do anything.
 */
const Scene = lazy(() => import('./AtelierScene'))

export default function AtelierSceneGate({ className = '' }: { className?: string }) {
  const skin = useAppliedSkin()
  const theme = useAppliedTheme()
  const reduced = usePrefersReducedMotion()
  const look = useAppliedBackdrop()
  const [hidden, setHidden] = useState(false)
  // Mirrors the `lg:` breakpoint of the section this mounts in — no sense starting a WebGL
  // context for a canvas the layout has already set to display:none.
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)

    const mq = window.matchMedia('(min-width: 1024px)')
    const onResize = () => setWide(mq.matches)
    onResize()
    mq.addEventListener('change', onResize)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      mq.removeEventListener('change', onResize)
    }
  }, [])

  // Atelier's background is the sculpture now, drawn behind every page. This scene is what
  // the sign-in page shows when somebody has switched the background off — never both.
  if (skin !== 'atelier' || !wide || look !== 'off') return null

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <Suspense fallback={null}>
        <Scene theme={theme} still={reduced || hidden} />
      </Suspense>
    </div>
  )
}
