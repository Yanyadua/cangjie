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

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  // design §2.6 constants (normalized radii within the quad)
  #define EVENT_HORIZON_R 0.30
  #define PHOTON_SPHERE_R 0.33
  #define DISK_INNER_R    0.35
  #define DISK_OUTER_R    1.00

  void main() {
    // vUv is [0,1]; remap to [-1,1] centered on hole
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);

    // Event horizon — pure black
    if (r < EVENT_HORIZON_R) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Photon ring — thin bright white-hot ring just outside horizon
    float ringThickness = 0.015;
    float ringDist = abs(r - PHOTON_SPHERE_R);
    if (ringDist < ringThickness) {
      float intensity = 1.0 - ringDist / ringThickness;
      vec3 ringColor = vec3(1.0, 0.98, 0.92); // near-white
      gl_FragColor = vec4(ringColor * intensity * 2.0, 1.0);
      return;
    }

    // Outside the disk for now — fully transparent (let starfield show)
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
`;

export interface BlackHoleProps {
  position?: [number, number, number];
  /** quad visual radius in world units; ~1.2 maps to the design's 120px feel at z=14 */
  size?: number;
}

export default function BlackHole({ position = [0, 0, 0], size = 1.2 }: BlackHoleProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 } }),
    [],
  );

  useFrame((_, delta) => {
    if (matRef.current) {
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
          fragmentShader={FRAG}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}
