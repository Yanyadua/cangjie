import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAppKeyboard(opts: {
  onCommand: () => void;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'k') { e.preventDefault(); opts.onCommand(); return; }
      if (e.key === '\\') { e.preventDefault(); opts.onToggleSidebar(); return; }
      const map: Record<string, string> = { '1': '/import', '2': '/history', '3': '/graph', '4': '/search', '5': '/ask' };
      if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, opts]);
}
