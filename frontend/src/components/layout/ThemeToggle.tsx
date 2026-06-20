import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import type { Theme } from '@/lib/theme-provider';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      aria-label={`主题：${theme}，点击切换到 ${next}`}
      onClick={() => setTheme(next)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
