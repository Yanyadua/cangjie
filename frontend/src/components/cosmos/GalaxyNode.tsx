// frontend/src/components/cosmos/GalaxyNode.tsx
// PLACEHOLDER — real sprite + particles land in Task 8.
import * as THREE from 'three';

export interface GalaxyNodeProps {
  position: [number, number, number];
  name: string;
  color?: string;
  /** unused in placeholder; wired in Task 8/10 */
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
  childCount?: number;
}

export default function GalaxyNode({ position, color = '#818cf8' }: GalaxyNodeProps) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshBasicMaterial color={new THREE.Color(color)} />
    </mesh>
  );
}
