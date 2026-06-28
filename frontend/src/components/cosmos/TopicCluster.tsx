// frontend/src/components/cosmos/TopicCluster.tsx
import { Fragment, useRef } from 'react';
import { Billboard, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import ArticleStar, { type ArticleStarProps } from './ArticleStar';

export interface ArticleChild {
  id: string;
  position: [number, number, number];
  data: ArticleStarProps;
}

export interface TopicClusterProps {
  position: [number, number, number];
  name: string;
  description?: string;
  articleCount: number;
  expanded: boolean;
  /** only used when expanded — the actual article children to render */
  articles?: ArticleChild[];
  hoveredArticleId?: string | null;
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
  hoveredArticleId,
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

      {/* Count badge — only when collapsed and has articles */}
      {!expanded && articleCount > 0 && (
        <Html position={[0.22, 0.22, 0]} center distanceFactor={10} zIndexRange={[10, 0]}>
          <div className="pointer-events-none flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-400/90 px-1 text-[9px] font-semibold text-white shadow-sm">
            {articleCount}
          </div>
        </Html>
      )}

      {/* Article children — only rendered when expanded.
          Caller-supplied positions in `articles[].position` win over `data.position`. */}
      {expanded && articles?.map((child) => (
        <Fragment key={`art-${child.id}`}>
          <ArticleStar
            position={child.position}
            name={child.data.name}
            color={child.data.color}
            onClick={child.data.onClick}
            onHover={child.data.onHover}
          />
          {hoveredArticleId === child.id && (
            <Html position={child.position} center distanceFactor={10} zIndexRange={[20, 0]}>
              <div className="pointer-events-none rounded-md bg-surface/95 px-2 py-1 text-xs text-text shadow-md">
                <div className="font-semibold">
                  {Array.from(child.data.name).slice(0, 30).join('')}
                </div>
              </div>
            </Html>
          )}
        </Fragment>
      ))}
    </group>
  );
}
