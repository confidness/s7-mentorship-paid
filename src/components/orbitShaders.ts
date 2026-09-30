/**
 * GLSL for the orbit scene, kept apart from the component so the scene reads as a scene.
 *
 * Every fragment shader ends in `colorspace_fragment`: colours arrive as linear values (three
 * converts the hex strings on the way in) and have to leave as sRGB, or the blues on the
 * canvas would not be the blues in the stylesheet around it. The canvas is `flat`, so no tone
 * mapping sits between the two.
 *
 * `uDark` switches blending intent rather than palette. On black, light adds — additive
 * particles and halos glow. On a pale canvas, additive light is invisible, so the same
 * elements draw as tinted dust and soft auras instead.
 */

const NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < OCTAVES; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03;
    a *= 0.5;
  }
  return v;
}
`

/* ------------------------------------------------------------------ the sky */

export const backdropVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`

export const backdropFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uDark;
uniform float uAspect;
uniform vec2 uShift;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) + uShift;
  vec3 col = mix(uBottom, uTop, smoothstep(-0.7, 0.7, p.y));

  float t = uTime * 0.015;
  vec2 q = vec2(fbm(p * 1.4 + vec2(t, -t)), fbm(p * 1.4 + vec2(-t * 0.7, t) + 4.7));
  float n = fbm(p * 1.9 + q * 2.2 + vec2(t * 1.5, 0.0));
  float cloud = smoothstep(0.42, 0.95, n);
  vec3 neb = mix(uA, uB, smoothstep(0.25, 0.75, q.x));
  neb = mix(neb, uC, smoothstep(0.55, 0.85, q.y) * 0.7);
  float reach = 1.0 - smoothstep(0.1, 1.25, length(p - vec2(0.35, 0.1)));
  float amount = cloud * (0.35 + 0.65 * reach) * uIntensity;

  if (uDark > 0.5) {
    col += neb * amount * 0.6;
    col *= 1.0 - 0.45 * smoothstep(0.45, 1.3, length(vUv - 0.5) * 1.6);
  } else {
    col = mix(col, neb, amount * 0.3);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // Dither after the sRGB step: a gradient this slow bands on an 8-bit screen otherwise.
  gl_FragColor.rgb += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
}
`

/* ------------------------------------------------------------------ particles */

export const galaxyVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uSpin;
varying vec3 vColor;
varying float vTw;
void main() {
  vec3 p = position;
  float r = length(p.xz);
  // Differential rotation: the core turns faster than the rim, which is what makes it read
  // as a galaxy and not a rotating decal.
  float a = atan(p.z, p.x) + uTime * uSpin / (0.35 + r * 0.25);
  p.xz = vec2(cos(a), sin(a)) * r;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vTw = 0.55 + 0.45 * sin(uTime * 1.3 + aPhase * 6.2831);
  gl_PointSize = uSize * aSize * uPixelRatio * (0.75 + 0.25 * vTw) / max(-mv.z, 0.1);
  vColor = aColor;
}
`

export const motesVertex = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
varying vec3 vColor;
varying float vTw;
void main() {
  vec3 p = position;
  p.y = mod(p.y + uTime * (0.12 + aPhase * 0.22) + 4.0, 8.0) - 4.0;
  p.x += sin(uTime * 0.4 + aPhase * 12.0) * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Fade out at both ends of the column so the wrap-around is never seen.
  vTw = smoothstep(4.0, 2.6, abs(p.y));
  gl_PointSize = uSize * aSize * uPixelRatio / max(-mv.z, 0.1);
  vColor = aColor;
}
`

export const particleFragment = /* glsl */ `
uniform float uIntensity;
uniform float uDark;
uniform float uFade;
varying vec3 vColor;
varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 1.6);
  if (a < 0.01) discard;
  float fade = mix(1.0, vTw, uFade);
  vec3 c = uDark > 0.5 ? vColor * (0.7 + 0.6 * vTw) : vColor;
  float alpha = uDark > 0.5 ? a : a * (0.5 + 0.25 * vTw);
  gl_FragColor = vec4(c, alpha * fade * uIntensity);
  #include <colorspace_fragment>
}
`

/* ------------------------------------------------------------------ the mark */

export const markVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

export const markFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uDark;
uniform float uFixed;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uPulse;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float along = uFixed < 0.0 ? vUv.x : uFixed;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 base = mix(uA, uB, smoothstep(0.0, 1.0, along));

  vec3 L = normalize(vec3(-0.4, 0.7, 0.6));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 48.0);

  // Two bands of energy running the length of the S, half a lap apart.
  float k1 = fract(along - uTime * 0.12);
  float k2 = fract(along - uTime * 0.12 + 0.5);
  float pulse = exp(-pow((k1 - 0.5) * 18.0, 2.0)) + 0.6 * exp(-pow((k2 - 0.5) * 26.0, 2.0));
  // Machined grooves round the tube, so it reads as a made object rather than a neon sign.
  float grooves = smoothstep(0.92, 1.0, sin(along * 420.0) * 0.5 + 0.5) * 0.15;

  vec3 col;
  if (uDark > 0.5) {
    col = base * (0.25 + 0.55 * diff) + base * fres * 1.6 + spec * 0.6 + uPulse * pulse * 1.4 + grooves * base;
  } else {
    col = base * (0.55 + 0.45 * diff) + vec3(spec * 0.7) + vec3(fres * 0.35) + uPulse * pulse * 0.8 - grooves * 0.15;
  }
  gl_FragColor = vec4(col * mix(0.55, 1.0, uIntensity), 1.0);
  #include <colorspace_fragment>
}
`

/** A larger shell drawn from the inside: bright where it hugs the tube, gone at its own rim. */
export const haloFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uDark;
uniform float uFixed;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float along = uFixed < 0.0 ? vUv.x : uFixed;
  float glow = pow(clamp(-dot(n, v), 0.0, 1.0), 2.2);
  float breathe = 0.85 + 0.15 * sin(uTime * 1.4);
  vec3 col = mix(uA, uB, along);
  float alpha = glow * breathe * uIntensity * (uDark > 0.5 ? 0.9 : 0.32);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`

/* ------------------------------------------------------------------ orbits */

export const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const ringFragment = /* glsl */ `
uniform float uIntensity;
uniform float uDark;
uniform float uDashes;
uniform float uDir;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float a = vUv.x;
  float dash = step(0.7, fract(a * uDashes));
  // The satellite sits at a = 0; its wake trails behind it in the direction it came from.
  float behind = uDir > 0.0 ? 1.0 - a : a;
  float tail = exp(-behind * 6.0);
  float alpha = (0.22 * dash + 0.9 * tail) * uIntensity * (uDark > 0.5 ? 1.0 : 0.75);
  gl_FragColor = vec4(uColor * (1.0 + tail * 1.5), alpha);
  #include <colorspace_fragment>
}
`

/* ------------------------------------------------------------------ the floor */

export const gridVertex = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const gridFragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uDark;
uniform vec3 uColor;
varying vec3 vPos;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec2 p = vPos.xz;
  p.y += uTime * 0.35;
  vec2 cell = p / 1.2;
  vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
  float line = 1.0 - min(min(g.x, g.y), 1.0);

  float d = length(vPos.xz);
  float fade = 1.0 - smoothstep(3.0, 26.0, d);

  // A pulse leaves the centre every few seconds and runs out across the board.
  float w = fract(d * 0.06 - uTime * 0.12);
  float wave = smoothstep(0.0, 0.015, w) * (1.0 - smoothstep(0.015, 0.07, w));

  // A few junctions are live at any moment, like traces on a board under test.
  vec2 id = floor(cell + 0.5);
  float live = step(0.93, hash(id));
  float blink = 0.5 + 0.5 * sin(uTime * 2.0 + hash(id + 3.1) * 6.2831);
  float node = smoothstep(0.12, 0.02, length(cell - id)) * live * blink;

  float alpha = (line * (0.22 + wave * 1.5) + node * 1.2) * fade * uIntensity * (uDark > 0.5 ? 1.0 : 0.7);
  gl_FragColor = vec4(uColor * (1.0 + wave + node), alpha);
  #include <colorspace_fragment>
}
`
