import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Float } from '@react-three/drei'

/**
 * The one 3D scene in the interface, and the only skin that gets it.
 *
 * Atelier's own copy already says "everything floats" — no borders, one huge soft shadow, a
 * canvas that goes true black at night. A shape that actually floats in three dimensions is
 * that sentence made literal, rather than a WebGL flourish bolted onto a skin that never
 * asked for one. This module is the heavy half of the pair — `AtelierSceneGate.tsx` is the
 * light one, and is what everything outside this file should ever import.
 *
 * Three primitives, not one. A single hero shape reads as a logo and invites scrutiny a
 * placeholder can't survive; three simple forms drifting at different depths and speeds read
 * as an idea about weightlessness instead of a specific thing that's supposed to mean
 * something.
 *
 * Matte, not shiny. Atelier's own shadow tokens are "wide, low, and almost not there" —
 * `--shadow-float` — a glossy PBR highlight would be the one hard edge in a skin defined by
 * their absence, so every material here is full roughness and zero metalness.
 */

const LIGHT = { ink: '#14161a', brand: '#1f6feb' }
const DARK = { ink: '#fafafa', brand: '#1f6feb' }

type Colors = typeof LIGHT

function Shapes({ colors, still }: { colors: Colors; still: boolean }) {
  // `still` mirrors LiquidMetalBackground's own `speed={0}` move: a frozen pose, not a blank
  // scene, for prefers-reduced-motion and for a backgrounded tab.
  const base = still ? { floatIntensity: 0, rotationIntensity: 0, speed: 0 } : { floatIntensity: 1.1, rotationIntensity: 0.55, speed: 1.4 }

  return (
    <>
      <Float {...base} position={[1.15, 0.35, 0]}>
        <mesh>
          <icosahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color={colors.ink} roughness={1} metalness={0} />
        </mesh>
      </Float>

      <Float {...base} speed={base.speed * 0.75} position={[-1.3, -0.45, -0.7]}>
        <mesh rotation={[0.5, 0.25, 0]}>
          <torusGeometry args={[0.55, 0.16, 16, 48]} />
          <meshStandardMaterial color={colors.brand} roughness={0.9} metalness={0} />
        </mesh>
      </Float>

      <Float {...base} speed={base.speed * 1.2} position={[0.05, -1.05, 0.5]}>
        <mesh>
          <sphereGeometry args={[0.38, 32, 32]} />
          <meshStandardMaterial color={colors.ink} roughness={1} metalness={0} />
        </mesh>
      </Float>
    </>
  )
}

export default function AtelierScene({ theme, still }: { theme: 'light' | 'dark'; still: boolean }) {
  const colors = theme === 'dark' ? DARK : LIGHT

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 5], fov: 38 }}
      gl={{ alpha: true, antialias: true }}
      // Demand mode when still: three keeps the last frame on screen instead of an idle
      // render loop spinning behind a still pose.
      frameloop={still ? 'demand' : 'always'}
    >
      <ambientLight intensity={theme === 'dark' ? 0.4 : 0.75} />
      <directionalLight position={[3, 4, 5]} intensity={theme === 'dark' ? 0.55 : 0.85} color={colors.ink} />
      <Suspense fallback={null}>
        <Shapes colors={colors} still={still} />
      </Suspense>
    </Canvas>
  )
}
