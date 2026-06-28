// frontend/src/components/cosmos/GalaxyCanvas.tsx
import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalaxyScene } from '../../lib/galaxy-mappers';
import { getGpuTier } from '../../lib/gpu-tier';
import PartitionCore from './PartitionCore';

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
  onPartitionHover?: (hovering: boolean) => void;
}

export default function GalaxyCanvas({ scene, onPartitionHover }: GalaxyCanvasProps) {
  const tier = getGpuTier();
  // dim ambient on tier 3 to save fill-rate
  const ambient = tier.tier === 3 ? 0.3 : 0.45;

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
    </Canvas>
  );
}
