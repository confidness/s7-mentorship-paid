import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  backdropFragment, backdropVertex, galaxyVertex, gridFragment, gridVertex, haloFragment, markFragment, markVertex, motesVertex, particleFragment, ringFragment, ringVertex,
} from './orbitShaders'
import { galaxy, glowTexture, motes, SCurve, stars, type Cloud, type Palette } from './orbitGeometry'

/**
 * The world the `orbit` skin is set in — the heavy half of the pair.
 *
 * `OrbitSceneGate.tsx` is the light half and the only thing that should import this file:
 * `three` and the renderer are several hundred kilobytes, and the skins without a scene never
 * need them.
 *
 * What is in it, back to front: a nebula sky, a field of distant stars, a turning spiral
 * galaxy, a circuit-board floor that pulses outwards from the centre, and in the middle the S7
 * mark itself — the same two 270° arcs as `Mark.tsx`, drawn as a lit tube with energy running
 * along it — inside three orbits, each carrying a satellite.
 *
 * The camera has one vantage per section of the app. Moving between sections glides it to
 * the next, so the navigation is felt in the room as well as seen in the menu.
 *
 * No post-processing. Glow is done with additive shells and sprites, which costs a fraction of
 * a bloom pass — this sits behind every page, under frosted glass, and has to stay cheap.
 */

/** Sign-in, the public front door, or a page inside the app. */
export type SceneMode = 'hero' | 'front' | 'app'

export interface OrbitSceneProps {
  theme: 'light' | 'dark'
  mode: SceneMode
  /** Index into the five sections; picks the camera's vantage. */
  station: number
  /** A composed still frame: reduced motion, or a tab nobody is looking at. */
  still: boolean
  lowPower: boolean
  /** Called once the first frame is on screen, so the gate can fade the world in rather than pop it. */
  onReady?: () => void
  /** Where a page has left room for the mark, in page pixels; the front door's, when upright. */
  stage?: StageBox | null
}

/** A band of the page, measured from the top of the document, that the mark should stand in. */
export interface StageBox {
  top: number
  height: number
}

/** Brand blue #1560ec at the centre of both, with violet and cyan either side of it. */
const DARK: Palette = {
  dark: true,
  top: '#0a0f2a',
  bottom: '#020309',
  nebulaA: '#1560ec',
  nebulaB: '#6a3dff',
  nebulaC: '#00c2ff',
  core: '#e9f1ff',
  arm: '#3d7bff',
  rim: '#7b4dff',
  markA: '#2f7bff',
  markB: '#8a5bff',
  pulse: '#7fe7ff',
  ring: '#79a8ff',
  grid: '#2f6bff',
}

const LIGHT: Palette = {
  dark: false,
  top: '#f5f7ff',
  bottom: '#dce4f9',
  nebulaA: '#8fb1ff',
  nebulaB: '#c4b2ff',
  nebulaC: '#9fe3ff',
  core: '#1560ec',
  arm: '#2a62f0',
  rim: '#6a3dff',
  markA: '#1560ec',
  markB: '#6a3dff',
  pulse: '#00b7ff',
  ring: '#2a62f0',
  grid: '#1560ec',
}

type Vec3 = [number, number, number]
interface Pose {
  pos: Vec3
  look: Vec3
}

/** Sign-in: the mark sits right of centre, beside the form rather than behind the headline. */
const HERO: Pose = { pos: [-1.9, 0.5, 9.2], look: [-1.9, 0.1, 0] }
const HERO_NARROW: Pose = { pos: [0, 0.4, 10], look: [0, 0.2, 0] }

/**
 * The front door, wide: the mark stands to the right of the headline, which runs a little over
 * half way across. Upright, the words take the whole width and no fixed pose clears them — the
 * hero is a line taller in Kazakh, and a small phone ends it lower down — so there the camera is
 * aimed at the stage the page leaves under its buttons (`OrbitStage`), measured. Without one it
 * falls back to the sign-in framing.
 */
const FRONT: Pose = { pos: [-4.3, -0.4, 13], look: [-4.3, -0.75, 0] }

/** The mark's size in world units, glow left out: two arcs of radius 1 drawn as a 0.2 tube. */
const MARK_W = 4.6
const MARK_H = 2.4

/** One vantage per section, in menu order. */
const STATIONS: Pose[] = [
  { pos: [0, 0.6, 10.5], look: [0, -0.2, 0] },
  { pos: [-6.2, 2.2, 7.8], look: [0.6, -0.4, 0] },
  { pos: [6.4, -0.6, 7.6], look: [-0.8, 0.3, 0] },
  { pos: [0.8, 5.4, 7.2], look: [0, -0.8, 0] },
  { pos: [-3.4, -1.6, 8.6], look: [0.4, 0.6, 0] },
]

interface Shared {
  uTime: { value: number }
  uIntensity: { value: number }
  uDark: { value: number }
  uPixelRatio: { value: number }
}

/* ------------------------------------------------------------------ pieces */

function Backdrop({ palette, shared, lowPower }: { palette: Palette; shared: Shared; lowPower: boolean }) {
  const uniforms = useMemo(
    () => ({
      uTime: shared.uTime,
      uIntensity: shared.uIntensity,
      uDark: shared.uDark,
      uAspect: { value: 1 },
      uShift: { value: new THREE.Vector2() },
      uTop: { value: new THREE.Color(palette.top) },
      uBottom: { value: new THREE.Color(palette.bottom) },
      uA: { value: new THREE.Color(palette.nebulaA) },
      uB: { value: new THREE.Color(palette.nebulaB) },
      uC: { value: new THREE.Color(palette.nebulaC) },
    }),
    [palette, shared],
  )

  useFrame(({ camera, size }) => {
    uniforms.uAspect.value = size.width / size.height
    // The sky drifts a little with the camera, which is what sells it as far away.
    uniforms.uShift.value.set(camera.position.x * 0.018, camera.position.y * 0.018)
  })

  return (
    <mesh frustumCulled={false} renderOrder={-10}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial vertexShader={backdropVertex} fragmentShader={backdropFragment} uniforms={uniforms} defines={{ OCTAVES: lowPower ? 3 : 5 }} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

function Particles({ data, vertex, shared, size, spin = 0, fade = 0, blending, ...rest }: { data: Cloud; vertex: string; shared: Shared; size: number; spin?: number; fade?: number; blending: THREE.Blending } & JSX.IntrinsicElements['points']) {
  const uniforms = useMemo(
    () => ({ ...shared, uSize: { value: size }, uSpin: { value: spin }, uFade: { value: fade } }),
    [shared, size, spin, fade],
  )
  return (
    <points frustumCulled={false} {...rest}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.position, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[data.color, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.size, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[data.phase, 1]} />
      </bufferGeometry>
      <shaderMaterial vertexShader={vertex} fragmentShader={particleFragment} uniforms={uniforms} transparent depthWrite={false} blending={blending} />
    </points>
  )
}

function Floor({ palette, shared, blending }: { palette: Palette; shared: Shared; blending: THREE.Blending }) {
  const uniforms = useMemo(() => ({ ...shared, uColor: { value: new THREE.Color(palette.grid) } }), [palette, shared])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.2, 0]}>
      <planeGeometry args={[90, 90]} />
      <shaderMaterial vertexShader={gridVertex} fragmentShader={gridFragment} uniforms={uniforms} transparent depthWrite={false} blending={blending} />
    </mesh>
  )
}

function Emblem({ palette, shared, blending, glow, group }: { palette: Palette; shared: Shared; blending: THREE.Blending; glow: THREE.Texture; group: MutableRefObject<THREE.Group | null> }) {
  const curve = useMemo(() => new SCurve(), [])
  const start = useMemo(() => curve.getPoint(0), [curve])
  const end = useMemo(() => curve.getPoint(1), [curve])
  const core = useRef<THREE.Sprite>(null)

  const body = useMemo(
    () => ({
      ...shared,
      uFixed: { value: -1 },
      uA: { value: new THREE.Color(palette.markA) },
      uB: { value: new THREE.Color(palette.markB) },
      uPulse: { value: new THREE.Color(palette.pulse) },
    }),
    [palette, shared],
  )
  // The open ends of the tube get caps, and the caps take the colour of the end they close.
  const capStart = useMemo(() => ({ ...body, uFixed: { value: 0 } }), [body])
  const capEnd = useMemo(() => ({ ...body, uFixed: { value: 1 } }), [body])

  useFrame(() => {
    const sprite = core.current
    if (!sprite) return
    const t = shared.uTime.value
    sprite.scale.setScalar(2.4 + Math.sin(t * 1.5) * 0.18)
    ;(sprite.material as THREE.SpriteMaterial).opacity = (palette.dark ? 0.85 : 0.45) * shared.uIntensity.value
  })

  const halo = { vertexShader: markVertex, fragmentShader: haloFragment, side: THREE.BackSide, transparent: true, depthWrite: false, blending }

  return (
    <group ref={group}>
      <mesh>
        <tubeGeometry args={[curve, 360, 0.2, 40, false]} />
        <shaderMaterial vertexShader={markVertex} fragmentShader={markFragment} uniforms={body} />
      </mesh>
      <mesh position={start}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <shaderMaterial vertexShader={markVertex} fragmentShader={markFragment} uniforms={capStart} />
      </mesh>
      <mesh position={end}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <shaderMaterial vertexShader={markVertex} fragmentShader={markFragment} uniforms={capEnd} />
      </mesh>

      <mesh renderOrder={2}>
        <tubeGeometry args={[curve, 240, 0.55, 24, false]} />
        <shaderMaterial {...halo} uniforms={body} />
      </mesh>
      <mesh position={start} renderOrder={2}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <shaderMaterial {...halo} uniforms={capStart} />
      </mesh>
      <mesh position={end} renderOrder={2}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <shaderMaterial {...halo} uniforms={capEnd} />
      </mesh>

      {/* Where the two arcs meet: the one point both halves of the S pass through. */}
      <sprite ref={core} renderOrder={3}>
        <spriteMaterial map={glow} color={palette.pulse} transparent depthWrite={false} blending={blending} toneMapped={false} />
      </sprite>
    </group>
  )
}

interface Orbit {
  radius: number
  tilt: Vec3
  speed: number
  dashes: number
}

const ORBITS: Orbit[] = [
  { radius: 2.75, tilt: [1.25, 0.1, 0], speed: 0.42, dashes: 140 },
  { radius: 3.3, tilt: [0.35, 0.95, 0.2], speed: -0.3, dashes: 180 },
  { radius: 3.9, tilt: [-0.85, -0.45, 0.5], speed: 0.2, dashes: 220 },
]

function Orbits({ palette, shared, blending, glow }: { palette: Palette; shared: Shared; blending: THREE.Blending; glow: THREE.Texture }) {
  const spins = useRef<(THREE.Group | null)[]>([])
  const lights = useRef<(THREE.Sprite | null)[]>([])
  const uniforms = useMemo(
    () => ORBITS.map((orbit) => ({ ...shared, uDashes: { value: orbit.dashes }, uDir: { value: Math.sign(orbit.speed) }, uColor: { value: new THREE.Color(palette.ring) } })),
    [palette, shared],
  )

  useFrame(() => {
    const t = shared.uTime.value
    ORBITS.forEach((orbit, i) => {
      const spin = spins.current[i]
      if (spin) spin.rotation.z = t * orbit.speed + i * 2.1
    })
    for (const light of lights.current) if (light) (light.material as THREE.SpriteMaterial).opacity = 0.9 * shared.uIntensity.value
  })

  return (
    <group>
      {ORBITS.map((orbit, i) => (
        <group key={i} rotation={orbit.tilt}>
          <group ref={(g) => void (spins.current[i] = g)}>
            <mesh>
              <torusGeometry args={[orbit.radius, 0.011, 6, 420]} />
              <shaderMaterial vertexShader={ringVertex} fragmentShader={ringFragment} uniforms={uniforms[i]} transparent depthWrite={false} blending={blending} />
            </mesh>
            <mesh position={[orbit.radius, 0, 0]}>
              <sphereGeometry args={[0.055, 16, 16]} />
              <meshBasicMaterial color={palette.pulse} toneMapped={false} />
            </mesh>
            <sprite ref={(s) => void (lights.current[i] = s)} position={[orbit.radius, 0, 0]} scale={0.7}>
              <spriteMaterial map={glow} color={palette.pulse} transparent depthWrite={false} blending={blending} toneMapped={false} />
            </sprite>
          </group>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ direction */

function Director({ mode, station, still, stage, shared, emblem }: { mode: SceneMode; station: number; still: boolean; stage: StageBox | null; shared: Shared; emblem: MutableRefObject<THREE.Group | null> }) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  const input = useRef({ x: 0, y: 0, sx: 0, sy: 0, scroll: 0 })
  const look = useRef(new THREE.Vector3(0, 0.6, 0))
  const goalPos = useMemo(() => new THREE.Vector3(), [])
  const goalLook = useMemo(() => new THREE.Vector3(), [])
  const aim = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    // Window listeners, not canvas events: the canvas is behind the page and takes no input.
    const onMove = (e: PointerEvent) => {
      input.current.x = (e.clientX / window.innerWidth) * 2 - 1
      input.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    const onScroll = () => {
      input.current.scroll = window.scrollY
      invalidate()
    }
    onScroll()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [invalidate])

  // A still scene renders on demand, so a change of section has to ask for its frame.
  useEffect(() => void invalidate(), [mode, station, still, stage, invalidate])

  useFrame(({ camera, size }, delta) => {
    const dt = Math.min(delta, 1 / 20)
    const inp = input.current
    // Still means a composed pose, not a slow one: every ease snaps straight to its goal.
    const ease = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate))
    if (!still) shared.uTime.value += dt
    shared.uPixelRatio.value = gl.getPixelRatio()

    const narrow = size.width < size.height
    const staged = mode === 'front' && narrow && stage ? stage : null
    // How far a pixel of the page reaches at the mark's distance, filled in when staged.
    let tilt = 0

    inp.sx += ((still || staged ? 0 : inp.x) - inp.sx) * ease(3)
    inp.sy += ((still || staged ? 0 : inp.y) - inp.sy) * ease(3)

    if (staged) {
      // Back off until the mark fits the stage's height and most of the screen's width, then
      // rise or drop, looking level, until the centre of the S is the centre of the stage as
      // the page first opens.
      const half = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))
      const fitHeight = (MARK_H * size.height) / (0.6 * staged.height * 2 * half)
      const fitWidth = (MARK_W * size.height) / (0.82 * size.width * 2 * half)
      const distance = Math.max(fitHeight, fitWidth, 8)
      const centre = 1 - (2 * (staged.top + staged.height / 2)) / size.height
      const y = -centre * distance * half
      goalPos.set(0, y, distance)
      goalLook.set(0, y, 0)
      tilt = (2 * distance * half) / size.height
    } else {
      // Upright with no stage measured, the front door takes the sign-in framing.
      const pose = mode === 'app' ? (STATIONS[station] ?? STATIONS[0]) : narrow ? HERO_NARROW : mode === 'front' ? FRONT : HERO
      goalLook.fromArray(pose.look)
      goalPos.fromArray(pose.pos)
      // A phone held upright sees a narrow slice; step back so the orbits still fit.
      if (narrow) goalPos.sub(goalLook).multiplyScalar(1.5).add(goalLook)

      goalPos.x += inp.sx * 0.7
      goalPos.y += inp.sy * 0.45

      // Scrolling a long page tilts the view down towards the floor.
      const s = Math.min(inp.scroll / 1400, 1)
      goalPos.y -= s * 1.4
      goalLook.y -= s * 2
    }

    camera.position.lerp(goalPos, ease(1.7))
    look.current.lerp(goalLook, ease(1.7))
    aim.copy(look.current)
    // Staged, the view tilts down with the scroll pixel for pixel, unlerped, so the mark moves
    // with its stage like part of the page; past the stage's foot it stops, the mark gone above.
    if (staged) aim.y -= Math.min(inp.scroll, staged.top + staged.height) * tilt
    camera.lookAt(aim)

    shared.uIntensity.value += ((mode === 'app' ? 0.6 : 1) - shared.uIntensity.value) * ease(1.2)

    const g = emblem.current
    if (g) {
      const t = shared.uTime.value
      // Enough turn to show it is solid, never so much that the S stops reading as an S.
      g.rotation.y = Math.sin(t * 0.22) * 0.4 + inp.sx * 0.25
      g.rotation.x = Math.sin(t * 0.17) * 0.16 - inp.sy * 0.12
      g.position.y = Math.sin(t * 0.65) * 0.12
    }
  })

  return null
}

/**
 * Says when the first frame has been drawn: useFrame runs just before a render, so the frame
 * after that one is the first with the world on screen. Until then the gate keeps the canvas
 * transparent, because an opaque canvas that has not drawn yet is a black rectangle.
 */
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false)
  useFrame(() => {
    if (done.current || !onReady) return
    done.current = true
    requestAnimationFrame(() => onReady())
  })
  return null
}

/* ------------------------------------------------------------------ assembly */

function World({ theme, mode, station, still, lowPower, onReady, stage = null }: OrbitSceneProps) {
  const palette = theme === 'dark' ? DARK : LIGHT
  const blending = palette.dark ? THREE.AdditiveBlending : THREE.NormalBlending
  // Time and intensity outlive a change of theme, so toggling it does not restart the world.
  const shared = useMemo<Shared>(() => ({ uTime: { value: 0 }, uIntensity: { value: 0 }, uDark: { value: 0 }, uPixelRatio: { value: 1 } }), [])
  shared.uDark.value = palette.dark ? 1 : 0

  const glow = useMemo(glowTexture, [])
  useEffect(() => () => glow.dispose(), [glow])

  const sky = useMemo(() => stars(lowPower ? 900 : 2200, palette), [palette, lowPower])
  const disc = useMemo(() => galaxy(lowPower ? 6000 : 14000, palette), [palette, lowPower])
  const dust = useMemo(() => motes(lowPower ? 160 : 420, palette), [palette, lowPower])
  const emblem = useRef<THREE.Group>(null)

  return (
    <>
      <Director mode={mode} station={station} still={still} stage={stage} shared={shared} emblem={emblem} />
      <FirstFrame onReady={onReady} />
      {/* Keyed by theme: blending modes and colours are baked into the materials. */}
      <group key={theme}>
        <Backdrop palette={palette} shared={shared} lowPower={lowPower} />
        <Particles data={sky} vertex={galaxyVertex} shared={shared} size={150} blending={blending} />
        <Particles data={disc} vertex={galaxyVertex} shared={shared} size={38} spin={0.08} blending={blending} position={[0, -1.4, -7]} rotation={[-1.12, 0, 0.3]} />
        <Floor palette={palette} shared={shared} blending={blending} />
        <Emblem palette={palette} shared={shared} blending={blending} glow={glow} group={emblem} />
        <Orbits palette={palette} shared={shared} blending={blending} glow={glow} />
        <Particles data={dust} vertex={motesVertex} shared={shared} size={42} fade={1} blending={blending} />
      </group>
    </>
  )
}

export default function OrbitScene(props: OrbitSceneProps) {
  return (
    <Canvas
      flat
      dpr={[1, props.lowPower ? 1.25 : 1.6]}
      camera={{ position: [0, 2.5, 22], fov: 40, near: 0.1, far: 200 }}
      gl={{ antialias: !props.lowPower, alpha: false, powerPreference: 'high-performance', stencil: false }}
      // Demand mode when still: the last frame stays on screen instead of an idle loop
      // redrawing the same picture sixty times a second.
      frameloop={props.still ? 'demand' : 'always'}
    >
      <World {...props} />
    </Canvas>
  )
}
