/**
 * Silk in depth: a back-lit sheet of shot silk, sweeping from a sculpted fold in the lower
 * right into a haze the colour of the page, pale and calm where the text lives.
 *
 * A heightfield raymarched at a grazing, telephoto angle, so near crests hide the folds
 * behind them and the far ones compress into bands before the haze takes them. All analytic
 * sines — no noise, no textures. The brand is the warp thread, seen face-on, and the accent
 * the weft, seen at grazing angles; a skin with one hue gets a weft a step round the wheel.
 *
 * Legibility is not left to the composition alone. Inside the calm zone every pixel is held
 * at 4.6:1 or better against `ink-500`, computed in the shader from the live ink and canvas,
 * as a smooth knee rather than a clip so the folds keep their modelling.
 */
import { CALM_GLSL, linear, start, readPalette, type EngineOptions, type LookSpec } from './core'

export { readPalette }

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;           // internal (reduced) resolution
uniform float uT;            // seconds
uniform vec2 uPtr;           // eased pointer, -1..1
uniform vec3 uCanvas, uBrand, uAccent, uInk;   // linear RGB
uniform float uDark;         // 1 when the canvas is dark (decided from its luminance, not the theme flag)
uniform int uSteps;          // march budget (adaptive quality)
uniform float uGrow;         // minimum step as a fraction of distance (adaptive quality: far rays stride faster)
uniform vec4 uCalm;          // text-safe box: left, top, right, bottom (0..1, top-left origin)
uniform vec4 uCalmF;         // how far each of its edges fades
uniform vec2 uBand;          // and the top band: calm until .x, gone by .y
out vec4 o;
#define FA -0.9              // fold axis vs. the view: folds sweep from the near right into the far left
#define WEFT 0.45            // one-hue skins: how far round the wheel the second thread sits
#define SHOT 0.12
#define FOGL 0.065
#define IRID 0.25
#define FREQ 1.9
#define AMP 0.34
const float A = 0.9;         // |height| bound: the march only runs between y = +-A
${CALM_GLSL}

// --- the cloth -------------------------------------------------------------------------------
// Long sinuous folds with soft creases and rounded crests (sqrt(s^2+e)), every other fold raised,
// on a slow billow. Calm and shallow on the left, sculpted on the right. All analytic sines.
float Hc(vec2 p, out float c){
  float t = uT;
  vec2 q = vec2(cos(FA)*p.x - sin(FA)*p.y, sin(FA)*p.x + cos(FA)*p.y);   // q.x along the folds
  float u = q.y + 0.55*sin(q.x*0.27 + t*0.10) + 0.22*sin(q.x*0.61 - t*0.15);
  u += 0.30*sin(u*0.5 + t*0.06);                                          // uneven spacing
  float s = sin(u*FREQ + t*0.22);
  float swell = smoothstep(-2.0, 4.5, p.x - 0.15*p.y);
  float big = 0.5 + 0.5*sin(u*FREQ*0.5 + 1.9 + t*0.11 + 0.075*q.x);
  float amp = AMP*(0.16 + 0.84*swell)*(0.5 + 0.85*big*big);
  c = sqrt(s*s + 0.04);                                                   // 0.2 in a crease, 1 on a crest
  float h = amp*c + 0.05*sin(u*FREQ*2.1 + q.x*0.4 - t*0.19)*swell;
  h += 0.1*exp(-0.04*dot(p - vec2(3.0, 5.0), p - vec2(3.0, 5.0)))*(0.8 + 0.2*sin(t*0.07));
  h += 0.14*sin(p.x*0.23 + p.y*0.11 + t*0.05);
  c = mix(1.0, c, clamp(amp*4.0, 0.0, 1.0));                              // shallow folds barely occlude
  return h - 0.25;
}
float H(vec2 p){ float c; return Hc(p, c); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// WCAG measures the sRGB-decoded pixel, while this frame is written out with gamma 2.2, and the
// two disagree most in the darks. The guard's thresholds are set in true luminance and carried
// into the shader's space, so a pixel at the limit really is 4.6:1 on screen.
float toTrue(float y){ float s = pow(max(y, 0.0), 1.0/2.2); return s <= 0.04045 ? s/12.92 : pow((s + 0.055)/1.055, 2.4); }
float fromTrue(float y){ y = max(y, 0.0); float s = y <= 0.0031308 ? y*12.92 : 1.055*pow(y, 1.0/2.4) - 0.055; return pow(s, 2.2); }
vec3 hueRot(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - ca); }

vec3 warp, weft; float same; // shot silk: two thread colours; same = 1 for one-hue skins
const vec3 L = vec3(0.276, 0.276, 0.921);                // low light hidden in the far haze (back light)
const vec3 LK = vec3(0.693, 0.600, -0.416);              // light-theme key, across the folds

// --- satin -----------------------------------------------------------------------------------
vec3 shade(vec3 p, vec3 rd, float t){
  float e = 0.01 + 0.003*t, cr;
  float h0 = Hc(p.xz, cr);
  vec3 n = normalize(vec3(h0 - H(p.xz + vec2(e, 0.0)), e, h0 - H(p.xz + vec2(0.0, e))));
  vec3 V = -rd;
  float nv = max(dot(n, V), 0.0);
  float nh = max(dot(n, normalize(L + V)), 0.0) * mix(0.94, 1.0, smoothstep(0.02, 0.3, nv));  // no glints on edge-on slivers
  float trans = smoothstep(0.0, 1.0, 1.0 - nv)*smoothstep(-0.2, 0.6, dot(V, -L) + 0.5);       // light through thin cloth at grazing
  float ao = smoothstep(0.18, 0.75, cr);
  float shot = smoothstep(0.1, 0.95, nv + SHOT + 0.25*sin(p.x*0.35 - p.z*0.12 + uT*0.03));            // warp face-on, weft at grazing
  vec3 tint = mix(weft, warp, shot), col;
  if (uDark < 0.5){
    // gradient-mapped: deep -> mid -> pearl, every stop on-palette, so shadow gains chroma instead of going grey.
    // Stops are placed by luminance, so a pale skin (lime, sky) gets the same depth as indigo.
    float kd = clamp((dot(n, LK) + 0.25)/1.25, 0.0, 1.0);
    float s = smoothstep(0.45, 1.0, clamp((0.18 + 0.82*kd)*mix(0.35, 1.0, ao) + 0.04 + 0.04*n.y, 0.0, 1.0));
    float Lc = lum(uCanvas), Lt = max(lum(tint), 1e-3);
    vec3 dt = mix(mix(tint, warp, 0.6), hueRot(tint, -0.25), same);          // shadows lean to the brand (or cooler, one-hue)
    vec3 deep = Lt > 0.27 ? dt*(0.27/Lt) : mix(dt, uCanvas, (0.27 - Lt)/(Lc - Lt));
    vec3 mid = mix(uCanvas, tint, clamp((Lc - 0.48)/(Lc - Lt), 0.0, 0.9));
    vec3 pearl = mix(vec3(1.0), mix(mix(weft, warp, 0.35), mix(hueRot(weft, 0.5), tint, 0.4), same), 0.22);
    col = s < 0.5 ? mix(deep, mid, s*2.0) : mix(mid, pearl, s*2.0 - 1.0);
    col = mix(col, mix(mix(weft, hueRot(weft, 0.6), same), vec3(1.0), 0.6), trans*trans*0.25);
    col += mix(vec3(1.0), pearl, 0.5)*pow(nh, 10.0)*0.06 + vec3(0.7)*pow(nh, 160.0);
    float ring = pow(nh, 22.0)*(1.0 - pow(nh, 120.0));                       // thin-film fringe around the glint
    col += max(mix(hueRot(weft, 1.1), hueRot(warp, -0.9), smoothstep(0.9, 1.0, nh)), 0.0)*ring*IRID;
  } else {
    // darkness first: the cloth is the canvas, and only the sheen carries colour
    float kn = clamp(0.18/max(lum(tint), 1e-3), 0.4, 2.0);
    col = (uCanvas*0.5 + tint*(0.0015 + 0.0015*n.y) + tint*trans*trans*0.012)*mix(0.35, 1.0, ao);
    col += warp*kn*pow(nh, 30.0)*0.17 + mix(weft*kn, vec3(1.0), 0.4)*(pow(nh, 90.0)*0.5 + pow(nh, 300.0)*0.25);
  }
  return mix(col, 0.82 + 0.18*(1.0 - exp(-(col - 0.82)/0.18)), step(0.82, col));   // shoulder above 0.82: white stays white
}
vec3 haze(vec3 c, float t){ return mix(c, uCanvas, 1.0 - exp(-max(t - 3.5, 0.0)*(uDark > 0.5 ? 0.09 : FOGL))); }

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5*uRes)/uRes.y;
  vec2 sp = vec2(fc.x/uRes.x, 1.0 - fc.y/uRes.y);
  same = 1.0 - clamp(length(normalize(uBrand + 1e-4) - normalize(uAccent + 1e-4))*4.0, 0.0, 1.0);
  warp = uBrand; weft = mix(uAccent, hueRot(uAccent, WEFT), same);   // one-hue skins get a weft a step round the wheel

  vec3 ro = vec3(uPtr.x*0.22, 1.55 - uPtr.y*0.07, 0.0);
  vec3 fw = normalize(vec3(0.10, -0.30, 1.0));
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 rd = normalize(fw*1.8 + uv.x*rt + uv.y*cross(fw, rt));

  // --- heightfield march, bracketed between y = +-A, with a crest-skim test for edge coverage ---
  bool hit = false; float t = 1e3, edge = 1e3, tE = 0.0;
  if (rd.y < -0.004){
    float t1 = min((ro.y + A)/(-rd.y), 48.0), lt, ld = 1e3, lld = 1e3;
    float k = 0.8/(abs(rd.y) + length(rd.xz)), px = 1.6/uRes.y;
    t = (ro.y - A)/(-rd.y); lt = t;
    for (int i = 0; i < 64; i++){
      if (i >= uSteps || t > t1) break;
      vec3 p = ro + rd*t;
      float d = p.y - H(p.xz);
      if (d < 0.0){ t = lt + (t - lt)*ld/(ld - d); hit = true; break; }
      if (d > ld && ld < lld && ld/(px*lt) < edge){ edge = ld/(px*lt); tE = lt; }   // passed just over a crest
      lld = ld; lt = t; ld = d;
      t += max(d*k, uGrow*t);
    }
    hit = hit || t < t1;
  }
  vec3 col = uCanvas;
  if (hit){
    col = haze(shade(ro + rd*t, rd, t), t);
    if (edge < 1.5) col = mix(haze(shade(ro + rd*tE, rd, tE), tE), col, smoothstep(0.0, 1.5, edge));  // analytic-ish AA on silhouettes
  }
  // a faint aurora where the hidden light sits, only toward the right
  float g = pow(max(dot(rd, L), 0.0), 15.0)*smoothstep(0.3, 0.9, sp.x)*(1.0 - (hit ? exp(-max(t - 3.5, 0.0)*0.09) : 0.0));
  col = mix(col, mix(warp, weft, 0.5 + 0.5*sin(uv.x*1.7 + 0.6*sin(uv.x*3.1 + uT*0.05) + uT*0.04)), (uDark > 0.5 ? 0.12 : 0.08)*g);

  // --- contrast guard: over the text zone, ink-500 keeps >= 4.6:1 on every pixel (smooth knee, keeps the modelling) ---
  float m = 1.0 - (1.0 - calmBox(sp, uCalm, uCalmF))*smoothstep(uBand.x, uBand.y, sp.y);
  float Lc = lum(uCanvas), Li = toTrue(lum(uInk)), Lp = lum(col);
  if (uDark < 0.5){
    float lo = fromTrue(4.6*(Li + 0.05) - 0.05), tg = Lp > lo + 0.2 ? Lp : lo + 0.2*exp((Lp - lo - 0.2)/0.2);
    vec3 lift = mix(uCanvas, vec3(1.0), 0.5);                        // lift toward pearl, not toward grey
    col = mix(col, lift, clamp((tg - Lp)/(lum(lift) - Lp + 1e-5), 0.0, 1.0)*m);
  } else {
    float hi = fromTrue((Li + 0.05)/4.6 - 0.05), tg = Lp < hi - 0.018 ? Lp : hi - 0.018*exp((hi - 0.018 - Lp)/0.018);
    col *= mix(1.0, min(tg/max(Lp, 1e-5), 1.0), m);                  // dim, keep the chroma
  }
  float nz = fract(sin(dot(fc, vec2(12.9898, 78.233)))*43758.5453) - 0.5;
  o = vec4(pow(max(col, 0.0), vec3(1.0/2.2)) + nz/255.0, 1.0);
}`

const LOOK: LookSpec = {
  name: 'silk',
  frag: FRAG,
  uniforms: ['uRes', 'uT', 'uPtr', 'uCanvas', 'uBrand', 'uAccent', 'uInk', 'uDark', 'uSteps', 'uGrow', 'uCalm', 'uCalmF', 'uBand'],
  // Internal scale in CSS pixels, not device pixels: the field is soft, and a retina screen
  // would only pay four times the fill rate for detail the haze takes away again.
  tiers: [
    { scale: 0.75, steps: 56, extra: 0.012 },
    { scale: 0.6, steps: 44, extra: 0.016 },
    { scale: 0.5, steps: 36, extra: 0.02 },
    { scale: 0.4, steps: 28, extra: 0.026 },
    { scale: 0.33, steps: 24, extra: 0.03 },
    { scale: 0.33, steps: 24, extra: 0.03, fps: 20 },
    { scale: 0.33, steps: 24, extra: 0.03, fps: 15 },
  ],
  startTier: (phone) => (phone ? 2 : 1),
  pixelBudget: 750_000,
  devicePixels: false,
  // t = 45 s is a hero frame; the softer, blobbier moments of the cycle are around 0–15 s.
  stillTime: 45,
  ease: 325,
  draw(gl, u, f) {
    const p = f.palette
    gl.uniform2f(u.uRes, f.w, f.h)
    gl.uniform1f(u.uT, f.t)
    gl.uniform2f(u.uPtr, f.ptr[0], f.ptr[1])
    gl.uniform3fv(u.uCanvas, linear(p.canvas))
    gl.uniform3fv(u.uBrand, linear(p.brand))
    gl.uniform3fv(u.uAccent, linear(p.accent))
    gl.uniform3fv(u.uInk, linear(p.ink500))
    gl.uniform1f(u.uDark, p.dark ? 1 : 0)
    gl.uniform1i(u.uSteps, f.tier.steps)
    gl.uniform1f(u.uGrow, f.tier.extra ?? 0.016)
    gl.uniform2f(u.uBand, 0.26, 0.52)
    const { phone, text } = f.calm
    if (phone) {
      // A phone's text runs the full width and scrolls over all of it: guard everything.
      gl.uniform4f(u.uCalm, -1, -1, 2, 2)
      gl.uniform4f(u.uCalmF, 0.01, 0.01, 0.01, 0.01)
    } else if (text) {
      gl.uniform4f(u.uCalm, text[0], text[1], text[2], text[3])
      gl.uniform4f(u.uCalmF, 0.06, 0.06, 0.15, 0.06)
    } else {
      // The prototype's own zone: the left column, full until 0.4 and gone by 0.7.
      gl.uniform4f(u.uCalm, -1, -1, 0.4, 2)
      gl.uniform4f(u.uCalmF, 0.01, 0.01, 0.3, 0.01)
    }
  },
}

export const create = (canvas: HTMLCanvasElement, opts: EngineOptions) => start(canvas, LOOK, opts)
