import { Search, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';

export function TopBar({
  onOpenCommand,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  onOpenCommand: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
      >
        {sidebarCollapsed
          ? <PanelLeftOpen className="h-[18px] w-[18px]" />
          : <PanelLeftClose className="h-[18px] w-[18px]" />}
      </Button>
      <div className="mr-2 flex items-center gap-2 font-bold text-text">
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
      <Button variant="ghost" size="icon" title="设置">
        <Settings className="h-[18px] w-[18px]" />
      </Button>
    </header>
  );
}
