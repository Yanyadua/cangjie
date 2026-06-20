import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  runStage1, saveStage1,
  runStage2, saveStage2,
  runStage3, saveStage3,
  finalizeExtraction,
} from '../api/client';
import type { NodeType, RelationType } from '../types/graph';
import { NODE_TYPES, RELATION_TYPES } from '../types/graph';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { NodeCard } from '../components/NodeCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toErrorMessage } from '../lib/errors';

type Concept = { name: string; type: string; description: string };
type NodeItem = { temp_id: string; node_type: NodeType; name: string; description: string };
type EdgeItem = { temp_id: string; source: string; target: string; relation_type: RelationType; confidence: number; evidence: string };

const STEP_LABELS = ['核心概念', '实体节点', '关系抽取', '确认完成'];

export default function ExtractionWizardPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState(0); // 0=not started, 1-3=stages, 4=done
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Stage data
  const [summary, setSummary] = useState('');
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    // Auto-start stage 1
    handleRunStage1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunStage1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await runStage1(documentId);
      setSummary(res.data.summary || '');
      setConcepts(res.data.core_concepts || []);
      setStep(1);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '阶段1失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStage1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStage1(documentId, { summary, core_concepts: concepts });
      const res = await runStage2(documentId);
      setNodes(res.data.nodes || []);
      setStep(2);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '阶段2失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStage2 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStage2(documentId, { nodes });
      const res = await runStage3(documentId);
      setEdges(res.data.edges || []);
      setStep(3);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '阶段3失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStage3(documentId, { edges });
      const res = await finalizeExtraction(documentId);
      navigate(`/draft/${res.draft_graph_id}`);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '完成失败');
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  };

  // ── Concept helpers ──
  const updateConcept = (idx: number, field: string, value: string) => {
    setConcepts(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };
  const addConcept = () => setConcepts(prev => [...prev, { name: '', type: 'concept', description: '' }]);
  const removeConcept = (idx: number) => setConcepts(prev => prev.filter((_, i) => i !== idx));

  // ── Node helpers ──
  const updateNode = (idx: number, field: string, value: string) => {
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  };
  const addNode = () => {
    const id = `n_${Date.now()}`;
    setNodes(prev => [...prev, { temp_id: id, node_type: 'concept' as NodeType, name: '', description: '' }]);
  };
  const removeNode = (idx: number) => {
    const removedId = nodes[idx].temp_id;
    setNodes(prev => prev.filter((_, i) => i !== idx));
    setEdges(prev => prev.filter(e => e.source !== removedId && e.target !== removedId));
  };

  // ── Edge helpers ──
  const updateEdge = (idx: number, field: string, value: string | number) => {
    setEdges(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };
  const addEdge = () => {
    const id = `e_${Date.now()}`;
    setEdges(prev => [...prev, {
      temp_id: id, source: nodes[0]?.temp_id || '', target: nodes[1]?.temp_id || '',
      relation_type: 'related_to' as RelationType, confidence: 0.8, evidence: '',
    }]);
  };
  const removeEdge = (idx: number) => setEdges(prev => prev.filter((_, i) => i !== idx));

  // Map step to progress percentage
  const progressValue = step === 0 ? 0 : (step / 4) * 100;

  return (
    <div className="mx-auto max-w-[880px] p-6">
      {/* Progress bar */}
      <div className="mb-4">
        <Progress value={progressValue} />
      </div>

      {/* Stage tabs (read-only indicator) */}
      <div className="mb-5 flex items-center gap-1">
        {STEP_LABELS.map((label, i) => {
          const stageNum = i + 1;
          const isActive = step === stageNum;
          const isDone = step > stageNum;
          return (
            <div key={`tab-${i}`} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ' +
                  (isActive
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                      ? 'bg-primary/20 text-primary'
                      : 'bg-surface-2 text-text-subtle')
                }
              >
                {isDone ? '✓' : stageNum}
              </div>
              <span
                className={
                  'text-center text-xs ' +
                  (isActive ? 'font-semibold text-text' : 'text-text-muted')
                }
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading state for step 0 */}
      {step === 0 && !loading && !error && (
        <LoadingSkeleton count={3} />
      )}
      {step === 0 && loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <div className="text-base text-text-muted">正在分析文章，抽取核心概念...</div>
          <LoadingSkeleton count={2} />
        </div>
      )}

      {/* Stage 1: Summary + Concepts */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">阶段1：摘要与核心概念</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <Label className="mb-1.5 block text-[13px] font-medium">文章摘要</Label>
              <Textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                rows={3}
                className="resize-y"
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <Label className="text-[13px] font-medium">核心概念 ({concepts.length})</Label>
              <Button variant="outline" size="sm" onClick={addConcept}>
                + 添加
              </Button>
            </div>

            {loading && <LoadingSkeleton count={2} />}

            {!loading && concepts.map((c, idx) => (
              <Card key={`concept-${idx}`} className="gap-0 py-3">
                <CardContent className="flex items-center gap-2">
                  <Input
                    value={c.name}
                    onChange={e => updateConcept(idx, 'name', e.target.value)}
                    placeholder="名称"
                    className="flex-[2]"
                  />
                  <select
                    value={c.type}
                    onChange={e => updateConcept(idx, 'type', e.target.value)}
                    className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Input
                    value={c.description}
                    onChange={e => updateConcept(idx, 'description', e.target.value)}
                    placeholder="描述"
                    className="flex-[3]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeConcept(idx)}
                  >
                    删除
                  </Button>
                </CardContent>
              </Card>
            ))}

            <div className="flex justify-end">
              <Button onClick={handleSaveStage1} disabled={loading} size="lg">
                {loading ? '处理中...' : '确认并进入阶段2'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 2: Nodes */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">阶段2：实体与观点节点</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-muted">节点数: {nodes.length}</span>
              <Button variant="outline" size="sm" onClick={addNode}>
                + 添加节点
              </Button>
            </div>

            {loading && <LoadingSkeleton count={3} />}

            {!loading && nodes.map((n, idx) => (
              <Card key={`node-${n.temp_id}`} className="gap-0 py-3">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <NodeCard
                        nodeType={n.node_type}
                        name={n.name || '(未命名)'}
                        description={n.description}
                        meta={
                          <select
                            value={n.node_type}
                            onChange={e => updateNode(idx, 'node_type', e.target.value)}
                            className="h-6 rounded border border-input bg-transparent px-1.5 text-[11px] outline-none"
                          >
                            {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeNode(idx)}
                    >
                      删除
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={n.name}
                      onChange={e => updateNode(idx, 'name', e.target.value)}
                      placeholder="名称"
                      className="flex-[2]"
                    />
                    <Input
                      value={n.description}
                      onChange={e => updateNode(idx, 'description', e.target.value)}
                      placeholder="描述"
                      className="flex-[3]"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                上一步
              </Button>
              <Button onClick={handleSaveStage2} disabled={loading}>
                {loading ? '处理中...' : '下一步'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage 3: Edges */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">阶段3：关系抽取</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-muted">关系数: {edges.length}</span>
              <Button variant="outline" size="sm" onClick={addEdge}>
                + 添加关系
              </Button>
            </div>

            {loading && <LoadingSkeleton count={2} />}

            {!loading && edges.map((e, idx) => (
              <Card key={`edge-${e.temp_id}`} className="gap-0 py-3">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={e.source}
                      onChange={ev => updateEdge(idx, 'source', ev.target.value)}
                      className="h-9 flex-[2] rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="">选择源节点</option>
                      {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                    </select>
                    <Badge variant="secondary" className="bg-primary/15 text-primary">
                      <select
                        value={e.relation_type}
                        onChange={ev => updateEdge(idx, 'relation_type', ev.target.value)}
                        className="border-none bg-transparent text-xs outline-none"
                      >
                        {RELATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Badge>
                    <select
                      value={e.target}
                      onChange={ev => updateEdge(idx, 'target', ev.target.value)}
                      className="h-9 flex-[2] rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="">选择目标节点</option>
                      {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                    </select>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={e.confidence}
                      onChange={ev => updateEdge(idx, 'confidence', parseFloat(ev.target.value))}
                      className="w-16 text-center"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeEdge(idx)}
                    >
                      删除
                    </Button>
                  </div>
                  <Input
                    value={e.evidence}
                    onChange={ev => updateEdge(idx, 'evidence', ev.target.value)}
                    placeholder="证据（引用原文）"
                  />
                </CardContent>
              </Card>
            ))}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                上一步
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={loading}>
                完成抽取
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog for finalize */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认完成抽取</DialogTitle>
            <DialogDescription>
              将保存所有阶段数据并生成图谱草稿。此操作将调用后端进行校验和合并，可能需要一些时间。是否继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={loading}>
              取消
            </Button>
            <Button onClick={handleFinalize} disabled={loading}>
              {loading ? '校验中...' : '确认并生成图谱'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
