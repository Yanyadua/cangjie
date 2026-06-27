// frontend/src/components/cosmos/BlackHole.tsx
// PLACEHOLDER — real ShaderMaterial lands in Task 4.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface BlackHoleProps {
  position?: [number, number, number];
}

export default function BlackHole({ position = [0, 0, 0] }: BlackHoleProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.1;
  });
  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial color="#000000" />
    </mesh>
  );
}
