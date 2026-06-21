import { useEffect, useState, useCallback } from 'react';
import { listPartitions, createPartition, updatePartition, deletePartition } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { toErrorMessage } from '@/lib/errors';

type Partition = {
  id: string;
  name: string;
  description?: string;
  article_count?: number;
  topic_count?: number;
};

export default function PartitionsPage() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Partition | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createPartition(newName.trim(), newDesc.trim());
      setNewName('');
      setNewDesc('');
      await load();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await updatePartition(id, { name: editName.trim(), description: editDesc });
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deletePartition(target.id);
      await load();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  };

  const startEdit = (p: Partition) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditDesc(p.description || '');
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-5 text-xl font-semibold text-text">分区管理</h2>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 新建分区 */}
      <Card className="mb-6 gap-4 py-4">
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm font-medium text-text">新建分区</div>
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="分区名（如：智能体）"
          />
          <Input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="分区描述（可选）"
          />
          <div>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              创建
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 分区列表 */}
      {loading ? (
        <LoadingSkeleton count={3} />
      ) : partitions.length === 0 ? (
        <EmptyState
          title="还没有分区"
          hint="导入文章后系统会自动建议分区，也可以在这里手动创建。"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {partitions.map(p => (
            <Card key={p.id} className="gap-3 border-l-[3px] border-l-accent py-4">
              <CardContent>
                {editingId === p.id ? (
                  /* 编辑模式 */
                  <div className="flex flex-col gap-3">
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                    <Input
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      placeholder="分区描述..."
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleUpdate(p.id)}>保存</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>取消</Button>
                    </div>
                  </div>
                ) : (
                  /* 展示模式 */
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-text">{p.name}</span>
                        <span className="text-xs text-text-subtle">
                          {p.topic_count ?? 0} 主题 · {p.article_count ?? 0} 文章
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                    {p.description && (
                      <div className="text-sm leading-relaxed text-text-muted">{p.description}</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 删除确认弹窗 */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除分区</DialogTitle>
            <DialogDescription>
              确定删除分区「{deleteTarget?.name}」吗？分区下的文章和主题不会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
