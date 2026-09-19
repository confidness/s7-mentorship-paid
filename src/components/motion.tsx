import { AnimatePresence, m, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatNumber } from '../i18n'

/**
 * The motion primitives this interface actually uses.
 *
 * Copied in rather than depended on, which is how Motion Primitives is meant to be taken: the
 * library is a set of patterns, and importing four of them is cheaper than carrying all thirty.
 *
 * Two rules hold everything here together:
 *
 * The house curve is `cubic-bezier(0.22, 1, 0.36, 1)` at around a third of a second — the one
 * `.animate-rise` and `.animate-toast` already use in index.css. Motion that arrives on a
 * different curve from the CSS beside it reads as a second designer, so there is only one.
 *
 * Motion answers an action or marks a change. It does not decorate. Every card fading up on
 * every grid is the tell of a generated page, and index.css says as much out loud: "Entrance
 * for a whole screen, once. Individual cards do not animate in."
 *
 * Note `m` rather than `motion`: main.tsx wraps the app in LazyMotion with only the DOM
 * animation features, which is 14 kB gzipped cheaper than the full bundle. It is mounted
 * `strict`, so reaching for `motion.div` anywhere throws with an explanation rather than
 * quietly pulling the whole library back in.
 */

/** easeOutQuint — the same curve the stylesheet uses, expressed for Motion. */
export const EASE = [0.22, 1, 0.36, 1] as const
const DURATION = 0.32

/**
 * One entrance per screen, on navigation.
 *
 * This replaces `.animate-rise` on 29 page roots with a single wrapper around the router's
 * outlet: same movement, one place, and it can now animate the outgoing screen too. Keyed by
 * pathname, because that is what "a new screen" means here.
 */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={routeKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: DURATION, ease: EASE }}
      >
        {children}
      </m.div>
    </AnimatePresence>
  )
}

const GROUP: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.045 } },
}

const ITEM: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: DURATION, ease: EASE } },
}

/**
 * Staggered entry, for a list that is genuinely a sequence.
 *
 * A review queue, a leaderboard and a lesson chain are ordered — the stagger says so, and the
 * eye follows the order. A grid of unrelated cards is not, and staggering it only delays the
 * content. Use it where the order carries meaning, nowhere else.
 */
export function AnimatedGroup({ as = 'div', children, className = '' }: { as?: 'div' | 'ul' | 'ol'; children: ReactNode; className?: string }) {
  // A queue is a list in the markup and has to stay one; wrapping <li>s in a <div> to animate
  // them would trade a screen reader's "list, 6 items" for a visual flourish.
  const C = as === 'ul' ? m.ul : as === 'ol' ? m.ol : m.div
  return (
    <C className={className} variants={GROUP} initial="hidden" animate="shown">
      {children}
    </C>
  )
}

export function AnimatedItem({ as = 'div', children, className = '' }: { as?: 'div' | 'li'; children: ReactNode; className?: string }) {
  const C = as === 'li' ? m.li : m.div
  return (
    <C className={className} variants={ITEM}>
      {children}
    </C>
  )
}

/**
 * A number that counts to its new value instead of jumping.
 *
 * Worth it only where the change is the point — XP after an award, a level's progress. The
 * count is what tells a student something was earned, so it is the one place a plain number
 * would lose information.
 *
 * `useReducedMotion` is checked here rather than left to MotionConfig: this animates a text
 * node, not a transform, so the global setting does not reach it.
 */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    const span = value - a
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 620)
      // easeOutQuint, matching EASE closely enough that a counter and a panel feel like one move.
      const eased = 1 - Math.pow(1 - p, 5)
      setShown(Math.round(a + span * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, reduced])

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatNumber(shown)}
    </span>
  )
}

/**
 * Crossfades between panels that share a slot, such as the six sections of a lesson.
 *
 * The direction matters: moving forward through a lesson should look like moving forward, so
 * the panel enters from the side it came from. Without that a tab strip reads as six unrelated
 * screens rather than one thing being stepped through.
 */
export function TransitionPanel({ index, direction, children, className = '' }: { index: number; direction: number; children: ReactNode; className?: string }) {
  const shift = 14 * (direction >= 0 ? 1 : -1)
  return (
    <div className={`relative ${className}`}>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <m.div
          key={index}
          initial={{ opacity: 0, x: shift }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -shift }}
          transition={{ duration: 0.26, ease: EASE }}
        >
          {children}
        </m.div>
      </AnimatePresence>
    </div>
  )
}
