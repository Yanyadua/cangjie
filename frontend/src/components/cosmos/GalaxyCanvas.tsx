// frontend/src/components/cosmos/GalaxyCanvas.tsx
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { GalaxyScene } from '../../lib/galaxy-mappers';
import { getGpuTier } from '../../lib/gpu-tier';
import PartitionCore from './PartitionCore';
import TopicCluster, { layoutArticleCluster } from './TopicCluster';
import ArticleStar, { type ArticleStarProps } from './ArticleStar';

/** Log-spiral layout for topics. Returns world positions for each topic. */
function layoutTopics(count: number, opts?: { armCount?: number; radius?: number }): Array<[number, number, number]> {
  if (count === 0) return [];
  const armCount = opts?.armCount ?? (count > 12 ? 3 : 2);
  const maxRadius = opts?.radius ?? 5.5;
  const minRadius = 1.4; // outside the partition core
  // Log spiral params: r = a * e^(b * θ). Solve a/b so spiral spans minRadius→maxRadius over `perArm` turns.
  const perArm = Math.ceil(count / armCount);
  const b = 0.25; // tightness; positive = outward spiral as θ grows
  const a = minRadius; // r at θ=0
  // Find θ_max so that a * e^(b * θ_max) = maxRadius
  const thetaMax = Math.log(maxRadius / a) / b;

  const positions: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const armIdx = i % armCount;
    const alongArm = Math.floor(i / armCount);
    const t = perArm <= 1 ? 0 : alongArm / (perArm - 1);
    const theta = t * thetaMax + (armIdx * (Math.PI * 2 / armCount));
    const r = a * Math.exp(b * (t * thetaMax));
    // Small z jitter for depth feel (M3 physics will replace)
    const z = (i % 2 === 0 ? 1 : -1) * (0.3 + (i % 3) * 0.2);
    positions.push([Math.cos(theta) * r, Math.sin(theta) * r, z]);
  }
  return positions;
}

/** Orphan articles ring around the partition core (no parent topic). */
function layoutOrphanRing(count: number, radius = 1.1): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(count, 1)) * Math.PI * 2;
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius, 0.1]);
  }
  return out;
}

/** Disposes geometries/materials/GL on Canvas unmount. Must live inside <Canvas>. */
function Cleanup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    return () => {
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
          else (m.material as THREE.Material).dispose();
        }
      });
      gl.dispose();
    };
  }, [gl, scene]);
  return null;
}

export interface GalaxyCanvasProps {
  scene: GalaxyScene;
  expandedTopicIds: Set<string>;
  hoveredTopicId: string | null;
  hoveredArticleId: string | null;
  onTopicClick: (topicId: string) => void;
  onTopicHover: (topicId: string | null) => void;
  onArticleClick: (articleId: string) => void;
  onArticleHover: (articleId: string | null) => void;
  onPartitionHover: (hovering: boolean) => void;
}

export default function GalaxyCanvas({
  scene,
  expandedTopicIds,
  hoveredTopicId: _hoveredTopicId,
  hoveredArticleId: _hoveredArticleId,
  onTopicClick,
  onTopicHover,
  onArticleClick,
  onArticleHover,
  onPartitionHover,
}: GalaxyCanvasProps) {
  const tier = getGpuTier();
  // dim ambient on tier 3 to save fill-rate
  const ambient = tier.tier === 3 ? 0.3 : 0.45;

  const topicPositions = useMemo(
    () => layoutTopics(scene.topics.length),
    [scene.topics.length],
  );
  const orphanPositions = useMemo(
    () => layoutOrphanRing(scene.orphanArticles.length),
    [scene.orphanArticles.length],
  );

  return (
    <Canvas
      camera={{ position: [0, 4, 14], fov: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <Cleanup />
      <ambientLight intensity={ambient} />
      <pointLight position={[0, 0, 0]} intensity={2.5} distance={25} color="#818cf8" />
      {scene.partition && (
        <PartitionCore
          position={[0, 0, 0]}
          name={scene.partition.name}
          color="#818cf8"
          onHover={onPartitionHover}
        />
      )}

      {/* Topic clusters on spiral arms */}
      {scene.topics.map((t, i) => {
        const pos = topicPositions[i] ?? [0, 0, 0] as [number, number, number];
        const expanded = expandedTopicIds.has(t.id);
        // Compute article child positions only when expanded (skip work for collapsed)
        const articlePositions = expanded
          ? layoutArticleCluster(t.articles.length)
          : [];
        const articleChildren = t.articles.map((a, ai) => ({
          position: articlePositions[ai] ?? [0, 0, 0] as [number, number, number],
          data: {
            name: a.name,
            onClick: () => onArticleClick(a.id),
            onHover: (h: boolean) => onArticleHover(h ? a.id : null),
          } as ArticleStarProps,
        }));
        return (
          <TopicCluster
            key={t.id}
            position={pos}
            name={t.name}
            description={t.description}
            articleCount={t.articles.length}
            expanded={expanded}
            articles={articleChildren}
            color="#ac92d6"
            onClick={() => onTopicClick(t.id)}
            onHover={(h) => onTopicHover(h ? t.id : null)}
          />
        );
      })}

      {/* Lateral topic↔topic edges (faint) */}
      {scene.topicEdges.map((e, i) => {
        const srcIdx = scene.topics.findIndex(t => t.id === e.source);
        const dstIdx = scene.topics.findIndex(t => t.id === e.target);
        if (srcIdx < 0 || dstIdx < 0) return null;
        const src = topicPositions[srcIdx];
        const dst = topicPositions[dstIdx];
        if (!src || !dst) return null;
        return (
          <Line
            key={`tlink-${i}`}
            points={[src, dst]}
            color="#4c1d95"
            lineWidth={1}
            transparent
            opacity={0.2}
          />
        );
      })}

      {/* Orphan articles in ring around core */}
      {scene.orphanArticles.map((a, i) => (
        <ArticleStar
          key={`orph-${a.id}`}
          position={orphanPositions[i] ?? [0, 0, 0]}
          name={a.name}
          color="#5fc7bc"
          onClick={() => onArticleClick(a.id)}
          onHover={(h) => onArticleHover(h ? a.id : null)}
        />
      ))}
    </Canvas>
  );
}
