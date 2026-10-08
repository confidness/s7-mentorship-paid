import { Check } from 'lucide-react'
import { useBackdropChoice } from '../lib/backdrop'
import { useAppliedSkin, useAppliedTheme } from '../lib/theme'
import { BACKDROP_CHOICES, resolveBackdrop, type Look } from './backdrop/looks'
import { t } from '../i18n'

/**
 * Choosing what the pages sit on.
 *
 * The previews are pictures, not swatches like the skins get. A skin is a palette and a
 * shape, which three squares can honestly describe; a background is light falling on
 * something, and only an image of it says what it is. They are tiny renders of the real
 * shaders in the default palette, one for each theme, so the preview is never a mock-up of
 * something the page does not draw. Off is the page's own canvas, drawn live.
 *
 * Auto says which look it stands for under the skin that is on, since that is the one
 * question the word "auto" leaves open.
 */
const NAME: Record<Look, string> = {
  silk: 'backdrop_silk',
  sculpture: 'backdrop_sculpture',
  glass: 'backdrop_glass',
  metal: 'backdrop_metal',
  off: 'backdrop_off',
}

/** Skins whose canvas is dark under either theme; their previews are the dark renders. */
const DARK_ROOMS = ['cinema', 'terminal']

export default function BackdropPicker() {
  const { choice, setChoice } = useBackdropChoice()
  const skin = useAppliedSkin()
  const theme = useAppliedTheme()
  const dark = theme === 'dark' || DARK_ROOMS.includes(skin)
  const auto = resolveBackdrop('auto', skin)

  return (
    <div>
      <p id="background-heading" className="text-xs font-bold tracking-wide text-ink-500">
        {t('background')}
      </p>
      <p className="mt-0.5 mb-2.5 text-xs text-ink-500">{t('background_note')}</p>
      <div role="radiogroup" aria-labelledby="background-heading" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {BACKDROP_CHOICES.map((id) => {
          const look = id === 'auto' ? auto : id
          const active = choice === id
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => setChoice(id)}
              className={`flex flex-col gap-2 rounded-[var(--ui-radius-sm)] border p-2 text-left transition ${
                active ? 'border-[var(--color-accent-400)] fill-strong ring-2 ring-[var(--color-accent-400)]' : 'edge fill-soft hover:fill'
              }`}
            >
              <Preview look={look} dark={dark} />
              <span className="min-w-0 px-0.5 pb-0.5">
                <span className="flex items-center gap-1 text-sm font-bold text-ink-900">
                  {t(`backdrop_${id}`)}
                  {active && <Check size={14} aria-hidden="true" />}
                </span>
                {id === 'auto' && <span className="block truncate text-xs text-ink-500">{t(NAME[auto])}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Preview({ look, dark }: { look: Look; dark: boolean }) {
  const frame = 'block aspect-[8/5] w-full overflow-hidden rounded-[max(0px,calc(var(--ui-radius-sm)-4px))] border edge'
  if (look === 'off') return <span aria-hidden="true" className={frame} style={{ background: 'var(--color-canvas)' }} />
  // The metal belongs to the brutal skin and its own shader package; a brushed gradient in
  // that shader's two greys says which one it is without a picture of somebody else's work.
  if (look === 'metal') {
    const [a, b] = dark ? ['#1b1b21', '#6f7790'] : ['#aaaaac', '#ffffff']
    return <span aria-hidden="true" className={frame} style={{ background: `linear-gradient(115deg, ${a} 10%, ${b} 45%, ${a} 60%, ${b} 85%)` }} />
  }
  return (
    <span aria-hidden="true" className={frame}>
      <img src={`/backdrops/${look}-${dark ? 'dark' : 'light'}.webp`} alt="" width={240} height={150} loading="lazy" decoding="async" className="block h-full w-full object-cover" />
    </span>
  )
}
