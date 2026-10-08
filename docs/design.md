# Design

Two choices, kept independent, and the stylesheet is built around keeping them so.

| Axis | Values | Stored |
| --- | --- | --- |
| Theme (`data-theme` on `<html>`) | light, dark, or follow the system | per browser, `s7-theme` |
| Skin (`data-skin` on `<html>`) | what the interface is made of | per browser, `s7-skin` |

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

## Brutalist, on a liquid-metal field

This is the `brutal` skin, and it is the one the product was first built in.

The background is `LiquidMetal` from Paper Design's own shader package, so the parameters come
straight from `shaders.paper.design` and no WebGL is written here. It freezes under
`prefers-reduced-motion` and when the tab is hidden — the reduced-motion rule in the stylesheet
reaches CSS animation and nothing driven from JavaScript, which is a gap worth knowing about.
It is only mounted under this skin, so the other skins never start a WebGL context for it.

The palette is read off that field rather than invented: the near-black at the centre of a
metaball, the cool slate of its shadow side, the white of the tint, and the molten red running
into signal yellow that the chromatic aberration throws along every edge. There is no green in
that image and none in this skin.

Nothing pretends to be glass. No blur, no specular rim, no soft shadow. Depth is a hard offset,
corners are square, and colour is rationed: yellow for the one thing that matters on a screen,
red for what is destructive, and nothing else. Buttons are filled blocks that move into their
own shadow when pressed.

## The atelier scene

The `atelier` skin can show a Three.js scene behind the sign-in page on wide screens. `three`
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
