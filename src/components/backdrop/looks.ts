import type { SkinChoice } from '../../lib/theme'

/**
 * Which background a page is drawn on, decided without drawing anything.
 *
 * Pure on purpose: the gate at the app root needs the answer before any engine is fetched,
 * the brutal skin's liquid metal and the atelier sign-in scene need it to stand aside, and
 * the tests need it without a browser.
 */

/** The three looks that live in this folder, plus the brutal skin's own shader and nothing. */
export type Look = 'silk' | 'sculpture' | 'glass' | 'metal' | 'off'

/** What a person can pick. `metal` is not a choice: it belongs to one skin and comes with it. */
export type BackdropChoice = 'auto' | 'silk' | 'sculpture' | 'glass' | 'off'

export const BACKDROP_CHOICES: BackdropChoice[] = ['auto', 'silk', 'sculpture', 'glass', 'off']

export const isBackdropChoice = (value: unknown): value is BackdropChoice => (BACKDROP_CHOICES as unknown[]).includes(value)

/**
 * What Auto draws under each skin, chosen by rendering every skin in both themes and looking.
 *
 * - plain → silk: the default should be quiet, and silk is the quietest of the three.
 * - editorial → off: warm paper meant to read like a printed page. Silk on bone came out as
 *   grey smudges, and anything behind the type turns the document back into an app.
 * - atelier → sculpture: "everything floats", made literal: satin forms under one soft-box,
 *   the same wide, low shadow the skin is built from.
 * - brutal → metal: its palette was read off the liquid-metal shader, which stays its own.
 * - terminal → off: a CRT has no layers, and its scanlines already are the texture.
 * - marketplace → silk: a catalogue you scan wants something felt rather than seen, and the
 *   purple makes a good shot silk.
 * - academy → silk: one blue doing every job, and silk is one colour seen two ways.
 * - streak → glass: the playful one gets the playful look, and its sky blue and owl green
 *   make the best pearl of any palette.
 * - cinema → silk: a dark house with a velvet curtain in it, which is what a theatre is.
 * - poster → off: ink on paper has no depth, and the skin says so in its own comment.
 */
export const AUTO: Record<SkinChoice, Look> = {
  plain: 'silk',
  editorial: 'off',
  atelier: 'sculpture',
  brutal: 'metal',
  terminal: 'off',
  marketplace: 'silk',
  academy: 'silk',
  streak: 'glass',
  cinema: 'silk',
  poster: 'off',
}

/**
 * The look on screen for a choice under a skin.
 *
 * An explicit choice wins under every skin, including brutal — there it replaces the metal
 * rather than drawing over it, because two moving backgrounds on one screen is one too many.
 * An unknown skin falls back to plain's answer rather than to nothing.
 */
export function resolveBackdrop(choice: BackdropChoice, skin: string): Look {
  if (choice !== 'auto') return choice
  return AUTO[skin as SkinChoice] ?? AUTO.plain
}

/** The looks this folder draws. The other two are somebody else's or nothing. */
export const drawsHere = (look: Look): look is 'silk' | 'sculpture' | 'glass' => look === 'silk' || look === 'sculpture' || look === 'glass'
