import { useEffect, useState, useCallback } from 'react';
import {
  detectDuplicateTopics,
  mergeNodes,
  listPartitions,
  mergePartitions,
  getPartitionChildren,
  splitPartition,
} from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { toErrorMessage } from '@/lib/errors';

type DuplicatePair = {
  source: { id: string; name: string; description?: string };
  target: { id: string; name: string; description?: string };
  similarity: number;
};

type Partition = {
  id: string;
  name: string;
  description?: string;
  article_count?: number;
  topic_count?: number;
};

type PartitionChild = {
  topics: Array<{ id: string; name: string; description?: string }>;
  articles: Array<{ id: string; name: string; description?: string }>;
};

type Tab = 'dedup' | 'mergePartition' | 'splitPartition';

type Notice = { variant: 'destructive' | 'success'; message: string } | null;

export default function MergePage() {
  const [tab, setTab] = useState<Tab>('dedup');

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-4 text-xl font-semibold text-text">合并去重管理</h2>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="dedup">Topic 去重</TabsTrigger>
          <TabsTrigger value="mergePartition">分区合并</TabsTrigger>
          <TabsTrigger value="splitPartition">分区拆分</TabsTrigger>
        </TabsList>
        <TabsContent value="dedup" className="mt-4"><DedupTab /></TabsContent>
        <TabsContent value="mergePartition" className="mt-4"><MergePartitionTab /></TabsContent>
        <TabsContent value="splitPartition" className="mt-4"><SplitPartitionTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  if (!notice) return null;
  return (
    <Alert variant={notice.variant === 'destructive' ? 'destructive' : 'default'} className="mb-4">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span className={notice.variant === 'success' ? 'text-emerald-600 dark:text-emerald-400' : ''}>
          {notice.message}
        </span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-xs text-text-subtle hover:text-text">✕</button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// ── Tab 1: Topic 去重 ──

function DedupTab() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await detectDuplicateTopics(0.82);
      setPairs(data || []);
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '检测失败：' + toErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMerge = async (sourceId: string, targetId: string, pairKey: string) => {
    setMerging(pairKey);
    try {
      await mergeNodes(sourceId, targetId);
      await load();
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '合并失败：' + toErrorMessage(e) });
    } finally {
      setMerging(null);
    }
  };

  if (loading) return <LoadingSkeleton count={3} />;

  if (pairs.length === 0) {
    return (
      <EmptyState
        title="没有检测到重复 topic"
        hint="系统会自动对比所有 topic 节点的语义相似度，找出可能的重复。"
        action={<Button size="sm" onClick={load}>重新检测</Button>}
      />
    );
  }

  return (
    <div>
      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
      <div className="mb-3 text-sm text-text-muted">
        检测到 <span className="font-semibold text-text">{pairs.length}</span> 组相似 topic，选择合并方向（箭头指向被保留的节点）：
      </div>
      {pairs.map((pair) => {
        const pairKey = `${pair.source.id}-${pair.target.id}`;
        return (
          <Card key={pairKey} className="mb-2 py-4">
            <CardContent>
              <div className="flex items-center gap-3">
                <PairNodeCard name={pair.source.name} description={pair.source.description} />

                <div className="shrink-0 text-center">
                  <div className="text-[11px] text-text-subtle">相似度</div>
                  <Badge variant="secondary" className="mt-0.5 text-sm font-bold">
                    {(pair.similarity * 100).toFixed(0)}%
                  </Badge>
                </div>

                <PairNodeCard name={pair.target.name} description={pair.target.description} />

                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={merging === pairKey}
                    onClick={() => handleMerge(pair.source.id, pair.target.id, pairKey)}
                  >
                    ← 合并到右边
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={merging === pairKey}
                    onClick={() => handleMerge(pair.target.id, pair.source.id, pairKey)}
                  >
                    合并到左边 →
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function PairNodeCard({ name, description }: { name: string; description?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-semibold text-text">{name}</div>
      {description && (
        <div className="mt-0.5 truncate text-xs text-text-subtle">{description}</div>
      )}
    </div>
  );
}

// ── Tab 2: 分区合并 ──

function MergePartitionTab() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '加载分区失败：' + toErrorMessage(e) });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMerge = async () => {
    setConfirmOpen(false);
    if (!sourceId || !targetId || sourceId === targetId) {
      setNotice({ variant: 'destructive', message: '请选择不同的源分区和目标分区' });
      return;
    }
    setLoading(true);
    try {
      await mergePartitions(sourceId, targetId);
      setSourceId('');
      setTargetId('');
      await load();
      setNotice({ variant: 'success', message: '合并成功' });
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '合并失败：' + toErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  };

  if (partitions.length < 2) {
    return <EmptyState title="至少需要 2 个分区才能合并" hint="请先在分区管理页面创建分区。" />;
  }

  const srcName = partitions.find(p => p.id === sourceId)?.name;
  const tgtName = partitions.find(p => p.id === targetId)?.name;

  return (
    <div>
      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
      <div className="mb-4 text-sm text-text-muted">
        选择两个分区合并。源分区的所有 topic 和文章将转移到目标分区，源分区将被删除。
      </div>

      <div className="mb-4 flex items-end gap-3">
        <div className="flex-1">
          <Label className="mb-1.5 block text-xs text-text-muted">源分区（将被删除）</Label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择..." />
            </SelectTrigger>
            <SelectContent>
              {partitions.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.topic_count ?? 0}主题 · {p.article_count ?? 0}文章)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="pb-2 text-xl text-text-subtle">→</div>
        <div className="flex-1">
          <Label className="mb-1.5 block text-xs text-text-muted">目标分区（保留）</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择..." />
            </SelectTrigger>
            <SelectContent>
              {partitions.filter(p => p.id !== sourceId).map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.topic_count ?? 0}主题 · {p.article_count ?? 0}文章)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        variant="destructive"
        disabled={loading || !sourceId || !targetId || sourceId === targetId}
        onClick={() => setConfirmOpen(true)}
      >
        {loading ? '合并中...' : '确认合并'}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认合并分区</DialogTitle>
            <DialogDescription>
              确定将「{srcName}」合并到「{tgtName}」吗？
              <br />
              源分区将被删除，其下所有 topic 和文章转移到目标分区。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleMerge}>确认合并</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab 3: 分区拆分 ──

function SplitPartitionTab() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [selectedPartition, setSelectedPartition] = useState('');
  const [children, setChildren] = useState<PartitionChild | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const loadPartitions = useCallback(async () => {
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '加载分区失败：' + toErrorMessage(e) });
    }
  }, []);

  useEffect(() => { loadPartitions(); }, [loadPartitions]);

  const loadChildren = useCallback(async (pid: string) => {
    if (!pid) { setChildren(null); return; }
    try {
      const data = await getPartitionChildren(pid);
      setChildren(data);
      setSelectedTopics(new Set());
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '加载分区内容失败：' + toErrorMessage(e) });
    }
  }, []);

  const toggleTopic = (id: string) => {
    setSelectedTopics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSplit = async () => {
    if (selectedTopics.size === 0) { setNotice({ variant: 'destructive', message: '请至少选择一个 topic' }); return; }
    if (!newName.trim()) { setNotice({ variant: 'destructive', message: '请输入新分区名' }); return; }

    const count = selectedTopics.size;
    const name = newName.trim();
    setLoading(true);
    try {
      await splitPartition(selectedPartition, Array.from(selectedTopics), name, newDesc.trim());
      setNewName('');
      setNewDesc('');
      setSelectedTopics(new Set());
      await loadChildren(selectedPartition);
      setNotice({ variant: 'success', message: `拆分成功！已将 ${count} 个 topic 转移到新分区「${name}」` });
    } catch (e: unknown) {
      setNotice({ variant: 'destructive', message: '拆分失败：' + toErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
      <div className="mb-4 text-sm text-text-muted">
        从已有分区中选取部分 topic，创建新分区并转移。
      </div>

      <div className="mb-4">
        <Label className="mb-1.5 block text-xs text-text-muted">选择源分区</Label>
        <Select
          value={selectedPartition}
          onValueChange={(v) => { setSelectedPartition(v); loadChildren(v); }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="请选择分区..." />
          </SelectTrigger>
          <SelectContent>
            {partitions.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {children && (
        <>
          <div className="mb-4">
            <div className="mb-2 text-sm font-medium text-text">
              选择要拆分的 topic（{children.topics.length} 个可选，已选 {selectedTopics.size}）
            </div>
            {children.topics.length === 0 ? (
              <div className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-subtle">该分区下没有 topic</div>
            ) : (
              <div className="flex flex-col gap-1">
                {children.topics.map(t => (
                  <label
                    key={t.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      selectedTopics.has(t.id) ? 'bg-accent-soft' : 'bg-surface-2 hover:bg-surface-3',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-accent"
                      checked={selectedTopics.has(t.id)}
                      onChange={() => toggleTopic(t.id)}
                    />
                    <span className="font-medium text-text">{t.name}</span>
                    {t.description && <span className="text-text-subtle">— {t.description}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mb-3 flex flex-col gap-2">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="新分区名"
            />
            <Input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="新分区描述（可选）"
            />
          </div>

          <Button
            disabled={loading || selectedTopics.size === 0 || !newName.trim()}
            onClick={handleSplit}
          >
            {loading ? '拆分中...' : `拆分 ${selectedTopics.size} 个 topic 到新分区`}
          </Button>
        </>
      )}
    </div>
  );
}
