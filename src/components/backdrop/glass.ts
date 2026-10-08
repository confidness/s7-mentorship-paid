/**
 * Liquid glass: a few pearlescent drops in a seamless studio the colour of the page. A large
 * mass rises from the bottom-right corner, and a drop slowly draws a liquid bridge out of it
 * that thins, snaps and leaves a satellite droplet behind.
 *
 * Five metaballs joined by a cubic smooth-min, so a thinning neck never creases, lit by a
 * studio rather than a sky: an overhead scrim, a soft key, a strip light and a coloured rim.
 * Pearl under a light theme, obsidian under a dark one. Every period is 19 seconds or longer
 * and none divides another, so there is no loop to notice.
 */
import { CALM_GLSL, contrast, linear, start, readPalette, type EngineOptions, type Frame, type LookSpec, type Uniforms } from './core'

export { readPalette }

const FS = `#version 300 es
precision highp float;
uniform vec2 R;      // internal resolution
uniform vec3 uRo;    // camera position (pointer parallax)
uniform float uZ;    // tan(half fov)
uniform vec4 uB[5];  // blobs: xyz centre, w radius
uniform vec3 uCv, uBr, uAc; // linear palette
uniform float uDk;   // 0 light, 1 dark
uniform int uN;      // max raymarch steps
uniform float uT;    // time (film drift only)
uniform float uWb;   // surface wobble amplitude (0 on the lowest rung)
uniform vec4 uSc;    // scrim ellipse: centre.xy, radius.xy (0..1, top-left origin)
uniform float uScA;  // scrim strength
uniform vec4 uCalm, uCalmF; // and the measured text box, held calm as well
out vec4 O;
${CALM_GLSL}

const float WZ = -1.6;                        // the page, as a wall behind the blobs
const vec3 KD = vec3(-0.5, 0.6, 0.62);        // key softbox, top-left, in front
const vec3 RD = vec3(0.95, 0.1, -0.3);        // rim strip, right and behind
const vec3 FD = vec3(-0.85, -0.3, 0.45);      // coloured bounce card, low left
const vec3 LS = vec3(-0.12, 0.26, 0.96);      // shadow light, almost frontal: a halo just down-right of each blob

bool D;
vec3 brN, acN, pB, pA, fB;

vec3 hue(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float co = cos(a);
  return c*co + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - co);
}
float smin(float a, float b, float k){   // cubic: C2, so a thinning neck never creases
  float h = max(k - abs(a - b), 0.0)/k;
  return min(a, b) - h*h*h*k*(1.0/6.0);
}
float map(vec3 p){
  float d = length(p - uB[0].xyz) - uB[0].w;
  for (int i = 1; i < 5; i++){
    float r = uB[i].w;
    d = smin(d, length(p - uB[i].xyz) - r, i == 1 ? 1.0 : clamp(r*1.25, 0.2, 0.62));
  }
  // a slow, low swell on the surface so it reads as liquid rather than as spheres
  if (uWb > 0.0) d += uWb*sin(p.x*2.1 + uT*0.31)*sin(p.y*1.9 - uT*0.23)*sin(p.z*2.3 + uT*0.27);
  return d;
}
vec3 nor(vec3 p){
  const vec2 e = vec2(1.0, -1.0)*0.004;
  return normalize(e.xyy*map(p + e.xyy) + e.yyx*map(p + e.yyx) + e.yxy*map(p + e.yxy) + e.xxx*map(p + e.xxx));
}
// a soft-edged rounded softbox seen in direction d; brighter in its middle, like a real diffuser
float box(vec3 d, vec3 c, vec2 s, float soft){
  c = normalize(c);
  float z = dot(d, c);
  if (z <= 0.0) return 0.0;
  vec3 x = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  vec3 y = cross(c, x);
  vec2 q = vec2(dot(d, x), dot(d, y))/z;
  vec2 a = abs(q) - s;
  float sd = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0) - 0.5*min(s.x, s.y);
  return smoothstep(soft, -soft, sd)*(1.0 - 0.45*dot(q/s, q/s)*0.25);
}
// the studio: a seamless sweep in the page colour under a big overhead scrim (its reflection
// is a soft cap on every blob, its refraction a bright crescent low inside), a soft key lobe
// top-left, a thin strip front-left and a coloured rim strip behind-right. li scales the lights.
vec3 env(vec3 d, float li){
  float cap = smoothstep(0.38, 0.62, d.y);
  float k = max(dot(d, normalize(KD)), 0.0);
  float key = pow(k, 10.0), glint = pow(k, 220.0);
  float sL = box(d, vec3(-0.85, 0.15, 0.5), vec2(0.03, 1.0), 0.04);
  float sR = box(d, RD, vec2(0.045, 1.4), 0.06);
  vec3 c;
  if (D){
    c = mix(uCv*0.3 + brN*0.006, uCv*1.2, smoothstep(-0.6, 0.2, d.y));
    c += li*(0.35*cap*pB + 0.9*key*mix(vec3(1.0), pB, 0.4) + 6.0*glint + 2.4*sL + 3.4*pA*sR);
  } else {
    vec3 g = mix(pB, hue(pB, -0.7), smoothstep(-0.5, 0.6, d.x));   // the floor carries two neighbouring hues
    g = mix(g, mix(brN, vec3(1.0), 0.3), smoothstep(-0.3, -0.95, d.y)*0.55);
    c = mix(g, uCv, smoothstep(-0.55, 0.1, d.y));
    c = mix(c, vec3(1.0), cap);
    c += li*(0.3*cap + 0.6*key + 4.0*glint + 1.4*sL + 1.6*pA*sR);
  }
  return c;
}
vec3 film(vec3 p, float ndv){
  float ph = 1.3*(1.0 - ndv)
           + 0.45*sin(dot(p, vec3(1.6, 2.3, 0.9)) + uT*0.21)
           + 0.30*sin(dot(p, vec3(-2.7, 1.1, 1.8)) - uT*0.17);
  // the film stays a neighbour of the brand: sky <- brand -> magenta (no murky teal on dark glass)
  return hue(fB, clamp((ph - 0.8)*1.6, D ? -0.7 : -1.2, 1.2));
}
vec3 shoulder(vec3 x){
  return mix(x, 0.8 + 0.2*(1.0 - exp(-(x - 0.8)/0.2)), step(0.8, x));
}
vec3 shade(vec3 p, vec3 n, vec3 rd, float fz){
  float ndv = clamp(dot(n, -rd), 0.0, 1.0), g = 1.0 - ndv;
  float F = (0.05 + 0.95*g*g*g)*(1.0 - 0.7*fz);
  float irid = smoothstep(0.25, 0.8, g)*(1.0 - smoothstep(0.92, 1.0, g))*(1.0 - fz);
  vec3 f = film(p, ndv);
  // light focused through the body gathers just inside the rim opposite the key
  float cr = smoothstep(0.15, 0.85, dot(n.xy, vec2(0.6, -0.8)))*smoothstep(0.08, 0.3, ndv)*(1.0 - smoothstep(0.35, 0.75, ndv));
  float li = 1.0 - 0.85*fz;   // out of focus: no crisp highlights
  vec3 refl = env(reflect(rd, n), 3.0*li);
  vec3 rr = refract(rd, n, 0.72);
  vec3 tr = env(normalize(rr*2.0 - rd), li);
  vec3 c;
  if (D){
    // dark glass: deep brand absorption, lit from the edges
    vec3 body = tr*pow(max(mix(brN, acN, 0.3), vec3(0.03)), vec3(0.8 + 1.4*ndv)) + brN*0.012*(1.0 - n.y);
    c = body*(1.0 - F) + refl*F*mix(vec3(1.0), f*1.6, irid);
    c += f*irid*0.12;
    c += mix(pB, pA, 0.5)*0.22*cr;
  } else {
    // pearl glass: what is behind, bent and faintly tinted, under a white nacre
    vec3 body = tr*pow(mix(vec3(1.0), brN, 0.5), vec3(0.5 + 1.0*ndv));
    float side = smoothstep(-0.6, 0.9, -n.y*0.7 + n.x*0.5);
    vec3 pearl = mix(vec3(1.0), mix(pB, hue(pB, -0.7), 0.5 + 0.5*n.x), 0.15 + 0.45*side);
    body = mix(body, pearl, 0.5);
    c = mix(body, refl*mix(vec3(1.0), f*1.25, irid*0.8), F);
    c = mix(c, f, irid*0.25);
    c = mix(c, mix(vec3(1.0), hue(pA, -0.5), 0.35)*1.15, 0.6*cr);
  }
  // neighbour occlusion (analytic, from the sphere set) and per-blob depth haze
  float oc = 0.0, hz = 0.0, ws = 0.0;
  for (int i = 0; i < 5; i++){
    vec3 v = uB[i].xyz - p;
    float l = length(v);
    float r = max(uB[i].w, 0.0);
    oc += max(dot(n, v/l), 0.0)*r*r/(l*l);
    float w = exp(-10.0*max(l - uB[i].w, 0.0));
    hz += w*smoothstep(0.1, -1.4, uB[i].z);
    ws += w;
  }
  vec3 aoC = D ? mix(brN, vec3(1.0), 0.25)*0.45 : mix(brN, vec3(1.0), 0.6);
  c *= mix(vec3(1.0), aoC, clamp(oc*0.4, 0.0, 0.4));
  c = shoulder(c);
  // far blobs dissolve into the page (in the dark, into the faint brand glow around them)
  vec3 hzc = D ? uCv + mix(brN, acN, 0.3)*0.03 : uCv;
  return mix(c, hzc, 0.85*hz/ws);
}
vec3 wall(vec3 ro, vec3 rd){
  float t = (WZ - ro.z)/rd.z;
  vec3 p = ro + rd*t;
  vec3 ls = normalize(LS);
  float sh = 0.0, gl = 0.0;
  for (int i = 0; i < 5; i++){
    vec3 oc = uB[i].xyz - p;
    float r = max(uB[i].w, 0.0);
    float b = max(dot(oc, ls), 0.0);
    float d = length(oc - ls*b);
    float pen = 0.2*r + 0.35*b;
    float fade = smoothstep(-0.9, -0.2, uB[i].z);
    sh = max(sh, (1.0 - smoothstep(r - pen*0.5, r + pen*(D ? 1.6 : 1.0), d))*fade);
    gl += (1.0 - smoothstep(r*0.6, r*3.0, length(oc.xy)))*fade;
  }
  vec3 c = uCv;
  if (D){
    c += mix(brN, acN, 0.3)*0.03*min(gl, 1.5);
    c *= 1.0 - 0.6*sh;
  } else {
    c = mix(c, vec3(1.0), 0.45*min(gl, 1.0));
    c *= mix(vec3(1.0), mix(vec3(1.0), brN, 0.5)*0.9, 0.36*sh);
  }
  return c;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }

void main(){
  vec2 fc = gl_FragCoord.xy;
  D = uDk > 0.5;
  brN = uBr/max(max(uBr.r, uBr.g), max(uBr.b, 1e-3));
  vec3 a = uAc/max(max(uAc.r, uAc.g), max(uAc.b, 1e-3));
  float sat = max(max(a.r, a.g), a.b) - min(min(a.r, a.g), a.b);
  acN = mix(hue(brN, 0.9), a, smoothstep(0.15, 0.4, sat)); // neutral accent (ink) -> borrow a brand neighbour
  pB = mix(brN, vec3(1.0), D ? 0.15 : 0.55);
  pA = mix(acN, vec3(1.0), D ? 0.1 : 0.45);
  fB = mix(mix(brN, acN, 0.5), vec3(1.0), D ? 0.2 : 0.45);

  vec2 uv = (fc - 0.5*R)/R.y;
  vec3 ro = uRo;
  vec3 rd = normalize(vec3(uv*2.0*uZ, -1.0));
  vec3 col = wall(ro, rd);

  // bounding spheres: most pixels never march at all
  float tn = 1e9, tf = -1.0;
  for (int i = 0; i < 5; i++){
    vec3 oc = ro - uB[i].xyz;
    float rr = max(uB[i].w, 0.0)*1.15 + 0.1 + 0.5*smoothstep(-0.3, -1.2, uB[i].z);
    float b = dot(oc, rd);
    float h = b*b - dot(oc, oc) + rr*rr;
    if (h > 0.0){ h = sqrt(h); tn = min(tn, -b - h); tf = max(tf, -b + h); }
  }
  if (tf > 0.0){
    float px = 2.0*uZ/R.y;
    float t = max(tn, 0.0), md = 1e9, mt = t;
    bool hit = false;
    for (int i = 0; i < 64; i++){
      if (i >= uN) break;
      float d = map(ro + rd*t);
      if (d/t < md){ md = d/t; mt = t; }
      if (d < 0.3*px*t){ hit = true; break; }
      t += max(d, 0.5*px*t);   // never creep: grazing rays pass the tangent within budget
      if (t > tf) break;
    }
    vec3 p = ro + rd*(hit ? t : mt);
    // far blobs are out of focus: a wider, softer edge, inside and out (fake depth of field)
    float fz = 0.0, ws = 0.0;
    for (int i = 0; i < 5; i++){
      float w = exp(-10.0*max(length(p - uB[i].xyz) - uB[i].w, 0.0));
      fz += w*smoothstep(-0.3, -1.2, uB[i].z); ws += w;
    }
    fz /= max(ws, 1e-4);
    float blur = px + 0.045*fz;   // angular, so the defocus is the same at any DPR
    float cov = hit ? 1.0 : 0.5 - 0.5*smoothstep(0.0, blur, md);
    if (cov > 0.0){
      vec3 n = nor(p);
      // symmetric edge AA: a hit pixel near the silhouette is half-covered too. For a curved
      // edge of radius ~r the distance inside the silhouette is about r*ndv^2/2.
      float ndv = max(dot(n, -rd), 0.0);
      if (hit) cov = 0.5 + 0.5*smoothstep(0.0, blur*t, 0.25*ndv*ndv);
      col = mix(col, shade(p, n, rd, fz), cov);
    }
  }
  // scrim: calm where the text lives, and all the way back to the page inside measured text,
  // where a bright rim at a fifth of its strength is still enough to fail a line of it
  vec2 s = vec2(fc.x/R.x, 1.0 - fc.y/R.y);
  float m = (1.0 - smoothstep(0.0, 1.0, length((s - uSc.xy)/uSc.zw)))*uScA;
  col = mix(col, uCv, max(m, calmBox(s, uCalm, uCalmF)));
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0/2.2));
  col += (hash(fc) - 0.5)/255.0;
  O = vec4(col, 1.0);
}`

const TAU = Math.PI * 2
const S = Math.sin
const C = Math.cos
const blobs = new Float32Array(20)

/**
 * The composition at time t. `shift` slides the landscape cluster left, in screen widths,
 * when something opaque holds the right edge; `boost` strengthens the scrim when the skin's
 * secondary text has a thin margin on its own canvas.
 */
function scene(gl: WebGL2RenderingContext, u: Uniforms, t: number, asp: number, shift: number, boost: number) {
  const port = asp < 1
  const h = port ? 2.05 : 1.6
  const w = h * asp
  const k = 1
  const f = (p: number) => (TAU * t) / p // every period here is 19 s or longer
  const dx = port ? 0 : shift * 2 * w
  // A: a large mass entering from the bottom-right corner, mostly off-screen
  const A = [w + 0.25 * k + 0.06 * S(f(41)) + dx, -h + 0.38 * k + 0.06 * S(f(33) + 1.3), -0.1 + 0.1 * S(f(53)), 1.2 * k]
  // B drifts toward A along one axis and away again (~31 s). It never merges into a lump:
  // its wide blend draws a long, thinning filament across the gap, which snaps. E is the
  // satellite droplet a real liquid bridge leaves behind: hidden in the filament, born at the snap.
  const th = 2.0 + 0.1 * S(f(37) + 0.7)
  const open = 0.5 + 0.5 * S(f(31))
  const ux = C(th)
  const uy = S(th)
  const dd = (1.88 + 0.5 * open) * k
  const B = [A[0] + dd * ux, A[1] + dd * uy, 0.12 + 0.12 * S(f(43) + 2), 0.44 * k]
  const ge = 1.2 * k + (dd - 1.64 * k) * (0.5 + 0.08 * S(f(23)))
  const born = Math.min(1, Math.max(0, (open - 0.12) / 0.3))
  // unborn, E has a negative radius: no bead in the filament
  const E = [A[0] + ge * ux, A[1] + ge * uy, B[2] * 0.6, (-0.12 + 0.28 * born * born * (3 - 2 * born)) * k]
  // Cc: a small free drop low and left of the mass; now and then it drifts close enough to kiss
  const Cc = [w - 1.26 * k + 0.09 * S(f(47)) + dx, -h + 0.62 * k + 0.08 * S(f(39) + 1), 0.3 + 0.1 * S(f(51)), 0.2 * k]
  // Dd: far back and out of focus at the right edge, behind the cluster: depth, not detail
  const Dd = [w + 0.05 * k + 0.08 * S(f(59)) + dx, 0.25 + 0.15 * S(f(45)), -1.3, 0.65 * k]
  if (port) {
    // A phone shows canvas only above the first card and in the margins, and its paragraphs
    // run the full width. The same gesture is turned 90°: the mass sits in the top-right
    // corner, half behind the header, and the bridge runs left along the band under it.
    const s7 = 0.42
    for (const b of [A, B, E]) {
      const ox = b[0] - w
      const oy = b[1] + h
      b[0] = w - oy * s7 + 0.04
      b[1] = h + ox * s7 - 0.27
      b[3] *= s7
    }
    Cc[0] = w - 0.16
    Cc[1] = -h * 0.2 + 0.1 * S(f(39) + 1)
    Cc[3] = 0.12
    Dd[0] = -w * 0.6 + 0.1 * S(f(59))
    Dd[1] = -h + 0.5
    Dd[3] = 0.55
  }
  blobs.set([...A, ...B, ...Cc, ...Dd, ...E])
  gl.uniform4fv(u.uB, blobs)
  gl.uniform1f(u.uZ, h / 6)
  gl.uniform1f(u.uT, t)
  // the scrim follows the text: a top-left column on desktop, the top band on a phone
  if (port) {
    gl.uniform4f(u.uSc, 0.4, 0.27, 1.5, 0.12)
    gl.uniform1f(u.uScA, Math.min(0.95, 0.8 + boost))
  } else {
    gl.uniform4f(u.uSc, 0.3, 0.18, 0.55, 0.45)
    gl.uniform1f(u.uScA, Math.min(0.95, 0.65 + boost))
  }
}

function compose(f: Frame) {
  const text = f.calm.text
  if (f.calm.phone || !text) return 0
  // Slide left when the stage ends short of the right edge (the sign-in form), never into the text.
  return Math.min(0, Math.max((f.calm.stage[1] - 1) * 0.9, text[2] + 0.06 - 0.82, -0.35))
}

const LOOK: LookSpec = {
  name: 'glass',
  frag: FS,
  uniforms: ['R', 'uRo', 'uZ', 'uB', 'uCv', 'uBr', 'uAc', 'uDk', 'uN', 'uT', 'uWb', 'uSc', 'uScA', 'uCalm', 'uCalmF'],
  // Resolution as a fraction of device pixels (DPR capped at 2); the wobble goes on the last rungs.
  tiers: [
    { scale: 0.6, steps: 64, extra: 0.03 },
    { scale: 0.5, steps: 48, extra: 0.03 },
    { scale: 0.42, steps: 36, extra: 0.03 },
    { scale: 0.33, steps: 28, extra: 0 },
    { scale: 0.33, steps: 28, extra: 0, fps: 20 },
    { scale: 0.33, steps: 28, extra: 0, fps: 15 },
  ],
  startTier: (phone, coarse) => (phone || coarse ? 2 : 1),
  pixelBudget: 1_100_000,
  minScale: 0.45,
  devicePixels: true,
  // The bridge just broken, the satellite floating free, nothing touching.
  stillTime: 7.75,
  ease: 900,
  draw(gl, u, f) {
    const p = f.palette
    // The thinner the secondary text's margin on this canvas, the stronger the scrim.
    const boost = Math.min(1, Math.max(0, (6 - contrast(p.ink500, p.canvas)) / 1.5)) * 0.25
    gl.uniform2f(u.R, f.w, f.h)
    gl.uniform3fv(u.uCv, linear(p.canvas))
    gl.uniform3fv(u.uBr, linear(p.brand))
    gl.uniform3fv(u.uAc, linear(p.accent))
    gl.uniform1f(u.uDk, p.dark ? 1 : 0)
    gl.uniform1i(u.uN, f.tier.steps)
    gl.uniform1f(u.uWb, f.tier.extra ?? 0)
    gl.uniform3f(u.uRo, f.ptr[0] * 0.18, -f.ptr[1] * 0.12, 6)
    // On a phone the portrait composition counts on the app's header to cover its corner, so a
    // page without one holds all of its text calm instead.
    const box = f.calm.text
    if (box && (!f.calm.phone || f.calm.bare)) {
      gl.uniform4f(u.uCalm, box[0], box[1], box[2], box[3])
      gl.uniform4f(u.uCalmF, 0.05, 0.05, 0.12, 0.05)
    } else {
      gl.uniform4f(u.uCalm, 2, 2, 2, 2)
      gl.uniform4f(u.uCalmF, 0.01, 0.01, 0.01, 0.01)
    }
    scene(gl, u, f.t, f.cssW / f.cssH, compose(f), boost)
  },
}

export const create = (canvas: HTMLCanvasElement, opts: EngineOptions) => start(canvas, LOOK, opts)
