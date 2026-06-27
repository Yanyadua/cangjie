// frontend/src/components/cosmos/GalaxyNode.tsx
import { useMemo, useRef } from 'react';
import { Billboard, Points, PointMaterial } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface GalaxyNodeProps {
  position: [number, number, number];
  name: string;
  color?: string;
  childCount?: number;
  onClick?: (e: globalThis.MouseEvent) => void;
  onHover?: (hovering: boolean) => void;
}

/** Procedural particle puff positions around the galactic core. */
function usePuff(count: number, radius: number) {
  return useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // random point in a disc
      const r = Math.sqrt(Math.random()) * radius;
      const a = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = Math.sin(a) * r;
      arr[i * 3 + 2] = (Math.random() - 0.5) * radius * 0.3;
    }
    return arr;
  }, [count, radius]);
}

export default function GalaxyNode({
  position,
  name,
  color = '#818cf8',
  childCount = 0,
  onClick,
  onHover,
}: GalaxyNodeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const puffPositions = usePuff(60, 0.45);

  // Slow idle rotation of the particle puff
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.z += delta * 0.05;
  });

  return (
    <Billboard position={position}>
      <group
        ref={groupRef}
        onClick={(e) => { e.stopPropagation(); onClick?.(e.nativeEvent); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover?.(false); document.body.style.cursor = 'default'; }}
      >
        {/* Bright core */}
        <mesh>
          <circleGeometry args={[0.12, 24]} />
          <meshBasicMaterial color={new THREE.Color(color)} toneMapped={false} />
        </mesh>
        {/* Soft glow halo */}
        <mesh>
          <circleGeometry args={[0.35, 24]} />
          <meshBasicMaterial
            color={new THREE.Color(color)}
            transparent
            opacity={0.25}
            depthWrite={false}
          />
        </mesh>
        {/* Particle puff */}
        <Points positions={puffPositions} stride={3} frustumCulled={false}>
          <PointMaterial
            transparent
            color={new THREE.Color(color)}
            size={0.04}
            sizeAttenuation
            depthWrite={false}
            opacity={0.7}
          />
        </Points>
      </group>
    </Billboard>
  );
}
