import { Search, Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export function TopBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-surface px-5">
      <div className="mr-4 flex items-center gap-2 font-bold text-text">
        <span className="text-accent">◉</span> Personal KB
      </div>
      <button
        type="button"
        onClick={onOpenCommand}
        className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-subtle hover:border-border-strong transition-colors"
      >
        <Search className="h-4 w-4" />
        <span>搜索一切…</span>
        <kbd className="ml-auto rounded border border-border bg-surface px-1.5 text-[11px] text-text-muted">⌘K</kbd>
      </button>
      <ThemeToggle />
      <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-2">
        <Settings className="h-[18px] w-[18px]" />
      </button>
    </header>
  );
}
