import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getClusteringProposal, updateClusteringProposal, applyClusteringProposal } from '../api/client';
import type { TagAction, ClusteringProposalJSON } from '../types/graph';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toErrorMessage } from '../lib/errors';

export default function ClusteringProposalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<ClusteringProposalJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [editedActions, setEditedActions] = useState<TagAction[]>([]);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    getClusteringProposal(id)
      .then((res) => {
        setProposal(res.proposal_json);
        setEditedActions(res.proposal_json.tag_actions || []);
      })
      .catch((e: unknown) => setError(toErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const toggleAction = (idx: number) => {
    setEditedActions(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      if (a.action === 'MERGE') {
        return { ...a, action: 'NEW' as const, target_topic_id: undefined, temp_id: `t_${Date.now()}` };
      }
      return a;
    }));
  };

  const updateActionField = (idx: number, field: string, value: string) => {
    setEditedActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  const removeAction = (idx: number) => {
    setEditedActions(prev => prev.filter((_, i) => i !== idx));
  };

  const removeTopicEdge = (idx: number) => {
    if (!proposal) return;
    setProposal(prev => prev ? { ...prev, topic_edges: prev.topic_edges.filter((_, i) => i !== idx) } : prev);
  };

  const handleApply = async () => {
    if (!id || !proposal) return;
    setApplying(true);
    setError('');
    try {
      const updated = { ...proposal, tag_actions: editedActions };
      await updateClusteringProposal(id, updated);
      const result = await applyClusteringProposal(id);
      if (result.status === 'applied') {
        navigate('/graph');
      } else {
        setError('应用失败: ' + JSON.stringify(result.errors || result.error));
      }
    } catch (e: unknown) {
      setError('应用失败: ' + toErrorMessage(e));
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[880px] p-6">
        <LoadingSkeleton count={4} />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="mx-auto max-w-[880px] p-6">
        <EmptyState title="未找到聚类提案" hint="该提案可能已被处理或链接有误" />
      </div>
    );
  }

  const mergeCount = editedActions.filter(a => a.action === 'MERGE').length;
  const newCount = editedActions.filter(a => a.action === 'NEW').length;
  const totalActions = editedActions.length;

  return (
    <div className="mx-auto max-w-[880px] p-6">
      {/* Header */}
      <div className="mb-5">
        <h2 className="mb-1 text-2xl font-bold text-text">主题聚类提案</h2>
        <div className="text-sm font-semibold text-text">{proposal.article_title}</div>
        {proposal.article_summary && (
          <div className="mt-1 text-sm text-text-muted">{proposal.article_summary}</div>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary card */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">聚类概览</CardTitle>
          <CardDescription>
            共 {totalActions} 个标签聚类建议
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {mergeCount > 0 && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                合并到已有 {mergeCount}
              </Badge>
            )}
            {newCount > 0 && (
              <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                新建主题 {newCount}
              </Badge>
            )}
          </div>
          {totalActions > 0 && (
            <div className="mt-3">
              <Progress value={(newCount / totalActions) * 100} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tag Actions */}
      <div className="mb-6 flex flex-col gap-3">
        <h3 className="text-base font-semibold text-text">
          标签聚类 ({editedActions.length})
        </h3>
        {editedActions.map((action, idx) => (
          <Card key={`action-${idx}`}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold">{action.tag_name}</CardTitle>
                  {action.action === 'MERGE' ? (
                    <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                      合并到已有
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                      新建主题
                    </Badge>
                  )}
                  <span className="text-xs text-text-subtle">
                    置信度 {(action.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeAction(idx)}
                >
                  删除
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {action.reason && (
                <p className="mb-2 text-sm text-text-muted">{action.reason}</p>
              )}

              {/* Matched candidates for MERGE actions — cluster container */}
              {action.action === 'MERGE' && action.matched_candidates?.length > 0 && (
                <div className="mt-2">
                  <div className="mb-2 text-xs text-text-muted">匹配到的已有主题:</div>
                  <div className="rounded-lg border border-dashed border-border p-2">
                    {action.matched_candidates.map((c, ci) => (
                      <div
                        key={`cand-${idx}-${ci}`}
                        className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1 text-xs"
                      >
                        <span className="font-medium text-text">{c.name}</span>
                        <span className="text-text-subtle">相似度 {(c.similarity * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    className="mt-2 text-amber-600"
                    onClick={() => toggleAction(idx)}
                  >
                    改为新建主题
                  </Button>
                </div>
              )}

              {/* Editable fields for NEW actions */}
              {action.action === 'NEW' && (
                <div className="mt-2">
                  <Input
                    value={action.proposed_description || ''}
                    onChange={e => updateActionField(idx, 'proposed_description', e.target.value)}
                    placeholder="输入新主题描述..."
                  />
                  {action.matched_candidates?.length > 0 && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="mt-2"
                      onClick={() => toggleAction(idx)}
                    >
                      改为合并到已有
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Topic Edges */}
      {proposal.topic_edges?.length > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <h3 className="text-base font-semibold text-text">
            主题间关系 ({proposal.topic_edges.length})
          </h3>
          {proposal.topic_edges.map((edge, idx) => (
            <Card key={`edge-${idx}`}>
              <CardContent className="flex flex-wrap items-center gap-2 py-3">
                <Badge variant="outline" className="font-medium">
                  {edge.source_tag}
                </Badge>
                <Badge variant="secondary" className="bg-primary/15 text-primary">
                  {edge.relation_type}
                </Badge>
                <Badge variant="outline" className="font-medium">
                  {edge.target_tag}
                </Badge>
                <span className="flex-1 text-xs text-text-muted">{edge.reason}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeTopicEdge(idx)}
                >
                  删除
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Apply button */}
      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={applying}
        size="lg"
        className="w-full"
      >
        {applying ? '正在写入全局图谱...' : '确认并写入全局图谱'}
      </Button>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认写入全局图谱</DialogTitle>
            <DialogDescription>
              将聚类结果写入全局知识图谱，此操作不可撤销。是否继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={applying}>
              取消
            </Button>
            <Button onClick={handleApply} disabled={applying}>
              {applying ? '正在写入...' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
