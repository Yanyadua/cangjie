// frontend/src/components/cosmos/BlackHole.tsx
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SIMPLE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  #define HORIZON_R 0.48
  #define HALO_R    1.00
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > HALO_R)    { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
    if (r < HORIZON_R) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float t = (r - HORIZON_R) / (HALO_R - HORIZON_R);
    // static dim ember → violet halo, no animation
    vec3 inner = vec3(0.18, 0.04, 0.06);
    vec3 outer = vec3(0.05, 0.02, 0.12);
    vec3 col = mix(inner, outer, t);
    col *= pow(1.0 - t, 2.0);
    col *= smoothstep(0.0, 0.08, t);
    // thin dim photon ring
    float ring = exp(-abs(r - (HORIZON_R + 0.015)) * 180.0);
    col += vec3(0.36, 0.22, 0.17) * ring * 0.50;
    float alpha = 1.0 - smoothstep(0.75, 1.0, t);
    gl_FragColor = vec4(col, alpha);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  // Horizon fills most of the quad so the black body dominates — reads
  // as a solid celestial object rather than a ring with a hole.
  #define HORIZON_R 0.48
  #define HALO_R    1.00

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Additive fbm — the verified-working formulation. Stable across drivers.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float angle = atan(p.y, p.x);

    // Beyond halo — transparent
    if (r > HALO_R) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }

    // Non-circular horizon — gentle fbm warp of the silhouette. Additive
    // fbm (verified compiling) keeps the radius safely in [0.46, 0.50].
    float warp = (fbm(vec2(angle * 2.0, uTime * 0.04)) - 0.5) * 0.04;
    float horizonR = HORIZON_R + warp;

    // Solid event horizon — the body of the celestial object. Not dead
    // black: a near-invisible deep-red fbm churn hints at slow surface
    // rotation, so it reads as a dark sphere, not a flat hole.
    if (r < horizonR) {
      float surf = fbm(vec2(angle * 2.0 + uTime * 0.05, r * 6.0));
      vec3 deep = vec3(0.018, 0.006, 0.014) * surf;
      gl_FragColor = vec4(deep, 1.0);
      return;
    }

    // Halo normalized radius [0,1]
    float t = (r - horizonR) / (HALO_R - horizonR);

    // Keplerian flow: inner orbits advance faster (chrismatgit form).
    float spiralAng = angle + uTime * 0.06 - 0.4 / sqrt(r);
    vec2 polarUV = vec2(spiralAng * 1.5, r * 4.2);
    float swirl = fbm(polarUV);
    swirl = pow(swirl, 1.25);

    // Logarithmic spiral arms — angle winds tighter toward the center,
    // reinforces the rotational reading of the halo.
    float arm = 0.5 + 0.5 * sin(spiralAng * 3.0 - log(r) * 5.0);
    swirl *= 0.55 + 0.45 * arm;

    // Dim halo palette (darkened).
    vec3 inner = vec3(0.18, 0.04, 0.06);
    vec3 outer = vec3(0.05, 0.02, 0.13);
    vec3 col = mix(inner, outer, smoothstep(0.0, 0.9, t));
    col *= swirl * 0.6 + 0.12;
    col *= pow(1.0 - t, 2.2);

    // Anisotropic brightness — one rotating side brighter (Doppler-ish),
    // breaks rotational symmetry so the halo isn't a uniform flat ring.
    float aniso = 0.65 + 0.35 * cos(angle - uTime * 0.04);
    col *= aniso;

    // Distance-inverse glow near the horizon (chrismatgit-style soft bloom).
    float glow = clamp(0.06 / r, 0.0, 1.0);
    col += vec3(0.25, 0.08, 0.06) * glow * swirl * 0.30;

    // Thin dim photon ring — follows the warped silhouette.
    float ringR = horizonR + 0.015;
    float ring = exp(-abs(r - ringR) * 180.0);
    col += vec3(0.38, 0.24, 0.19) * ring * 0.55;

    col *= smoothstep(0.0, 0.08, t);
    float alpha = 1.0 - smoothstep(0.75, 1.0, t);
    gl_FragColor = vec4(col, alpha);
  }
`;

export interface BlackHoleProps {
  position?: [number, number, number];
  /** quad visual radius in world units; ~1.2 maps to the design's 120px feel at z=14 */
  size?: number;
  /** When true, use simplified FRAG_SIMPLE (Tier 3 fallback). */
  simple?: boolean;
}

export default function BlackHole({ position = [0, 0, 0], size = 1.4, simple = false }: BlackHoleProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 } }),
    [],
  );

  const fragmentShader = simple ? FRAG_SIMPLE : FRAG;

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useFrame((_, delta) => {
    if (matRef.current && !simple && !reducedMotion) {
      (matRef.current.uniforms.uTime.value as number) += delta;
    }
  });

  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[size * 2, size * 2]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={VERT}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}
