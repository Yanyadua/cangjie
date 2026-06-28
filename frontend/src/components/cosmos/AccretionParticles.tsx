// frontend/src/components/cosmos/AccretionParticles.tsx
// GPU-driven accretion disk particles orbiting the black hole. Each
// particle runs a Keplerian orbit (ω ∝ 1/√r) entirely in the vertex
// shader, so the CPU pays nothing per frame regardless of count.
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aAngle;   // initial orbit phase
  attribute float aRadius;  // orbit radius (world units)
  attribute float aSpeed;   // angular speed (rad/s), Keplerian
  attribute float aZ;       // vertical scatter off the orbital plane
  attribute float aSize;    // point size factor
  attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Keplerian orbit: inner radii advance faster.
    float angle = aAngle + aSpeed * uTime;
    vec3 pos = vec3(cos(angle) * aRadius, sin(angle) * aRadius, aZ);

    // Particles dim as they approach the horizon (swallowed).
    vAlpha = smoothstep(1.38, 1.75, aRadius);
    vColor = aColor;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Soft round particle — alpha falls off from the center.
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export interface AccretionParticlesProps {
  count?: number;
  /** Inner orbit radius — just outside the black hole halo. */
  innerRadius?: number;
  /** Outer orbit radius. */
  outerRadius?: number;
  /** Tilt of the orbital plane around X — adds 3D depth. */
  tilt?: number;
}

export default function AccretionParticles({
  count = 520,
  innerRadius = 1.52,
  outerRadius = 3.2,
  tilt = 0.18,
}: AccretionParticlesProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const aAngle = new Float32Array(count);
    const aRadius = new Float32Array(count);
    const aSpeed = new Float32Array(count);
    const aZ = new Float32Array(count);
    const aSize = new Float32Array(count);
    const aColor = new Float32Array(count * 3);

    const inner = new THREE.Color('#b45309'); // dim amber (hot inner)
    const mid = new THREE.Color('#7c2d12');   // dark ember
    const outer = new THREE.Color('#1e1b4b'); // deep dim violet (cool outer)
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Bias toward inner radii — more particles where the glow is.
      const t = Math.pow(Math.random(), 1.4);
      const radius = innerRadius + t * (outerRadius - innerRadius);
      aAngle[i] = Math.random() * Math.PI * 2;
      aRadius[i] = radius;
      // Keplerian: ω ∝ 1/√r — inner orbits visibly faster.
      aSpeed[i] = 0.4 / Math.sqrt(radius);
      // Thin disk: less vertical scatter near the center.
      aZ[i] = (Math.random() - 0.5) * 0.35 * (0.4 + t);
      // Larger particles on the inner bright band.
      aSize[i] = (1.0 - t) * 0.25 + 0.1;

      if (t < 0.5) tmp.copy(inner).lerp(mid, t * 2.0);
      else tmp.copy(mid).lerp(outer, (t - 0.5) * 2.0);
      aColor[i * 3] = tmp.r;
      aColor[i * 3 + 1] = tmp.g;
      aColor[i * 3 + 2] = tmp.b;
    }

    g.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
    g.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    g.setAttribute('aZ', new THREE.BufferAttribute(aZ, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    // Positions are computed in the vertex shader; a placeholder position
    // attribute is required for the draw call. frustumCulled=false below
    // stops three.js from culling these GPU-placed points.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count, innerRadius, outerRadius]);

  useFrame((_, delta) => {
    if (matRef.current && !reducedMotion) {
      (matRef.current.uniforms.uTime.value as number) += delta;
    }
  });

  return (
    <points geometry={geo} rotation={[tilt, 0, 0]} frustumCulled={false}>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
