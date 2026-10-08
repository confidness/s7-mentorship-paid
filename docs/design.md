# Design

Two choices, kept independent, and the stylesheet is built around keeping them so. A third,
the background, sits on top of them.

| Axis | Values | Stored |
| --- | --- | --- |
| Theme (`data-theme` on `<html>`) | light, dark, or follow the system | per browser, `s7-theme` |
| Skin (`data-skin` on `<html>`) | what the interface is made of | per browser, `s7-skin` |
| Background (`data-backdrop` on `<html>`) | auto, silk, sculpture, glass, or off | per browser, `s7-backdrop` |

Light or dark, or follow the system — stored per browser and applied before first paint, so
there is no flash. `index.html` reads both choices in a small inline script before the page
renders; getting this wrong is not a flicker, it is the site showing the wrong palette.

A skin defines both themes, so someone who wants the editorial skin at night gets the editorial
skin at night, not a different one. Every colour is a token in `src/index.css`. No component
hard-codes a literal colour: it asks for a role — a sheet, an edge, a raised fill — and the skin
decides what that role looks like. That is what makes a new skin a block of custom properties
rather than a second stylesheet.

Three structural tokens carry most of the difference between skins, because most of what
separates one visual language from another is not hue: `--ui-radius`, `--ui-border`, and the
shadow set (diffuse, a hard offset, or none).

## The skins

The default is `plain`, and it is deliberately unremarkable: a neutral interface that gets out
of the way. A product should not make a statement on somebody's first visit; the opinionated
skins are a choice, taken in **Settings**.

There are ten, in two families, and the split is where they came from. The first five are design
disciplines: `plain`, `editorial`, `atelier`, `brutal`, `terminal`. The second five were read off
the platforms this product competes with, whose visual languages are each a bet about what sells
a course: `marketplace`, `academy`, `streak`, `cinema`, `poster`. The picker keeps the groups
apart, and draws each option as three squares in that skin's own palette, with its real radius
and border, rather than a screenshot that goes stale the first time a colour moves.

## Backgrounds

Every page is drawn on something, and there are three things it can be. Each is one fragment
shader on one full-screen triangle, written for WebGL2 by hand in `src/components/backdrop/`,
with no library, no texture and nothing fetched.

- **Silk** is a back-lit sheet of shot silk. A heightfield is raymarched at a grazing,
  telephoto angle, so near folds hide the ones behind them and the far ones dissolve into the
  page colour. The brand is the warp thread, seen face-on, and the accent the weft, seen at a
  slant. It is the default, and the quietest of the three.
- **Sculpture** is a studio still-life: a torus in the brand colour, an accent jewel, a
  capsule and a rounded cube, in satin under one soft-box, cascading down the right edge. The
  light comes from the side the text is on, so the forms' dark sides face away from it.
- **Glass** is a few pearl drops in a seamless studio. A small one draws a liquid bridge out
  of a larger mass until it thins and snaps, and leaves a droplet behind. Pearl in the light
  theme, obsidian in the dark.

None of them has a colour of its own. The palette is read off the live tokens — canvas, brand,
the primary-action accent, and the two inks — whenever the skin or the theme changes, and the
picture eases across to it over 400 ms rather than cutting. Atelier and editorial never set
their own `brand-500`, so for them it is their `brand-600`, not plain's indigo.

### What each skin gets

The choice is in **Settings → Appearance → Background**, next to the skins: Auto, Silk,
Sculpture, Glass or Off. A choice other than Auto holds under every skin. Auto was decided by
rendering all ten skins in both themes under each look, and looking:

| Skin | Auto | Why |
| --- | --- | --- |
| plain | silk | The default should be quiet, and silk is the quietest. |
| editorial | off | Silk on warm bone came out as grey smudges; a page that reads like print wants nothing behind the type. |
| atelier | sculpture | "Everything floats", made literal, under the same wide, low light the skin's shadows describe. |
| brutal | liquid metal | Its palette was read off that shader, which stays its own. |
| terminal | off | A CRT has no layers, and the scanlines already are the texture. |
| marketplace | silk | A catalogue you scan wants something felt rather than seen, and its purple makes good silk. |
| academy | silk | One blue doing every job; silk is one colour seen two ways. |
| streak | glass | The playful skin gets the playful look; sky blue and owl green make the best pearl. |
| cinema | silk | A dark house with a velvet curtain in it. |
| poster | off | Ink on paper has no depth, and the skin says so. |

Two moving backgrounds never share a screen. The liquid metal is drawn only when brutal is on
Auto; choosing any look under brutal replaces it. The atelier sign-in scene is drawn only when
the background is switched off; otherwise the sculpture is the 3D. Both rules come from the
same function, `resolveBackdrop`, and `test/backdrop.test.ts` checks every skin and choice.

### What it promises

- **One canvas.** It is mounted once, beside the routes, so it and its WebGL context survive
  every navigation. Moving between pages never starts a second one or shows the plain colour.
- **Thirty frames a second, at most.** The motion is slow enough that sixty would look the same
  and cost twice as much.
- **A fraction of the pixels.** Each look renders at 33–75 % of the screen's resolution, under a
  budget of 0.75 to 1.1 megapixels, and is scaled up by the browser; the subjects are soft and
  so is the haze.
- **A quality ladder that only goes down.** After a 1.5-second warm-up, frames are judged a
  second at a time. Two slow seconds in a row drop the resolution and the march budget one
  step, two when they ran more than 2.5 times over. The sculpture and the glass have thin,
  bright edges that turn into staircases when scaled up too far, so they stop at a floor of
  resolution, and the last rungs of every look lower the frame rate to 20 and then 15 instead:
  the slowest motion here takes half a minute, and fewer frames of it look better than fewer
  pixels. It never climbs back, because under a frame cap there is no honest signal to climb
  on, and a ladder that climbs on a guess oscillates.
- **Nothing per frame but drawing.** Layout is measured on navigation and resize only; the
  pointer is a passive listener read once a frame; the frame loop reads nothing back.
- **Reduced motion is one frame.** Under `prefers-reduced-motion` each look draws a composed
  moment once and stops, with no fade, and follows the setting if it changes. Pointer parallax
  is for a mouse or trackpad only, and gentle.
- **A hidden tab draws nothing.** The clock only runs while frames are drawn, so coming back
  picks up where it was rather than jumping ahead.
- **No WebGL2, nothing drawn.** `html` carries the canvas colour and `body` is transparent, so
  without WebGL2, before the first frame, or after a lost context, the page is simply its own
  colour. A restored context draws again. The canvas fades in over 600 ms after its first frame.
- **Small.** The gate in the first download is about 2 kB; each look is its own chunk, fetched
  the first time it is shown, and Off fetches none.

### Legibility

Text that sits straight on the canvas — headings, ledes, section titles — has to stay AA over
whatever is moving behind it. Pages say where that text is with `data-backdrop-calm` on an
element: `column` for the app's main column (only its first 560 pixels, where headings and
ledes reach), `text` for the front door and sign-in (measured off the words themselves), and
`box` for a block that stays put, like the missing-page message. Sign-in also marks its form
`data-backdrop-avoid`, so the sculpture and the glass stand in the gap beside it rather than
behind it.

Each look keeps that zone quiet in its own way. Silk holds every pixel in it at 4.6:1 or better
against `ink-500`, computed in the shader from the live colours, as a smooth knee so the folds
keep their shape. The sculpture and the glass keep their subject out of it and fade to the page
inside it. On a phone, text runs the full width and scrolls over everything, so silk guards all
of it, and the other two hold all of a bare page's text calm.

This was measured rather than eyeballed: for every line of text with no opaque surface under
it, the contrast against every rendered background pixel beneath it, across all ten skins, both
themes and all three looks, on the front door, sign-in, the catalogue and a missing page, at
1440 and 390 pixels wide, scrolled where the page scrolls. That is six hundred screens and three
thousand lines, and none is under 4.5:1: the worst is 4.56 on silk, 4.59 on the sculpture and
4.78 on the glass. Getting there fixed three things the prototypes got wrong — silk's guard
compared gamma-encoded values with a threshold WCAG measures decoded, glass let bright rims
through at a fifth of their strength under measured text, and the sculpture's foreground cube
reached the foot of the sign-in story — so the measuring is worth repeating whenever a look
or a page's layout changes.

Two rules for anyone adding a page. Never give `body` or a page's root a background: it paints
over the backdrop. And keep text that sits on the canvas inside the element the page marks as
calm — the app's `<main>` already is.

## Brutalist, on a liquid-metal field

This is the `brutal` skin, and it is the one the product was first built in.

The background is `LiquidMetal` from Paper Design's own shader package, so the parameters come
straight from `shaders.paper.design` and no WebGL is written here. It freezes under
`prefers-reduced-motion` and when the tab is hidden — the reduced-motion rule in the stylesheet
reaches CSS animation and nothing driven from JavaScript, which is a gap worth knowing about.
It is only mounted while the background resolves to it — brutal, on Auto — so the other skins
never start a WebGL context for it, and a background chosen under brutal replaces it.

The palette is read off that field rather than invented: the near-black at the centre of a
metaball, the cool slate of its shadow side, the white of the tint, and the molten red running
into signal yellow that the chromatic aberration throws along every edge. There is no green in
that image and none in this skin.

Nothing pretends to be glass. No blur, no specular rim, no soft shadow. Depth is a hard offset,
corners are square, and colour is rationed: yellow for the one thing that matters on a screen,
red for what is destructive, and nothing else. Buttons are filled blocks that move into their
own shadow when pressed.

## The atelier scene

The `atelier` skin can show a Three.js scene behind the sign-in page on wide screens, when the
background is switched off; on Auto the sculpture is atelier's 3D, on every page. `three`
and `@react-three/fiber` are genuinely heavy next to everything else the interface ships, so the
scene is loaded lazily, and only for that skin on a screen wide enough to show it. The gate that
decides this lives in a module that does not itself import `three` (`AtelierSceneGate.tsx`);
`AtelierScene.tsx` carries the import, and nothing else should render the scene directly. Like
the shader, it freezes under reduced motion and in a hidden tab, and it is `aria-hidden`.

## Motion

Motion is five primitives copied in from Motion Primitives, not a dependency on all thirty:
one entrance per screen on navigation, a stagger where a list is genuinely ordered, a
directional crossfade between a lesson's sections, and a counting XP total. No card fades up on
any grid. `LazyMotion` with only the DOM features, mounted `strict`, keeps the cost down and
makes a stray `motion.div` throw rather than quietly pull the whole library back in.

All of it sits on one curve, `cubic-bezier(0.22, 1, 0.36, 1)`, at about a third of a second.
Motion arriving on a different curve from the CSS beside it reads as a second designer.

Motion answers an action or marks a change. It does not decorate.

## Accessibility

Student routes were audited at WCAG AA in both themes, measured over about 1500 text nodes,
while the brutal skin was the only one. The log records no repeat of that audit for the other
nine, so treat their contrast as unmeasured until someone does it.

Two rules came out of it that hold for any skin. State must not be signalled by losing
contrast: a locked lesson carries a lock icon, so dimming its label said nothing the icon did
not and made the label unreadable. And a colour that the dark theme lightens so it reads as text
is the wrong colour for a fill under white text; use a solid token that stays dark.

Interactive things built from `div`s need a keyboard path, controls need labels, and `aria-*`
needs a real id behind it.
