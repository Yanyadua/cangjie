import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { useAppKeyboard } from './useKeyboard';

const CANVAS_ROUTES = ['/cosmos', '/galaxy', '/draft', '/extract', '/proposal', '/clustering'];

export function AppShell({ children }: { children: ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const { pathname } = useLocation();

  // autoHide on canvas routes, unless the user has manually toggled
  const autoHide = !manualOverride && CANVAS_ROUTES.some((r) => pathname.startsWith(r));
  const effectiveCollapsed = collapsed || autoHide;

  // reset manual override when route changes
  useEffect(() => { setManualOverride(false); }, [pathname]);

  const handleToggleSidebar = () => {
    setManualOverride(true);
    setCollapsed((v) => !v);
  };

  useAppKeyboard({
    onCommand: () => setCmdOpen(true),
    onToggleSidebar: handleToggleSidebar,
  });

  return (
    <div className="flex h-screen flex-col bg-transparent text-text">
      <TopBar
        onOpenCommand={() => setCmdOpen(true)}
        sidebarCollapsed={effectiveCollapsed}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className="flex min-h-0 flex-1 gap-4 px-4">
        <Sidebar collapsed={effectiveCollapsed} onToggleCollapsed={(v) => { setManualOverride(true); setCollapsed(v); }} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <div key={pathname} className="page-enter h-full">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
