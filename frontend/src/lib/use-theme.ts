import { useContext } from 'react';
import { ThemeContext, type Theme } from './theme-provider';

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; resolved: 'light' | 'dark' } {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
