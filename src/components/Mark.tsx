/**
 * The Brandyzer mark: a lower-case b made of two shapes — a white stem and a solid yellow
 * bowl, like a pen beside a dab of paint — on a disc of the brand's red.
 *
 * Drawn rather than imported as a bitmap so it stays crisp at 16px, needs no asset request
 * and keeps its own colours in both themes: a logo is a constant, not a themed surface.
 *
 * Solid shapes only, on purpose. A ring-and-dot bowl was tried and read as a fried egg, and a
 * three-colour bowl turned to mush below 24px; two flat shapes survive the favicon.
 * `public/brandyzer-mark.svg` and the favicon in index.html are the same drawing.
 */

/** Deliberately literal: the mark must not drift when the palette is retuned. */
const DISC = '#E4572E'
const STEM = '#FFFFFF'
const BOWL = '#FFC83D'

export function Mark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="60" fill={DISC} />
      {/* The bowl goes first so the stem stays whole where they meet. */}
      <circle cx="65" cy="71" r="27" fill={BOWL} />
      <rect x="29" y="22" width="16" height="76" rx="8" fill={STEM} />
    </svg>
  )
}
