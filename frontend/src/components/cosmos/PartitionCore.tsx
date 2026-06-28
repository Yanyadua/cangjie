// frontend/src/components/cosmos/PartitionCore.tsx
import { useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface PartitionCoreProps {
  position?: [number, number, number];
  name: string;
  color?: string;
  onHover?: (hovering: boolean) => void;
}

export default function PartitionCore({
  position = [0, 0, 0],
  name,
  color = '#818cf8',
  onHover,
}: PartitionCoreProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.z += delta * 0.03;
  });

  return (
    <Billboard position={position}>
      <group
        ref={groupRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover?.(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover?.(false);
          document.body.style.cursor = 'default';
        }}
      >
        {/* Bright core */}
        <mesh>
          <circleGeometry args={[0.35, 32]} />
          <meshBasicMaterial color={new THREE.Color(color)} toneMapped={false} />
        </mesh>
        {/* Inner halo */}
        <mesh>
          <circleGeometry args={[0.7, 32]} />
          <meshBasicMaterial
            color={new THREE.Color(color)}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
        {/* Outer faint halo */}
        <mesh>
          <circleGeometry args={[1.2, 32]} />
          <meshBasicMaterial
            color={new THREE.Color(color)}
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      </group>
    </Billboard>
  );
}
