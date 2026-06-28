// frontend/src/components/cosmos/ArticleStar.tsx
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

export interface ArticleStarProps {
  position: [number, number, number];
  name: string;
  color?: string;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
}

export default function ArticleStar({
  position,
  name,
  color = '#5fc7bc',
  onClick,
  onHover,
}: ArticleStarProps) {
  return (
    <Billboard position={position}>
      <group
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
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
          <circleGeometry args={[0.07, 16]} />
          <meshBasicMaterial color={new THREE.Color(color)} toneMapped={false} />
        </mesh>
        {/* Soft halo */}
        <mesh>
          <circleGeometry args={[0.18, 16]} />
          <meshBasicMaterial
            color={new THREE.Color(color)}
            transparent
            opacity={0.3}
            depthWrite={false}
          />
        </mesh>
      </group>
    </Billboard>
  );
}
