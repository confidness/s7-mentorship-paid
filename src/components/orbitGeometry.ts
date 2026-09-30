import * as THREE from 'three'

/**
 * The shapes the orbit scene is built from: seeded particle clouds, the S7 mark as a curve, and
 * the soft sprite every glow is drawn with. Pure construction, no rendering — OrbitScene.tsx
 * decides where they go and how they move.
 */

export interface Palette {
  dark: boolean
  top: string
  bottom: string
  nebulaA: string
  nebulaB: string
  nebulaC: string
  core: string
  arm: string
  rim: string
  markA: string
  markB: string
  pulse: string
  ring: string
  grid: string
}

/** Seeded, so the galaxy is the same galaxy on every visit and a still frame is composed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Cloud {
  position: Float32Array
  color: Float32Array
  size: Float32Array
  phase: Float32Array
}

function cloud(count: number, place: (i: number, rand: () => number, out: { p: THREE.Vector3; c: THREE.Color }) => number, seed: number): Cloud {
  const rand = rng(seed)
  const out = { p: new THREE.Vector3(), c: new THREE.Color() }
  const data: Cloud = { position: new Float32Array(count * 3), color: new Float32Array(count * 3), size: new Float32Array(count), phase: new Float32Array(count) }
  for (let i = 0; i < count; i++) {
    data.size[i] = place(i, rand, out)
    out.p.toArray(data.position, i * 3)
    out.c.toArray(data.color, i * 3)
    data.phase[i] = rand()
  }
  return data
}

export function galaxy(count: number, palette: Palette) {
  const core = new THREE.Color(palette.core)
  const arm = new THREE.Color(palette.arm)
  const rim = new THREE.Color(palette.rim)
  const R = 11
  return cloud(count, (i, rand, { p, c }) => {
    const r = Math.pow(rand(), 1.7) * R + 0.3
    const angle = ((i % 4) / 4) * Math.PI * 2 + r * 0.55
    const scatter = (s: number) => Math.pow(rand(), 2.6) * (rand() < 0.5 ? -1 : 1) * s * (0.25 + r * 0.12)
    p.set(Math.cos(angle) * r + scatter(1), scatter(0.35) * (1.25 - r / R), Math.sin(angle) * r + scatter(1))
    const f = r / R
    c.copy(core).lerp(arm, Math.min(f * 2.2, 1))
    if (f > 0.45) c.lerp(rim, (f - 0.45) / 0.55)
    return 0.4 + Math.pow(rand(), 3) * 2.2
  }, 7)
}

export function stars(count: number, palette: Palette) {
  const a = new THREE.Color(palette.core)
  const b = new THREE.Color(palette.rim)
  return cloud(count, (_, rand, { p, c }) => {
    const u = rand() * 2 - 1
    const th = rand() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    p.set(s * Math.cos(th), u, s * Math.sin(th)).multiplyScalar(35 + rand() * 35)
    c.copy(a).lerp(b, rand())
    return 0.6 + Math.pow(rand(), 4) * 2.5
  }, 11)
}

export function motes(count: number, palette: Palette) {
  const a = new THREE.Color(palette.pulse)
  const b = new THREE.Color(palette.arm)
  return cloud(count, (_, rand, { p, c }) => {
    const r = 1.2 + rand() * 5
    const th = rand() * Math.PI * 2
    p.set(Math.cos(th) * r, rand() * 8 - 4, Math.sin(th) * r - 1)
    c.copy(a).lerp(b, rand())
    return 0.5 + rand() * 1.2
  }, 23)
}

/** The mark's path: two 270° arcs of radius 1 whose centres are 2 apart, meeting at the origin. */
export class SCurve extends THREE.Curve<THREE.Vector3> {
  // Curve's own constructor is protected; a concrete curve has to open it.
  constructor() {
    super()
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    // A slight lift out of the plane, so it reads as a sculpted object as it turns.
    const z = Math.sin(t * Math.PI * 2) * 0.28
    if (t <= 0.5) {
      const th = Math.PI / 2 + (t / 0.5) * 1.5 * Math.PI
      return target.set(-1 + Math.cos(th), Math.sin(th), z)
    }
    const th = Math.PI - ((t - 0.5) / 0.5) * 1.5 * Math.PI
    return target.set(1 + Math.cos(th), Math.sin(th), z)
  }
}

export function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const g = canvas.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

