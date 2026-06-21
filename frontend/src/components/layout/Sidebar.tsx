import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Upload, Clock, Network, Search, MessageSquare, FlaskConical, Layers, GitMerge } from 'lucide-react';
import { getDocuments } from '@/api/client';
import type { DocumentResponse } from '@/types/graph';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/import', label: '导入', icon: Upload },
  { to: '/history', label: '历史', icon: Clock },
  { to: '/graph', label: '我的图谱', icon: Network },
  { to: '/partitions', label: '分区', icon: Layers },
  { to: '/merge', label: '合并', icon: GitMerge },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/ask', label: '问答', icon: MessageSquare },
  { to: '/eval', label: '评估实验室', icon: FlaskConical },
];

export function Sidebar({
  collapsed, onToggleCollapsed,
}: { collapsed: boolean; onToggleCollapsed: (v: boolean) => void }) {
  const [recent, setRecent] = useState<DocumentResponse[]>([]);
  useEffect(() => {
    getDocuments(0, 8).then((d) => setRecent((d as any)?.documents || [])).catch(() => {});
  }, []);

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <nav className="flex flex-col gap-1 p-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="mt-2 flex-1 overflow-y-auto px-2">
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
    </aside>
  );
}
