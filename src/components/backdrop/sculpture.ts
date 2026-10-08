/**
 * Floating sculpture: a studio still-life of soft satin forms — a torus in the brand colour,
 * an accent jewel, a porcelain capsule and a rounded cube — cascading down the right edge
 * under one big soft-box. Far forms melt into the page and near ones go out of focus.
 *
 * Signed distance fields, raymarched inside per-form bounding spheres, so most pixels never
 * march at all. One key light from the side the text is on, so the forms' dark sides face
 * away from it; shadows go down the brand's own ramp instead of toward grey; and edges are
 * anti-aliased from the closest approach the march saw, which holds up even at a phone's
 * 195-pixel-wide internal resolution.
 */
import { CALM_GLSL, linear, start, readPalette, type EngineOptions, type Frame, type LookSpec, type Uniforms } from './core'

export { readPalette }

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uCanvas, uBrand, uAccent, uInk, uCam;
uniform float uDark, uS, uTanH;
uniform int uSteps;
uniform vec4 uObj[6];
uniform mat3 uRot[6];
uniform vec2 uCalmX;         // landscape: calm left of .x, none right of .y (follows the text column)
uniform vec4 uCalm, uCalmF;  // and a measured text box, where there is one
out vec4 fragColor;
#define N 6
vec3 L, KU, KV, RS, B, Kc, Sky, Bnc, Floor, Rim;
float pix;
${CALM_GLSL}

float sdTorus(vec3 p, float R, float r){ return length(vec2(length(p.xz) - R, p.y)) - r; }
float sdRBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r; }
float sdCap(vec3 p, float h, float r){ p.y -= clamp(p.y, -h, h); return length(p) - r; }

float obj(int i, vec3 p){
  p = (p - uObj[i].xyz) * uRot[i] / uS;
  float d;
  // indexed front to back, so the march finds the nearer form first and culls what is behind it
  if (i == 0) d = sdRBox(p, vec3(.42), .3);
  else if (i == 1) d = length(p) - .34;
  else if (i == 2) d = sdTorus(p, .86, .4);
  else if (i == 3) d = sdCap(p, .58, .36);
  else if (i == 4) d = length(p) - .3;
  else d = length(p) - 2.;
  return d * uS;
}

void mat(int i, out vec3 alb, out float rough, out float f0){
  // tonal forms: porcelain on light, graphite satin on dark; the hero and the jewel carry the hue
  vec3 por = uDark > .5 ? uCanvas * 2.2 + uInk * .014 : mix(uCanvas, vec3(1), .45);
  alb = por; rough = uDark > .5 ? .36 : .5; f0 = uDark > .5 ? .05 : .035;
  if (i == 1) { alb = uAccent; rough = .22; f0 = .05; }
  if (i == 2) { alb = uBrand; rough = .3; f0 = .055; }
  if (i == 3) { alb = mix(por, uBrand, uDark > .5 ? .2 : .12); }
  if (i == 4) { alb = mix(por, uBrand, .35); }
}

vec3 nrm(int i, vec3 p, float e){
  vec2 k = vec2(1, -1);
  return normalize(k.xyy * obj(i, p + k.xyy * e) + k.yyx * obj(i, p + k.yyx * e) +
                   k.yxy * obj(i, p + k.yxy * e) + k.xxx * obj(i, p + k.xxx * e));
}

// a studio soft-box seen in reflection: a rounded rectangle (superellipse) with a soft edge
float softbox(vec3 r, vec3 k, vec3 u, vec3 v, vec2 sz, float sharp){
  float dk = dot(r, k);
  if (dk <= 0.) return 0.;
  vec2 q = vec2(dot(r, u), dot(r, v)) / (dk * sz);
  q *= q;
  return smoothstep(0., .35, dk) / (1. + pow(dot(q, q), sharp * .25));
}

vec3 env(vec3 r, float rough){
  vec3 c = mix(Bnc + Floor, Sky, smoothstep(-.7, .9, r.y));
  c += Kc * 3. * softbox(r, L, KU, KV, vec2(.9, .45), mix(9., 2.5, rough)) * (1. - rough * .5);
  return c;
}

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float fogAmt(float t){ return 1. - exp(-max(t - 10.5, 0.) * .11); }

vec3 tmap(vec3 c){
  vec3 k = vec3(.72);
  return mix(c, k + .28 * (1. - exp(-(c - k) / .28)), step(k, c));
}

#define FOCUS 10.5
float defocus(float t){ return t < FOCUS ? smoothstep(.5, 4., FOCUS - t) : smoothstep(0., 10., t - FOCUS); }

vec3 surf(int i, vec3 p, vec3 rd, float t, vec3 air, float edge){
  // off the focal plane the normal is taken over a wider footprint: soft, defocused shading
  float df = defocus(t), fa = fogAmt(t);
  vec3 n = nrm(i, p, max(.0015, t * pix * .6) + .07 * uS * df);
  // the soft edge band carries the body colour, not a bright grazing ring
  n = normalize(n - rd * edge * (.35 + .45 * df));
  vec3 alb; float rough, f0;
  mat(i, alb, rough, f0);
  float ndl = dot(n, L);
  // a big soft-box: wide, soft terminator
  float key = pow(clamp((ndl + .25) / 1.25, 0., 1.), 1.6);

  // soft shadows from the other forms: one SDF tap where the light ray passes each one
  float sh = 1.;
  for (int j = 0; j < N; j++) {
    if (j == i) continue;
    vec3 c = uObj[j].xyz;
    float tj = dot(c - p, L);
    if (tj <= 0.) continue;
    vec3 q = p + L * tj;
    float pen = .1 + .2 * tj;
    if (length(q - c) > uObj[j].w + pen) continue;
    sh *= mix(1., smoothstep(-pen, pen, obj(j, q)), .45);
  }
  float ao = 1.;
  if (i == 2) {
    // self occlusion for the form with a hole
    float o = 0., w = 1.;
    for (int k = 1; k <= 4; k++) {
      float h = .05 * float(k * k) * uS;
      o += (h - obj(i, p + n * h)) * w;
      w *= .55;
    }
    ao = clamp(1. - o * 2.2 / uS, 0., 1.);
    if (ndl > .05) {
      // the ring shading its own hole: a short soft-shadow march, lit faces only
      // five taps at fixed distances along the light: continuous in p, so it cannot band
      float res = 1.;
      for (int k = 1; k <= 5; k++) {
        float st = (.02 + .045 * float(k * k)) * uS;
        res = min(res, 3. * obj(i, p + L * st) / st);
      }
      sh *= mix(1., mix(.25, 1., smoothstep(0., 1., res)), smoothstep(.05, .5, ndl));
    }
  }
  // analytic occlusion + colour bleed from the neighbours (sphere proxies)
  vec3 bleed = vec3(0);
  for (int j = 0; j < N; j++) {
    if (j == i) continue;
    vec3 v = uObj[j].xyz - p;
    float l2 = dot(v, v);
    float r = uObj[j].w * .75;
    float occ = clamp(dot(n, v) * inversesqrt(l2), 0., 1.) * r * r / l2;
    ao *= 1. - occ * .7;
    vec3 aj; float rj, fj;
    mat(j, aj, rj, fj);
    bleed += aj * occ * (Sky + Kc * .4) * 1.4;
  }
  float lit = key * sh;
  // shadows deepen and saturate instead of greying: the brand ramp, not black
  vec3 albS = mix(pow(alb, vec3(1.45)), alb, lit);
  float bounce = pow(clamp((dot(n, B) + .25) / 1.25, 0., 1.), 1.5);
  vec3 col = alb * Kc * lit + albS * ((Sky * (.5 + .5 * n.y) + Bnc * bounce + Floor) * ao + bleed);
  float sat = (max(alb.r, max(alb.g, alb.b)) - min(alb.r, min(alb.g, alb.b))) / max(max(alb.r, max(alb.g, alb.b)), .01);
  float tz = (ndl - .02) / .2;
  col += alb * alb * exp(-tz * tz) * Kc * .35 * sat * sh;
  // grazing terms are held at their value just inside the silhouette, so the edge pixel
  // continues the surface instead of drawing a bright (or dark) outline
  float ndv = max(dot(n, -rd), .25);
  float fre = f0 + (1. - f0) * pow(1. - ndv, 5.) * (1. - rough) * .5;
  // specular occlusion; haze and defocus take the highlights first
  col += env(reflect(rd, n), rough) * fre * ao * ao * mix(.4, 1., sh) * (1. - fa) * (1. - .4 * df);
  col += Rim * pow(1. - ndv, 3.) * 1.8 * clamp(dot(n, RS) + .1, 0., 1.) * ao * (1. - .6 * df);
  col = tmap(col);
  return mix(col, air, fa); // aerial perspective melts into the backdrop behind it, halo included
}

vec3 backdrop(vec2 u, vec3 ro, vec3 rd){
  vec3 c = uCanvas;
  float asp = uRes.x / uRes.y;
  // a pool of key light upper-left (behind the text), the hero's hue bleeding into the air
  float pool = exp(-dot((u - vec2(.18, 1.05)) * vec2(asp, 1.), (u - vec2(.18, 1.05)) * vec2(asp, 1.)) * .9);
  c = mix(c, mix(c, vec3(1), .5), pool * (1. - uDark) * .25);
  vec3 cen = uObj[2].xyz;
  vec3 p = ro + rd * ((cen.z - ro.z) / rd.z);
  float g = exp(-pow(length(p.xy - cen.xy) / (uObj[2].w * 1.7), 2.));
  c += uBrand * g * mix(.05, .08, uDark);
  // contact-free drop shadow onto the page, wide and almost not there
  float shd = 0.;
  vec3 off = vec3(.36, -.46, 0) * uS;
  for (int i = 0; i < N; i++) {
    vec3 ce = uObj[i].xyz;
    float tt = (ce.z - ro.z) / rd.z;
    vec3 q = ro + rd * tt - off;
    float blur = .6 * uS;
    if (length(q - ce) > uObj[i].w + blur) continue;
    shd = max(shd, (1. - smoothstep(-blur, blur, obj(i, q))) * (1. - fogAmt(tt)));
  }
  // light: the shadow takes the ink's hue (navy, not grey); dark: it simply deepens
  vec3 inkHue = uInk / max(max(uInk.r, uInk.g), max(uInk.b, .001));
  vec3 sc = uDark > .5 ? c * .55 : c * mix(vec3(1), inkHue, .45) * .9;
  c = mix(c, sc, shd * .42);
  return c;
}

float calm(vec2 u){
  float asp = uRes.x / uRes.y, y = 1. - u.y;
  float land = (1. - smoothstep(uCalmX.x, uCalmX.y, u.x)) * (1. - .55 * smoothstep(.45, .95, y));
  // portrait: text runs the full width and scrolls over everything, so the middle stays calm
  // and the forms live in the corners and side margins
  float mid = smoothstep(.04, .26, u.x) * (1. - smoothstep(.66, .9, u.x));
  float port = max(1. - smoothstep(.40, .74, y), .78 * mid);
  // a measured text box (a centred block, say) is held calm wherever it sits
  return max(mix(port, land, smoothstep(.8, 1.2, asp)), calmBox(vec2(u.x, y), uCalm, uCalmF)) * .9;
}

void main(){
  vec2 fc = gl_FragCoord.xy, u = fc / uRes;
  vec2 uv = (fc - .5 * uRes) / uRes.y;
  pix = 2. * uTanH / uRes.y;
  vec3 ro = uCam, rd = normalize(vec3(uv * 2. * uTanH, -1.));
  L = normalize(vec3(-.55, .72, .45));
  KU = normalize(cross(L, vec3(0, 1, 0))); KV = cross(KU, L);
  RS = normalize(vec3(.95, .15, -.25));
  B = normalize(vec3(.35, -.8, .45));
  if (uDark > .5) {
    Kc = vec3(.85, .9, 1.) * 1.5;
    Sky = uCanvas * 1.2 + uBrand * .006;
    Bnc = uBrand * .06;
    Floor = uCanvas * .3;
    Rim = mix(uBrand, vec3(1), .3) * 1.3;
  } else {
    Kc = vec3(1., .955, .9) * 1.1;
    Sky = mix(uCanvas, vec3(1), .25) * .42;
    Bnc = mix(uCanvas, uBrand, .2) * .3;
    Floor = uCanvas * .08;
    Rim = vec3(.9, .93, 1.) * .35;
  }
  vec3 bg = backdrop(u, ro, rd);

  float tHit = 1e9, nmC = 0., nmT = 0.;
  int id = -1, nmId = -1, budget = uSteps;
  for (int i = 0; i < N; i++) {
    vec3 oc = ro - uObj[i].xyz;
    // bound inflated by the soft-edge band so near misses still get their coverage
    float b = dot(oc, rd), r = uObj[i].w + pix * length(oc) * 7.;
    float h = b * b - dot(oc, oc) + r * r;
    if (h <= 0.) continue;
    h = sqrt(h);
    float t = max(-b - h, 0.), t1 = -b + h;
    if (t >= tHit) continue;
    float dm = 1e9, tm = t, pd = 1e9;
    bool hit = false;
    for (int s = 0; s < 64; s++) {
      if (budget <= 0) break;
      budget--;
      float d = obj(i, ro + rd * t), e = pix * t;
      if (d < .3 * e) { hit = true; break; }
      // closest approach between this sample and the last one, not just at the samples
      float y = d < pd ? d * d / (2. * pd) : 0., a = sqrt(d * d - y * y);
      float q = a / (pix * max(t - y, .1));
      if (q < dm) { dm = q; tm = t - y; }
      pd = d;
      t += d;
      if (t > t1) break;
    }
    if (hit) { if (t < tHit) { tHit = t; id = i; } }
    else {
      float c = clamp(1. - dm / (1.25 + 4.5 * defocus(tm)), 0., 1.); // wider edge off the focal plane: depth of field
      // forms are indexed front to back: the first soft edge found is the one in front
      if (c > .02 && nmId < 0) { nmC = c; nmT = tm; nmId = i; }
    }
  }
  vec3 col = bg;
  if (id >= 0) col = surf(id, ro + rd * tHit, rd, tHit, bg, 0.);
  if (nmId >= 0 && nmT < tHit) col = mix(col, surf(nmId, ro + rd * nmT, rd, nmT, bg, 1.), nmC);
  col = mix(col, bg, calm(u));
  col = pow(max(col, 0.), vec3(1. / 2.2));
  col += (hash(fc) - .5) / 255.;
  fragColor = vec4(col, 1);
}`

type Obj = { L: number[]; P: number[]; d: number; b: number; r: number[]; ra: number[]; rp: number[]; fa: number[]; fp: number[] }

/** The composition: anchors in NDC for landscape [L] and portrait [P], depth d, bound b. Front to back. */
const OBJ: Obj[] = [
  // rounded cube (porcelain): foreground, out of focus, cropped by the bottom edge
  { L: [0.4, -1.0], P: [-0.92, -1.0], d: 7.5, b: 1.03, r: [0.42, 0.95, 0.1], ra: [0.1, 0.16, 0.08], rp: [41, 53, 47], fa: [0.04, 0.09], fp: [38, 29] },
  // jewel sphere (accent): just in front of the hero's rim
  { L: [0.585, 0.03], P: [0.8, -0.33], d: 8.6, b: 0.35, r: [0, 0, 0], ra: [0, 0, 0], rp: [1, 1, 1], fa: [0.06, 0.1], fp: [23, 21] },
  // hero torus (brand): the focal point, low in the right gutter
  { L: [0.757, -0.31], P: [1.0, -0.66], d: 10.5, b: 1.27, r: [0.95, 0.25, -0.62], ra: [0.09, 0.14, 0.07], rp: [31, 43, 37], fa: [0.05, 0.11], fp: [34, 26] },
  // capsule (frosted lavender): upper gutter, facing the key
  { L: [0.66, 0.43], P: [-1.0, -0.18], d: 12, b: 0.95, r: [0.2, 0.1, -0.72], ra: [0.12, 0.1, 0.1], rp: [36, 47, 29], fa: [0.05, 0.12], fp: [27, 33] },
  // far small sphere
  { L: [0.97, 0.06], P: [0.92, 0.12], d: 19, b: 0.31, r: [0, 0, 0], ra: [0, 0, 0], rp: [1, 1, 1], fa: [0.05, 0.12], fp: [26, 35] },
  // a large far sphere that almost entirely melts into the page
  { L: [0.87, 0.62], P: [0.75, 0.72], d: 30, b: 2.01, r: [0, 0, 0], ra: [0, 0, 0], rp: [1, 1, 1], fa: [0.08, 0.14], fp: [40, 31] },
]

const TAU = Math.PI * 2
const TANH = Math.tan((30 / 2) * (Math.PI / 180))
const objArr = new Float32Array(24)
const rotArr = new Float32Array(54)

/**
 * Where each form is at time t. `shift` moves the landscape cluster sideways, in screen
 * widths, for a page whose right side is taken by something opaque — the sign-in form — so
 * the subject stands in the gap instead of behind the card.
 */
function layout(gl: WebGL2RenderingContext, u: Uniforms, t: number, asp: number, shift: number) {
  const k = Math.min(1, Math.max(0, (asp - 0.8) / 0.5))
  const kk = k * k * (3 - 2 * k)
  const S = Math.min(1, Math.max(0.62, asp / 1.3))
  gl.uniform1f(u.uS, S)
  OBJ.forEach((o, i) => {
    const sx = o.P[0] + (o.L[0] - o.P[0]) * kk + 2 * shift * kk
    const sy = o.P[1] + (o.L[1] - o.P[1]) * kk
    objArr[i * 4] = sx * o.d * TANH * asp + o.fa[0] * Math.sin((TAU * t) / (o.fp[0] * 1.3) + i * 1.7)
    objArr[i * 4 + 1] = sy * o.d * TANH + o.fa[1] * Math.sin((TAU * t) / o.fp[1] + i * 2.3)
    objArr[i * 4 + 2] = -o.d
    objArr[i * 4 + 3] = o.b * S
    const a = o.r.map((v, j) => v + o.ra[j] * Math.sin((TAU * t) / o.rp[j] + i + j))
    const [cx, sx_, cy, sy_, cz, sz] = [Math.cos(a[0]), Math.sin(a[0]), Math.cos(a[1]), Math.sin(a[1]), Math.cos(a[2]), Math.sin(a[2])]
    // R = Rz * Ry * Rx, column-major
    rotArr.set([cz * cy, sz * cy, -sy_, cz * sy_ * sx_ - sz * cx, sz * sy_ * sx_ + cz * cx, cy * sx_, cz * sy_ * cx + sz * sx_, sz * sy_ * cx - cz * sx_, cy * cx], i * 9)
  })
  gl.uniform4fv(u.uObj, objArr)
  gl.uniformMatrix3fv(u.uRot, false, rotArr)
}

/** The landscape cluster's shift and calm boundary for the measured layout. */
function compose(f: Frame) {
  const text = f.calm.text
  if (f.calm.phone || !text) return { shift: 0, calm: [0.5, 0.74] }
  // The prototype's boundary (0.5 to 0.74) assumed text ending near 0.62 of the width.
  const a = Math.min(0.62, Math.max(0.3, text[2] - 0.12))
  // Slide left when the stage ends short of the right edge, but never so far that the hero's
  // rim (0.74 of the width unshifted) crosses into the text.
  const want = Math.min(0, (f.calm.stage[1] - 1) * 0.9)
  const shift = Math.max(want, text[2] + 0.02 - 0.74, -0.35)
  return { shift: Math.min(0, shift), calm: [a, a + 0.24] }
}

const LOOK: LookSpec = {
  name: 'sculpture',
  frag: FS,
  uniforms: ['uRes', 'uCanvas', 'uBrand', 'uAccent', 'uInk', 'uCam', 'uDark', 'uS', 'uTanH', 'uSteps', 'uObj', 'uRot', 'uCalmX', 'uCalm', 'uCalmF'],
  tiers: [
    { scale: 0.6, steps: 64 },
    { scale: 0.5, steps: 56 },
    { scale: 0.42, steps: 48 },
    { scale: 0.35, steps: 40 },
    { scale: 0.35, steps: 40, fps: 20 },
    { scale: 0.35, steps: 40, fps: 15 },
  ],
  startTier: () => 1,
  pixelBudget: 900_000,
  minScale: 0.42,
  devicePixels: true,
  // The composed pose: the jewel overlapping the hero's rim, nothing edge-on.
  stillTime: 9,
  ease: 410,
  draw(gl, u, f) {
    const p = f.palette
    const { shift, calm } = compose(f)
    gl.uniform2f(u.uRes, f.w, f.h)
    gl.uniform3fv(u.uCanvas, linear(p.canvas))
    gl.uniform3fv(u.uBrand, linear(p.brand))
    gl.uniform3fv(u.uAccent, linear(p.accent))
    gl.uniform3fv(u.uInk, linear(p.ink900))
    gl.uniform1f(u.uDark, p.dark ? 1 : 0)
    gl.uniform1f(u.uTanH, TANH)
    gl.uniform1i(u.uSteps, f.tier.steps)
    gl.uniform3f(u.uCam, f.ptr[0] * 0.175, -f.ptr[1] * 0.11, 0)
    gl.uniform2f(u.uCalmX, calm[0], calm[1])
    // In the app, the landscape boundary already describes the main column. A page without the
    // app's chrome holds its measured text calm as well: on sign-in the cluster slides into the
    // gap and its foreground cube reaches the foot of the story, where the boundary is weakest;
    // on a phone the portrait composition counts on a header to cover its corner. A block that
    // stays put, like the missing-page message, is held calm wherever it is.
    const box = f.calm.text
    const own = box && (f.calm.bare || (!f.calm.phone && box[1] > 0.02 && box[3] < 0.98))
    if (own) {
      gl.uniform4f(u.uCalm, box[0], box[1], box[2], box[3])
      gl.uniform4f(u.uCalmF, 0.06, 0.06, 0.06, 0.06)
    } else {
      gl.uniform4f(u.uCalm, 2, 2, 2, 2)
      gl.uniform4f(u.uCalmF, 0.01, 0.01, 0.01, 0.01)
    }
    layout(gl, u, f.t, f.cssW / f.cssH, shift)
  },
}

export const create = (canvas: HTMLCanvasElement, opts: EngineOptions) => start(canvas, LOOK, opts)
