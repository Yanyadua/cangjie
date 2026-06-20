import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { semanticSearch } from '@/api/client';

type Item = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Item[]>([]);
  const close = () => onOpenChange(false);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const r = await semanticSearch(q, 6);
        if (!active) return;
        setHits(
          (r.nodes || []).map((n) => ({
            id: n.id, label: n.name, hint: n.node_type,
            run: () => { navigate('/graph'); close(); },
          })),
        );
      } catch { /* ignore */ }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [q]);

  if (!open) return null;

  const pages: Item[] = [
    { id: 'p-import', label: '导入新文章', run: () => { navigate('/import'); close(); } },
    { id: 'p-graph', label: '打开全局图谱', run: () => { navigate('/graph'); close(); } },
    { id: 'p-search', label: '搜索知识库', run: () => { navigate('/search'); close(); } },
    { id: 'p-ask', label: '向知识库提问', run: () => { navigate('/ask'); close(); } },
    { id: 'p-history', label: '查看历史', run: () => { navigate('/history'); close(); } },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[12vh]" onClick={close}>
      <Command
        loop
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="输入命令或搜索…" className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-text-subtle" />
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-text-subtle">无结果</Command.Empty>
          <Command.Group heading="跳转页面" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-subtle">
            {pages.map((it) => (
              <Command.Item key={it.id} onSelect={it.run} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-text aria-selected:bg-accent-soft aria-selected:text-accent">
                {it.label}
              </Command.Item>
            ))}
          </Command.Group>
          {hits.length > 0 && (
            <Command.Group heading="搜索节点" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-text-subtle">
              {hits.map((it) => (
                <Command.Item key={it.id} onSelect={it.run} className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-text aria-selected:bg-accent-soft aria-selected:text-accent">
                  <span>{it.label}</span>
                  {it.hint && <span className="text-xs text-text-subtle">{it.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
