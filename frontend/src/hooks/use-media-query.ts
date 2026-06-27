// frontend/src/hooks/use-media-query.ts
import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook. Returns `false` on initial render to avoid
 * hydration mismatch, then updates after mount.
 *
 * Use `useIsCoarsePointer()` for cosmic UI mobile/desktop fork.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Detect coarse pointer (touch / no precise hover). Drives cosmic UI fallback. */
export function useIsCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/** Detect narrow viewport. Below 768 → fallback to RadialKnowledgeGraph. */
export function useIsNarrowViewport(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
