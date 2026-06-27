import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const ROUTES: Record<string, string> = {
  '1': '/import',
  '2': '/history',
  '3': '/cosmos',
  '4': '/search',
  '5': '/ask',
};

export function useAppKeyboard(opts: {
  onCommand: () => void;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Don't hijack shortcuts while the user is typing in a field.
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'k') { e.preventDefault(); ref.current.onCommand(); return; }
      if (e.key === '\\') { e.preventDefault(); ref.current.onToggleSidebar(); return; }
      const dest = ROUTES[e.key];
      if (dest) { e.preventDefault(); navigate(dest); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
