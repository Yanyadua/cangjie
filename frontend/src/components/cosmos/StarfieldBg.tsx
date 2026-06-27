// frontend/src/components/cosmos/StarfieldBg.tsx
import { useEffect, useRef } from 'react';

type StarColor = 'warm' | 'cool' | 'gold' | 'rose';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: StarColor;
  hasGlow: boolean;
}

interface StarfieldBgProps {
  density?: 'low' | 'medium' | 'high';
  className?: string;
}

const DENSITY_COUNT: Record<NonNullable<StarfieldBgProps['density']>, number> = {
  low: 200,
  medium: 500,
  high: 900,
};

const COLOR_RGB: Record<StarColor, [number, number, number]> = {
  warm: [254, 243, 199],
  cool: [180, 210, 255],
  gold: [255, 200, 110],
  rose: [255, 170, 180],
};

function pickColor(): StarColor {
  const r = Math.random();
  if (r < 0.78) return 'warm';
  if (r < 0.92) return 'cool';
  if (r < 0.97) return 'gold';
  return 'rose';
}

/**
 * Persistent 2D starfield background.
 *
 * Stability notes (hard-won):
 * - NO ResizeObserver: observing a canvas whose `width`/`height` attributes
 *   we mutate creates an infinite loop (canvas is a replaced element, so
 *   attribute changes poke layout, which retriggers the observer). Each
 *   iteration repainted hundreds of arcs; after ~2s the GPU composite layer
 *   collapsed and the canvas went solid white.
 * - CSS size pinned to 100vw/100vh so attribute尺寸 never leaks into layout.
 * - Single paint on mount + debounced repaint on window resize (not canvas
 *   resize). Zero animation frames, zero observers on the canvas itself.
 */
export default function StarfieldBg({ density = 'medium', className }: StarfieldBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w === 0 || h === 0) return;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep purple-black radial gradient sky
      const cx = w * 0.5;
      const cy = h * 0.45;
      const maxR = Math.max(w, h) * 0.85;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      grad.addColorStop(0, '#0d0820');
      grad.addColorStop(0.4, '#070418');
      grad.addColorStop(1, '#020108');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Generate stars
      const count = Math.floor(
        (DENSITY_COUNT[density] * w * h) / (1920 * 1080),
      );
      const heroCount = Math.max(6, Math.floor(count * 0.04));

      const drawStar = (star: Star) => {
        const [r, g, b] = COLOR_RGB[star.color];
        if (star.hasGlow) {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.alpha * 0.2})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      };

      for (let i = 0; i < count; i++) {
        drawStar({
          x: Math.random() * w,
          y: Math.random() * h,
          size: Math.random() * 0.9 + 0.2,
          alpha: Math.random() * 0.6 + 0.25,
          color: pickColor(),
          hasGlow: false,
        });
      }
      for (let i = 0; i < heroCount; i++) {
        drawStar({
          x: Math.random() * w,
          y: Math.random() * h,
          size: Math.random() * 1.3 + 1.4,
          alpha: Math.random() * 0.3 + 0.7,
          color: pickColor(),
          hasGlow: true,
        });
      }
    };

    paint();

    // Debounced repaint on window resize only — never observe the canvas.
    let resizeTimer: number | undefined;
    const onWindowResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(paint, 250);
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onWindowResize);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      className={`cosmos-starfield-canvas ${className ?? ''}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  );
}
