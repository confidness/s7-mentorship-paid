/**
 * The background's decisions, checked without drawing anything.
 *
 * What is on screen is a shader, and a shader is checked by looking at it. What decides the
 * shader is not: which look a skin gets, whether a choice overrides it, whether two moving
 * backgrounds could ever share a screen, what colour a token is, and when the quality ladder
 * gives up detail. Those are pure, and a mistake in any of them is invisible until somebody
 * meets it — a grey background from a colour that did not parse, or a ladder that blurs the
 * page every time a tab comes back.
 */

import { contrast, ladderStart, ladderStep, LADDER_WARMUP, LADDER_WINDOW, luminance, mixCalm, mixPalette, normaliseCalm, paletteFrom, parseColor, type Ladder, type RGB } from '../src/components/backdrop/core.ts'
import { AUTO, BACKDROP_CHOICES, drawsHere, isBackdropChoice, resolveBackdrop } from '../src/components/backdrop/looks.ts'

declare const process: { exitCode?: number }

const NL = String.fromCharCode(10)
let failures = 0

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) return
  failures++
  console.error(`  FAIL  ${name}${detail === undefined ? '' : `${NL}        ${JSON.stringify(detail)}`}`)
}

const eq = (name: string, actual: unknown, expected: unknown) => check(name, Object.is(actual, expected), { actual, expected })
const bytes = (c: RGB | null) => (c ? c.map((v) => Math.round(v * 255)).join(',') : null)
const color = (name: string, input: string | null | undefined, expected: string | null) => eq(name, bytes(parseColor(input)), expected)

// Every skin, spelled out rather than imported, so adding an eleventh fails here until it is given a look.
const SKINS = ['orbit', 'plain', 'editorial', 'atelier', 'brutal', 'terminal', 'marketplace', 'academy', 'streak', 'cinema', 'poster']

/* ------------------------------------------------------------------ colour */

console.log('colour parsing')

color('six-digit hex', '#6366f1', '99,102,241')
color('upper case', '#6366F1', '99,102,241')
color('short hex expands each digit', '#fff', '255,255,255')
color('short hex with alpha keeps the colour', '#abcd', '170,187,204')
color('eight-digit hex keeps the colour', '#11223344', '17,34,51')
color('surrounding whitespace, as getPropertyValue returns it', '  #0b1120 ', '11,17,32')
color('rgb with commas', 'rgb(99, 102, 241)', '99,102,241')
color('rgba with commas', 'rgba(99,102,241,0.5)', '99,102,241')
color('rgb in space syntax with a slash alpha', 'rgb(99 102 241 / 50%)', '99,102,241')
color('percent channels', 'rgb(100%, 0%, 50%)', '255,0,128')
color('fractional channels', 'rgb(99.4, 101.6, 241)', '99,102,241')
color('out-of-range channels clamp', 'rgb(300, -5, 20)', '255,0,20')

color('empty is not a colour', '', null)
color('null is not a colour', null, null)
color('undefined is not a colour', undefined, null)
color('a keyword is left to the browser', 'rebeccapurple', null)
color('none', 'none', null)
color('two hex digits', '#12', null)
color('five hex digits', '#12345', null)
color('seven hex digits', '#1234567', null)
color('not hex digits', '#ggg', null)
color('hex without the hash', '6366f1', null)
color('two channels', 'rgb(1, 2)', null)
color('five values', 'rgb(1, 2, 3, 4, 5)', null)
color('words for channels', 'rgb(a, b, c)', null)
color('a broken alpha', 'rgba(1, 2, 3, x)', null)
color('an unclosed function', 'rgb(1, 2, 3', null)
color('hsl is left to the browser', 'hsl(0 0% 0%)', null)
color('oklch is left to the browser', 'oklch(0.6 0.2 270)', null)
color('a var() that never resolved', 'var(--color-brand-500)', null)

const white: RGB = [1, 1, 1]
const black: RGB = [0, 0, 0]
eq('white is luminance 1', luminance(white), 1)
eq('black is luminance 0', luminance(black), 0)
eq('black on white is 21:1', Math.round(contrast(black, white) * 100) / 100, 21)
check("plain's secondary text clears AA on its own canvas", contrast(parseColor('#5a6779')!, parseColor('#f4f6fa')!) >= 4.5)

/* ------------------------------------------------------------------ palette */

console.log('palette from the tokens')

const tokens = (map: Record<string, string>) => (name: string) => map[name] ?? ''
const PLAIN_LIGHT = {
  '--color-canvas': '#f4f6fa',
  '--color-brand-500': '#6366f1',
  '--color-brand-600': '#4f46e5',
  '--color-accent-400': '#4f46e5',
  '--color-ink-500': '#5a6779',
  '--color-ink-900': '#0f172a',
}

{
  const p = paletteFrom(tokens(PLAIN_LIGHT), 'plain')
  eq('plain uses its own brand-500', bytes(p.brand), '99,102,241')
  eq('the accent is the primary-action fill, accent-400', bytes(p.accent), '79,70,229')
  eq('ink-500 is read', bytes(p.ink500), '90,103,121')
  check('a pale canvas is not dark', !p.dark)
}
{
  // Atelier sets only brand-600; its 500 is plain's indigo, inherited from :root.
  const p = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-canvas': '#eceef1', '--color-brand-600': '#1f6feb', '--color-accent-400': '#14161a' }), 'atelier')
  eq("a skin that never set brand-500 gets its own 600, not plain's indigo", bytes(p.brand), '31,111,235')
}
{
  // In plain's dark theme the 600 is lightened for text, but plain's 500 is genuinely its own.
  const p = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-canvas': '#0b1120', '--color-brand-600': '#a5b4fc' }), 'plain')
  eq("plain keeps its 500 even when its 600 differs", bytes(p.brand), '99,102,241')
  check('a navy canvas is dark', p.dark)
}
{
  const p = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-brand-500': '#e6332a', '--color-brand-600': '#c81e14' }), 'brutal')
  eq('a skin with its own brand-500 uses it', bytes(p.brand), '230,51,42')
}
{
  const p = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-canvas': '#14100f' }), 'cinema')
  check("cinema's light theme is a dark room, and is drawn as one", p.dark)
}
{
  const p = paletteFrom(tokens({}), 'plain')
  eq('missing tokens fall back to plain: canvas', bytes(p.canvas), '244,246,250')
  eq('missing tokens fall back to plain: brand', bytes(p.brand), '99,102,241')
  eq('missing tokens fall back to plain: ink-500', bytes(p.ink500), '90,103,121')
}
{
  const p = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-brand-500': 'garbage', '--color-brand-600': '#1f6feb' }), 'plain')
  eq('an unreadable brand-500 falls back to the 600', bytes(p.brand), '31,111,235')
}
{
  const a = paletteFrom(tokens(PLAIN_LIGHT), 'plain')
  const b = paletteFrom(tokens({ ...PLAIN_LIGHT, '--color-canvas': '#000000' }), 'plain')
  eq('a palette crossfade starts where it was', bytes(mixPalette(a, b, 0).canvas), bytes(a.canvas))
  eq('and ends where it is going', bytes(mixPalette(a, b, 1).canvas), bytes(b.canvas))
  check('and decides dark from the colour it has reached', !mixPalette(a, b, 0.1).dark && mixPalette(a, b, 0.9).dark)
}

/* ------------------------------------------------------------------ which look */

console.log('which look, under which skin')

for (const skin of SKINS) {
  const look = AUTO[skin as keyof typeof AUTO]
  check(`${skin} has an Auto look`, ['silk', 'sculpture', 'glass', 'metal', 'orbit', 'off'].includes(look), { skin, look })
}
eq('there is no Auto look for a skin that does not exist', Object.keys(AUTO).length, SKINS.length)
eq('plain gets silk', AUTO.plain, 'silk')
eq('atelier gets the sculpture', AUTO.atelier, 'sculpture')
eq('brutal keeps its liquid metal', AUTO.brutal, 'metal')
check('only brutal gets the metal', SKINS.every((skin) => (AUTO[skin as keyof typeof AUTO] === 'metal') === (skin === 'brutal')))
eq('orbit brings its own world', AUTO.orbit, 'orbit')
check('only orbit gets the orbit world', SKINS.every((skin) => (AUTO[skin as keyof typeof AUTO] === 'orbit') === (skin === 'orbit')))

eq('Auto under brutal is the metal', resolveBackdrop('auto', 'brutal'), 'metal')
eq('an explicit choice replaces the metal under brutal', resolveBackdrop('silk', 'brutal'), 'silk')
eq('Off under brutal is off, not the metal', resolveBackdrop('off', 'brutal'), 'off')
eq('Auto under an unknown skin is what plain gets', resolveBackdrop('auto', 'nonsense'), 'silk')

eq('Auto under orbit is its world', resolveBackdrop('auto', 'orbit'), 'orbit')
check('and the root Backdrop draws nothing there', !drawsHere(resolveBackdrop('auto', 'orbit')))
for (const look of ['silk', 'sculpture', 'glass'] as const) {
  eq(`${look} chosen under orbit replaces the world`, resolveBackdrop(look, 'orbit'), look)
  check(`and the root Backdrop draws ${look} there`, drawsHere(resolveBackdrop(look, 'orbit')))
}
eq('Off under orbit is off, not the world: the skin keeps its CSS sky', resolveBackdrop('off', 'orbit'), 'off')

for (const skin of SKINS) {
  for (const choice of BACKDROP_CHOICES) {
    const look = resolveBackdrop(choice, skin)
    if (choice !== 'auto') eq(`${choice} holds under ${skin}`, look, choice)
    // The four things that can draw a moving background, and the rule that gates each.
    const metal = look === 'metal'
    const orbitWorld = look === 'orbit'
    const backdrop = drawsHere(look)
    const atelierScene = skin === 'atelier' && look === 'off'
    check(`at most one moving background for ${choice} under ${skin}`, [metal, orbitWorld, backdrop, atelierScene].filter(Boolean).length <= 1, { choice, skin, look })
    check(`the orbit world never runs under ${skin} with ${choice}`, !orbitWorld || (skin === 'orbit' && choice === 'auto'), { choice, skin, look })
  }
}

check('metal is not something a person can pick', !isBackdropChoice('metal'))
check('nor is the orbit world: it comes with its skin', !isBackdropChoice('orbit'))
check('nor is garbage', !isBackdropChoice('sparkles') && !isBackdropChoice(null) && !isBackdropChoice(undefined))
check('every listed choice is one', BACKDROP_CHOICES.every(isBackdropChoice))
eq('Auto is the first choice, and the default', BACKDROP_CHOICES[0], 'auto')

/* ------------------------------------------------------------------ calm zone */

console.log('calm zone')

{
  const none = normaliseCalm(null, 1440, 900)
  check('no zone means the look decides', none.text === null && !none.phone)
  eq("and the stage defaults to the prototypes' right gutter", none.stage.join(), '0.62,1')
  const phone = normaliseCalm(null, 390, 844)
  check('under 768 px it is a phone', phone.phone)
  check('a page is assumed to have its chrome unless it says otherwise', !phone.bare)
  check('and a bare one says so', normaliseCalm({ text: null, stage: null, bare: true }, 390, 844).bare)
  const z = normaliseCalm({ text: { left: 288, top: 0, right: 720, bottom: 900 }, stage: null }, 1440, 900)
  eq('the text box is in fractions of the viewport', z.text!.join(), '0.2,0,0.5,1')
  eq('and the stage starts where the text ends', z.stage.join(), '0.5,1')
  const login = normaliseCalm({ text: { left: 72, top: 0, right: 576, bottom: 900 }, stage: { left: 576, right: 936 } }, 1440, 900)
  eq('a measured stage is kept', login.stage.join(), '0.4,0.65')
  const half = mixCalm(z, login, 0.5)
  eq('moving between pages, the zone passes through the middle', half.text!.map((v) => Math.round(v * 1000) / 1000).join(), '0.125,0,0.45,1')
  eq('and so does the stage', half.stage.join(), '0.45,0.825')
  check('a zone that appears has nothing to come from', mixCalm(none, z, 0.5) === z)
  check('nor does one that turns into a phone', mixCalm(z, normaliseCalm(null, 390, 844), 0.5).phone)
}

/* ------------------------------------------------------------------ quality ladder */

console.log('quality ladder')

const BUDGET = 1000 / 30
/** Frames at a steady duration, or a duration per frame, for so many milliseconds. */
const run = (start: Ladder, ms: number, dt: number | ((i: number, t: number) => number), levels = 5) => {
  let s = start
  for (let i = 0, t = 0; t < ms; i++) {
    const d = typeof dt === 'number' ? dt : dt(i, t)
    s = ladderStep(s, d, BUDGET, levels)
    t += d
  }
  return s
}
const seconds = (n: number) => LADDER_WINDOW * n

{
  const s = run(ladderStart(1), LADDER_WARMUP, BUDGET * 3)
  eq('the warm-up is not judged, however slow', s.level, 1)
  check('and it is used up', s.skip <= 0, s)
}
{
  const s = run(ladderStart(1), LADDER_WARMUP + seconds(100), BUDGET)
  eq('frames on budget never change the level', s.level, 1)
}
{
  const warm = run(ladderStart(1), LADDER_WARMUP, BUDGET)
  eq('one slow second is not enough', run(warm, seconds(1), BUDGET * 1.5).level, 1)
  eq('two slow seconds in a row step down one', run(warm, seconds(2) + 1, BUDGET * 1.5).level, 2)
  eq('two very slow seconds step down two', run(warm, seconds(2) + 1, BUDGET * 3).level, 3)
  eq('it stops at the bottom', run(warm, seconds(40), BUDGET * 3).level, 4)
  // A slow device is judged as soon as a fast one: six frames a second still steps within seconds.
  eq('a device drawing six frames a second steps down within four seconds of starting', run(ladderStart(1), LADDER_WARMUP + seconds(2.5), 170).level, 3)
  const now_and_then = run(warm, seconds(40), (_, t) => (Math.floor(t / 1000) % 3 === 0 ? BUDGET * 1.6 : BUDGET))
  eq('a slow second now and then never steps', now_and_then.level, 1)
  const stepped = run(warm, seconds(2) + 1, BUDGET * 1.5)
  eq('it never climbs back, however fast the frames come', run(stepped, seconds(200), BUDGET * 0.5).level, 2)
  const spike = run(warm, seconds(6), (i) => (i % 30 === 0 ? 10_000 : BUDGET))
  eq('one frame-long stall a second is clamped, not a slow GPU', spike.level, 1)
}

/* ------------------------------------------------------------------ done */

if (failures) {
  console.error(`${NL}${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('✓ colours parse or fall back, every skin has a look, a choice overrides it, one background at a time, and the ladder only ever steps down')
}
