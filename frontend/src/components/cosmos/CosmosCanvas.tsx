// frontend/src/components/cosmos/CosmosCanvas.tsx
import { Canvas } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { CosmosScene } from '../../lib/cosmos-mappers';
import { getGpuTier } from '../../lib/gpu-tier';
import BlackHole from './BlackHole';
import GalaxyNode from './GalaxyNode';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function layoutGalaxies(count: number): Array<[number, number, number]> {
  // radius grows with count so galaxies don't overlap; clamp to a readable band
  const radius = Math.max(5, Math.min(9, 4 + count * 0.3));
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE;
    const z = (i % 2 === 0 ? 1 : -1) * (0.5 + (i % 3) * 0.3);
    out.push([Math.cos(a) * radius, Math.sin(a) * radius, z]);
  }
  return out;
}

export interface CosmosCanvasProps {
  scene: CosmosScene;
  onGalaxyClick?: (galaxyId: string) => void;
}

export default function CosmosCanvas({ scene, onGalaxyClick }: CosmosCanvasProps) {
  const tier = getGpuTier();
  const positions = layoutGalaxies(scene.galaxies.length);
  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 50 }}
      gl={{ alpha: true, antialias: true }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 0, 0]} intensity={2} distance={20} color="#f59e0b" />
      <BlackHole position={[0, 0, 0]} simple={tier.tier === 3} />
      {scene.rootEdges.map((e, i) => {
        const partitionId = e.source === scene.blackHole?.id ? e.target : e.source;
        const idx = scene.galaxies.findIndex(g => g.id === partitionId);
        if (idx < 0) return null;
        const pos = positions[idx];
        return (
          <Line
            key={`root-${i}`}
            points={[[0, 0, 0], pos]}
            color="#4c1d95"
            lineWidth={1}
            transparent
            opacity={0.25}
          />
        );
      })}
      {scene.galaxies.map((g, i) => (
        <GalaxyNode
          key={g.id}
          position={positions[i] ?? [0, 0, 0]}
          name={g.name}
          color="#6366f1"
          childCount={g.childCount}
          onClick={() => onGalaxyClick?.(g.id)}
        />
      ))}
    </Canvas>
  );
}
