// frontend/src/lib/gpu-tier.ts

/**
 * Cosmic UI degradation tiers (see docs/plans/2026-06-27-cosmic-ui-design.md §5).
 *
 *   Tier 1 — Full r3f + physics sim + Bloom + gravitational lens shader
 *   Tier 2 — r3f + reduced physics + simplified black hole
 *   Tier 3 — r3f static layout (no sim) + simplified black hole
 *   Tier 4 — Canvas 2D starfield + DOM nodes
 *   Tier 5 — Legacy RadialKnowledgeGraph (React Flow)
 */
export type GpuTier = 1 | 2 | 3 | 4 | 5;

interface DetectionResult {
  tier: GpuTier;
  reason: 'webgl2-high' | 'webgl2-mid' | 'webgl2-low' | 'canvas2d-only' | 'no-canvas';
  renderer?: string;
}

const TIER_KEYWORDS: Array<{ tier: GpuTier; reason: DetectionResult['reason']; pattern: RegExp }> = [
  { tier: 1, reason: 'webgl2-high', pattern: /Apple M[1-9]|RTX \d{3,4}|Radeon RX|Arc A\d{2,3}/i },
  { tier: 2, reason: 'webgl2-mid', pattern: /Apple GPU|Intel Iris|Intel UHD Graphics 7\d{2}/i },
  { tier: 3, reason: 'webgl2-low', pattern: /Intel HD|Mali|Adreno [6-9]/i },
];

export function detectGpuTier(): DetectionResult {
  if (typeof window === 'undefined') {
    return { tier: 5, reason: 'no-canvas' };
  }

  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;

  if (!gl2) {
    const ctx2d = canvas.getContext('2d');
    return ctx2d
      ? { tier: 4, reason: 'canvas2d-only' }
      : { tier: 5, reason: 'no-canvas' };
  }

  const ext = gl2.getExtension('WEBGL_debug_renderer_info');
  if (ext) {
    const renderer = gl2.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    for (const rule of TIER_KEYWORDS) {
      if (rule.pattern.test(renderer)) {
        return { tier: rule.tier, reason: rule.reason, renderer };
      }
    }
    return { tier: 2, reason: 'webgl2-mid', renderer };
  }

  return { tier: 2, reason: 'webgl2-mid' };
}

let cachedDetection: DetectionResult | null = null;

export function getGpuTier(): DetectionResult {
  if (!cachedDetection) cachedDetection = detectGpuTier();
  return cachedDetection;
}

export function _resetGpuTierCache(): void {
  cachedDetection = null;
}
