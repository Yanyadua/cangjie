import { cn, nodeColorVar } from '@/lib/utils';
import type { NodeType } from '@/types/graph';

export function NodeCard({
  nodeType, name, description, meta, onClick, selected,
}: {
  nodeType: NodeType | string;
  name: string;
  description?: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const color = nodeColorVar(nodeType);
  return (
    <div
      onClick={onClick}
      style={{ borderColor: selected ? color : undefined }}
      className={cn(
        'group rounded-xl border border-border bg-surface p-3 shadow-sm transition-all',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lift',
        selected && 'ring-2',
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="h-3 w-1 rounded-full" style={{ background: color }} />
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {nodeType}
        </span>
      </div>
      <div className="text-sm font-semibold text-text">{name}</div>
      {description && (
        <div className="mt-1 line-clamp-2 text-xs text-text-muted">{description}</div>
      )}
      {meta && <div className="mt-2 flex items-center gap-3 text-[11px] text-text-subtle">{meta}</div>}
    </div>
  );
}
