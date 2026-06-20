import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  PanelLeftClose, PanelLeftOpen, Upload, Clock, Network, Search, MessageSquare,
} from 'lucide-react';
import { getDocuments } from '@/api/client';
import type { DocumentResponse } from '@/types/graph';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/import', label: '导入', icon: Upload },
  { to: '/history', label: '历史', icon: Clock },
  { to: '/graph', label: '全局图谱', icon: Network },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/ask', label: '问答', icon: MessageSquare },
];

export function Sidebar({
  collapsed, onToggleCollapsed, autoHide,
}: { collapsed: boolean; onToggleCollapsed: (v: boolean) => void; autoHide: boolean }) {
  const [recent, setRecent] = useState<DocumentResponse[]>([]);
  useEffect(() => {
    getDocuments(0, 8).then((d) => setRecent(d as DocumentResponse[])).catch(() => {});
  }, []);
  const collapsedNow = collapsed || autoHide;

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-surface transition-[width] duration-150',
        collapsedNow ? 'w-14' : 'w-60',
      )}
    >
      <nav className="flex flex-col gap-1 p-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium border-l-2 border-transparent',
                collapsedNow && 'justify-center px-0',
                isActive
                  ? 'bg-accent-soft text-accent border-l-accent'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsedNow && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsedNow && (
        <div className="mt-2 flex-1 overflow-y-auto px-3">
          <div className="px-2 pb-1 text-xs font-medium text-text-subtle">最近</div>
          {recent.map((d) => (
            <NavLink
              key={d.id}
              to="/history"
              className="block truncate rounded-md px-2 py-1.5 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
              title={d.title}
            >
              {d.title}
            </NavLink>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onToggleCollapsed(!collapsed)}
        className="m-2 inline-flex items-center justify-center rounded-md py-2 text-text-muted hover:bg-surface-2"
      >
        {collapsedNow ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
      </button>
    </aside>
  );
}
