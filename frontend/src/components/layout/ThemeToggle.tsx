import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/button';
import type { Theme } from '@/lib/theme-provider';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`主题：${theme}，点击切换到 ${next}`}
      onClick={() => setTheme(next)}
    >
      <Icon className="h-[18px] w-[18px]" />
    </Button>
  );
}
