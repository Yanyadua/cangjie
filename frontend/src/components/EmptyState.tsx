import type { ReactNode } from 'react';

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="text-4xl opacity-40">🗂️</div>
      <div className="text-base font-semibold text-text">{title}</div>
      {hint && <div className="max-w-sm text-sm text-text-muted">{hint}</div>}
      {action}
    </div>
  );
}
