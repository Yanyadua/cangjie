import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { useAppKeyboard } from './useKeyboard';

const CANVAS_ROUTES = ['/graph', '/draft', '/extract', '/proposal', '/clustering'];

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const autoHide = CANVAS_ROUTES.some((r) => pathname.startsWith(r));

  useAppKeyboard({
    onCommand: () => setCmdOpen(true),
    onToggleSidebar: () => setCollapsed((v) => !v),
  });

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar onOpenCommand={() => setCmdOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggleCollapsed={setCollapsed} autoHide={autoHide} />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
