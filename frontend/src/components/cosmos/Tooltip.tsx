// frontend/src/components/cosmos/Tooltip.tsx
import { Html } from '@react-three/drei';

export interface TooltipProps {
  position: [number, number, number];
  title: string;
  subtitle?: string;
}

/** Hover tooltip overlay rendered in 3D space via drei `<Html>`. CJK-safe truncation. */
export default function Tooltip({ position, title, subtitle }: TooltipProps) {
  return (
    <Html position={position} center distanceFactor={10} zIndexRange={[20, 0]}>
      <div className="pointer-events-none rounded-md bg-surface/95 px-2 py-1 text-xs text-text shadow-md">
        <div className="font-semibold">
          {Array.from(title).slice(0, 30).join('')}
        </div>
        {subtitle && (
          <div className="text-[10px] text-text-muted">
            {Array.from(subtitle).slice(0, 60).join('')}
          </div>
        )}
      </div>
    </Html>
  );
}
