/**
 * The Brandyzer mark: a lower-case b — one stem, one bowl — on a white disc.
 *
 * Drawn rather than imported as a bitmap so it stays crisp at 20px, needs no asset request
 * and keeps its own colour in both themes: a logo is a constant, not a themed surface.
 */

/** Deliberately literal: the mark must not drift when the palette is retuned. */
const MARK_COLOR = '#E4572E'

export function Mark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="60" fill="#ffffff" />
      <rect x="34" y="24" width="16" height="72" rx="8" fill={MARK_COLOR} />
      <circle cx="66" cy="72" r="18" fill="none" stroke={MARK_COLOR} strokeWidth="16" />
    </svg>
  )
}
