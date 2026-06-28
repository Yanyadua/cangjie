// frontend/src/components/cosmos/NebulaBg.tsx
import { useMemo } from 'react';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

export interface NebulaBgProps {
  /** particle count; tier 1-2 default 400, tier 3 should pass 150 */
  count?: number;
  /** cloud radius in world units */
  radius?: number;
  color?: string;
}

/**
 * Faint tinted particle cloud around the galactic core.
 * Renders as a flat-ish disc (z jitter small) so it reads as a nebula plane.
 */
export default function NebulaBg({
  count = 400,
  radius = 7,
  color = '#4c1d95',
}: NebulaBgProps) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Square-root bias toward center (denser near core)
      const r = Math.sqrt(Math.random()) * radius;
      const a = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = Math.sin(a) * r;
      arr[i * 3 + 2] = (Math.random() - 0.5) * radius * 0.25;
    }
    return arr;
  }, [count, radius]);

  return (
    <Points positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color={new THREE.Color(color)}
        size={0.06}
        sizeAttenuation
        depthWrite={false}
        opacity={0.35}
      />
    </Points>
  );
}
