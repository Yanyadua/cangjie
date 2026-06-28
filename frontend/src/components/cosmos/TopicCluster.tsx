// frontend/src/components/cosmos/TopicCluster.tsx
import { useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import ArticleStar, { type ArticleStarProps } from './ArticleStar';

export interface TopicClusterProps {
  position: [number, number, number];
  name: string;
  description?: string;
  articleCount: number;
  expanded: boolean;
  /** only used when expanded — the actual article children to render */
  articles?: Array<{
    position: [number, number, number];
    data: ArticleStarProps;
  }>;
  color?: string;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
}

/**
 * Layout child articles in a small disc around the topic center.
 * Radius grows with count to avoid overlap; max 8 per ring, then concentric.
 * Returns positions LOCAL to the topic (caller adds topic position via <group>).
 */
export function layoutArticleCluster(count: number, baseRadius = 0.45): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const perRing = 8;
  for (let i = 0; i < count; i++) {
    const ringIdx = Math.floor(i / perRing);
    const inRing = i % perRing;
    const itemsInThisRing = Math.min(perRing, count - ringIdx * perRing);
    const r = baseRadius * (1 + ringIdx * 0.8);
    const a = (inRing / itemsInThisRing) * Math.PI * 2 + ringIdx * 0.4;
    out.push([Math.cos(a) * r, Math.sin(a) * r, 0.05 * (ringIdx + 1)]);
  }
  return out;
}

export default function TopicCluster({
  position,
  name,
  articleCount,
  expanded,
  articles,
  color = '#ac92d6',
  onClick,
  onHover,
}: TopicClusterProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current && expanded) groupRef.current.rotation.z += delta * 0.04;
  });

  // Visual radius pulses with article count (capped)
  const coreRadius = 0.14 + Math.min(0.08, articleCount * 0.005);
  const haloOpacity = expanded ? 0.45 : 0.3;

  return (
    <group position={position}>
      <Billboard>
        <group
          ref={groupRef}
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
            <circleGeometry args={[coreRadius, 24]} />
            <meshBasicMaterial color={new THREE.Color(color)} toneMapped={false} />
          </mesh>
          {/* Halo */}
          <mesh>
            <circleGeometry args={[coreRadius * 2.5, 24]} />
            <meshBasicMaterial
              color={new THREE.Color(color)}
              transparent
              opacity={haloOpacity}
              depthWrite={false}
            />
          </mesh>
          {/* Pulse ring when expanded — visual cue that articles are deployed */}
          {expanded && (
            <mesh>
              <ringGeometry args={[coreRadius * 3, coreRadius * 3.15, 32]} />
              <meshBasicMaterial
                color={new THREE.Color(color)}
                transparent
                opacity={0.4}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      </Billboard>

      {/* Article children — only rendered when expanded.
          Caller-supplied positions in `articles[].position` win over `data.position`. */}
      {expanded && articles?.map(({ position: aPos, data }, i) => {
        const { position: _ignored, ...rest } = data;
        return <ArticleStar key={`art-${i}`} position={aPos} {...rest} />;
      })}
    </group>
  );
}
