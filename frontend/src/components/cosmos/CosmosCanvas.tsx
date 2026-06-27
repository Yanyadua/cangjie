// frontend/src/components/cosmos/CosmosCanvas.tsx
import { Canvas } from '@react-three/fiber';
import type { CosmosScene } from '../../lib/cosmos-mappers';
import { getGpuTier } from '../../lib/gpu-tier';
import BlackHole from './BlackHole';
import GalaxyNode from './GalaxyNode';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function layoutGalaxies(count: number, radius = 6): Array<[number, number, number]> {
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
      {scene.galaxies.map((g, i) => (
        <GalaxyNode
          key={g.id}
          position={positions[i] ?? [0, 0, 0]}
          name={g.name}
          onClick={() => onGalaxyClick?.(g.id)}
        />
      ))}
    </Canvas>
  );
}
