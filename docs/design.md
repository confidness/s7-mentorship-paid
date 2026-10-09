# Design

Two choices, kept independent, and the stylesheet is built around keeping them so. A third,
the background, sits on top of them.

| Axis | Values | Stored |
| --- | --- | --- |
| Theme (`data-theme` on `<html>`) | light or dark, whichever the device is set to | not stored; read from `prefers-color-scheme` |
| Skin (`data-skin` on `<html>`) | what the interface is made of | per browser, `s7-skin` |
| Background (`data-backdrop` on `<html>`) | auto, silk, sculpture, glass, or off | per browser, `s7-backdrop` |

The default skin is `orbit`, and it brings a background of its own: a 3D world the interface
floats over as frosted glass. How it and the three backgrounds take turns is under
[Backgrounds](#what-each-skin-gets).

Light or dark is the device's setting, and only the device's. There is no switch in the
interface: the operating system already has one, people change it there — at sunset, on a
schedule, for their eyes — and a site that keeps its own copy ends up in daylight colours at
midnight. `index.html` applies the theme and the stored skin in a small inline script before the
page renders, so there is no flash, and `followSystemTheme` in `src/lib/theme.ts` keeps the theme
in step if the device changes while the page is open. A choice an older build stored under
`s7-theme` is ignored and cleared. The same script moves a stored `plain` to `orbit`, once
(`s7-skin-rev` = 2): the settings page used to write `plain` back on sight, so a `plain` from
before orbit records a visit, not a choice. A `plain` picked after that is kept.

A skin defines both themes, so someone who wants the editorial skin at night gets the editorial
skin at night, not a different one. Every colour is a token in `src/index.css`. No component
hard-codes a literal colour: it asks for a role — a sheet, an edge, a raised fill — and the skin
decides what that role looks like. That is what makes a new skin a block of custom properties
rather than a second stylesheet.

Three structural tokens carry most of the difference between skins, because most of what
separates one visual language from another is not hue: `--ui-radius`, `--ui-border`, and the
shadow set (diffuse, a hard offset, or none).

## The skins

The default is `orbit`, the platform's own world: a live 3D scene behind every page with the
interface as frosted glass over it (below). `plain` is still here and still deliberately
unremarkable, a neutral interface that gets out of the way, for anyone who would rather; it and
the other opinionated skins are a choice, taken in **Settings**.

There are eleven, in two families, and the split is where they came from. The first six are made
here: `orbit`, the house world, then five design disciplines: `plain`, `editorial`, `atelier`,
`brutal`, `terminal`. The second five were read off the platforms this product competes with,
whose visual languages are each a bet about what sells a course: `marketplace`, `academy`,
`streak`, `cinema`, `poster`. The picker keeps the groups apart, and draws each option as three
squares in that skin's own palette, with its real radius and border, rather than a screenshot
that goes stale the first time a colour moves.

## Orbit, the default

The interface floats over a world: the S7 mark drawn as a lit tube — the same two 270° arcs as
`Mark.tsx` — inside three tilted orbits, each carrying a satellite, over a turning galaxy and a
circuit floor, under a nebula sky. Glow is additive shells and sprites, not a bloom pass,
because this sits behind every page and has to stay cheap. Brand blue is the middle of both
palettes, with violet and cyan either side; the light theme draws the same things as tinted dust
on a pale sky rather than light on black.

Everything over it is glass: translucent sheets that blur what is behind them, a hairline of
light along the menu bar's edge, capsule controls, and one gradient, brand blue into violet, for
the thing to press. The stylesheet's rule is that every sheet is opaque enough to carry its
text's contrast on its own; the blur is a finish, not a crutch.

The camera has a vantage per section of the app, taken from `nav.ts`, so moving between sections
glides it across the room, and signing in flies it from the sign-in framing to the catalogue.
`vantage()` decides where it stands for any path: sign-in and registration put the mark beside
the form, the front door puts it to the right of the headline, every page inside the app takes
its section's station, and a page in no section — one course, one lesson, a missing address —
takes the station of the section it is reached from, or the catalogue's. On an upright screen
the front door's words run the full width, so the page leaves a stage under its buttons
(`OrbitStage`) and the camera is aimed at it, measured, and tilts with the scroll so the mark
moves with its stage.

It is one canvas, mounted once beside the routes in `App.tsx`, so the world survives every
navigation. `OrbitSceneGate.tsx` is the light half and the only thing that imports
`OrbitScene.tsx`; three and the renderer live in a lazy chunk. Because orbit is the default the
gate is careful about when: it waits for the first contentful paint and an idle moment, asks
once whether WebGL works (the first context a page makes waits for the GPU, which can be a long
task), then fetches the scene and fades it in over 600 ms after its first frame. Until then,
and wherever WebGL is missing, the CSS sky stands in: two soft radial glows on the canvas colour.
Reduced motion is a composed still frame on demand, a hidden tab draws nothing, and phones and
machines with four cores or fewer get fewer particles and a cheaper sky.

## The menu bar

One floating bar across the top replaces the sidebar and header. Five sections do not need a
column of their own, and a column cost every page 280 pixels of width to hold five words. The
bar carries the mark, the five sections, the XP ring, the bell and the account menu; the
language is in the account menu, and there is no theme control anywhere. On a phone the sections
move to a dock at the thumb with "more", which opens a sheet with the rest.

The section you are in is marked by one capsule that slides to it, and a fainter one follows the
pointer, so the bar answers a hover before a click. The section tabs inside a page use the same
sliding marker. Both are measured off the items and moved with a CSS transition rather than
Motion's layout animations, which the trimmed Motion bundle leaves out. Under the ruled skins
the marker is a raised fill in the skin's own radius and shadow; orbit adds its light.

The skip link is the first thing Tab reaches, `<main>` takes focus on every navigation, and each
tab of the browser is named after its page from the same `nav.ts` the bar draws. The bell and
account panels open from the keyboard, close on Escape — handing focus back to their button —
and close when focus moves past them.

## Backgrounds

Every page is drawn on something. Two skins bring their own — orbit its 3D world, brutal its
liquid metal — and every skin can be given one of three looks instead. Each look is one fragment
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
Sculpture, Glass or Off. A choice other than Auto holds under every skin, and the Auto tile says
what Auto means under the skin that is on — "3D scene" under orbit. Auto was decided by
rendering the skins in both themes under each look, and looking:

| Skin | Auto | Why |
| --- | --- | --- |
| orbit | its 3D world | The skin is glass over a scene; the scene is its background, the way the metal is brutal's. |
| plain | silk | The quiet skin gets the quietest look. |
| editorial | off | Silk on warm bone came out as grey smudges; a page that reads like print wants nothing behind the type. |
| atelier | sculpture | "Everything floats", made literal, under the same wide, low light the skin's shadows describe. |
| brutal | liquid metal | Its palette was read off that shader, which stays its own. |
| terminal | off | A CRT has no layers, and the scanlines already are the texture. |
| marketplace | silk | A catalogue you scan wants something felt rather than seen, and its purple makes good silk. |
| academy | silk | One blue doing every job; silk is one colour seen two ways. |
| streak | glass | The playful skin gets the playful look; sky blue and owl green make the best pearl. |
| cinema | silk | A dark house with a velvet curtain in it. |
| poster | off | Ink on paper has no depth, and the skin says so. |

Two moving backgrounds never share a screen. The orbit world is drawn only when orbit is on
Auto; Silk, Sculpture or Glass under orbit replaces it, and Off draws neither and leaves the
skin's CSS sky. The liquid metal is drawn only when brutal is on Auto; choosing any look under
brutal replaces it. The atelier sign-in scene is drawn only when the background is switched off;
otherwise the sculpture is the 3D. All of it is one answer from one pure function,
`resolveBackdrop` in `backdrop/looks.ts`, which the root Backdrop, the orbit gate and the metal
each read to decide whether the look is theirs, and `test/backdrop.test.ts` checks every skin
against every choice: at most one moving background, and the world only under orbit on Auto.

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
  colour — under orbit, its CSS sky, a fixed layer between the canvas colour and the scenes. A restored context draws again. The canvas fades in over 600 ms after its first frame.
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

The orbit world was not part of that measurement and does not read the calm zone. It keeps
text legible its own way: a veil of canvas colour over the scene — none on sign-in, where the
words sit beside the mark, about a third inside the app and a little less on the front door —
and glass under everything denser than a heading. Treat its contrast as unmeasured until
somebody repeats the measurement with it in.

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
and `@react-three/fiber` are genuinely heavy next to everything else the interface ships — about
217 kB gzipped, in one lazy chunk this scene shares with the orbit world — so the scene is
loaded lazily, and only for that skin on a screen wide enough to show it. The gate that
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

Under `prefers-reduced-motion` every CSS animation runs once and is over at once. Cutting only
the duration is not enough: an endless animation cut to a hundredth of a millisecond still runs,
landing on a different moment every frame, and a slow turn becomes a flicker. Under
`prefers-reduced-transparency` the orbit skin's sheets are solid.
