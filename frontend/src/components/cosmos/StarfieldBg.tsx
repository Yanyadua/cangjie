// frontend/src/components/cosmos/StarfieldBg.tsx
import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface StarfieldBgProps {
  /** Star count. Scaled by GPU tier in M0 — caller passes the number. */
  density?: 'low' | 'medium' | 'high';
  className?: string;
}

const DENSITY_COUNT: Record<NonNullable<StarfieldBgProps['density']>, number> = {
  low: 200,
  medium: 600,
  high: 1200,
};

/**
 * Persistent 2D starfield background. Renders behind all routes — M0 uses
 * a simple twinkle animation. M1 will layer r3f on top for parallax.
 *
 * Implementation notes:
 * - Canvas 2D (no WebGL dependency — works on every tier)
 * - DPR-aware (uses devicePixelRatio for crisp rendering)
 * - `prefers-reduced-motion` stops twinkle
 * - ResizeObserver for responsive resize
 */
export default function StarfieldBg({ density = 'medium', className }: StarfieldBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let stars: Star[] = [];
    let rafId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const generateStars = (width: number, height: number) => {
      const count = Math.floor(
        (DENSITY_COUNT[density] * width * height) / (1920 * 1080),
      );
      return Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.2 + 0.3,
        alpha: Math.random() * 0.7 + 0.3,
        twinkleSpeed: Math.random() * 0.5 + 0.1,
        twinkleOffset: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = generateStars(rect.width, rect.height);
    };

    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#050208';
      ctx.fillRect(0, 0, rect.width, rect.height);

      const t = time * 0.001;
      for (const star of stars) {
        const twinkle = reducedMotion
          ? star.alpha
          : star.alpha * (0.5 + 0.5 * Math.sin(t * star.twinkleSpeed + star.twinkleOffset));
        ctx.fillStyle = `rgba(254, 243, 199, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      rafId = requestAnimationFrame(render);
    };

    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    if (!reducedMotion) {
      rafId = requestAnimationFrame(render);
    } else {
      // Render one frame, no loop
      render(0);
      cancelAnimationFrame(rafId);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      aria-hidden
    />
  );
}
