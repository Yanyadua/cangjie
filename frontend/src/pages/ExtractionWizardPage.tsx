import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  runStep1, saveStep1,
  streamStep2, saveStep2,
  finalizeExtraction,
} from '../api/client';
import type { NodeType, RelationType } from '../types/graph';
import { NODE_TYPES, RELATION_TYPES, NODE_COLORS } from '../types/graph';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SELECT_CLASSNAME } from '../lib/utils';
import { toErrorMessage } from '../lib/errors';

type Tag = { name: string; confidence: number };
type Claim = { name: string; description: string };
type NodeItem = { temp_id: string; node_type: NodeType; name: string; description: string };
type EdgeItem = { temp_id: string; source: string; target: string; relation_type: RelationType; confidence: number; evidence: string };

const STEP_LABELS = ['主题骨架', '图谱展开', '确认完成'];

export default function ExtractionWizardPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState(0); // 0=loading, 1=skeleton, 2=expanded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);
  const chunkBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 1: Skeleton data
  const [summary, setSummary] = useState('');
  const [topicTags, setTopicTags] = useState<Tag[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);

  // Step 2: Expanded data
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [extractionMode, setExtractionMode] = useState<'standard' | 'proposition'>('proposition');

  useEffect(() => {
    handleRunStep1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunStep1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await runStep1(documentId);
      setSummary(res.data.summary || '');
      setTopicTags(res.data.topic_tags || []);
      setClaims(res.data.core_claims || []);
      setStep(1);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '骨架抽取失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStep1 = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    setStreamingText('');
    chunkBufferRef.current = '';
    setIsStreaming(true);
    try {
      await saveStep1(documentId, { summary, topic_tags: topicTags, core_claims: claims });
      const res = await streamStep2(documentId, (chunk) => {
        chunkBufferRef.current += chunk;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            setStreamingText((prev) => prev + chunkBufferRef.current);
            chunkBufferRef.current = '';
            flushTimerRef.current = null;
          }, 80);
        }
      }, extractionMode);
      // Flush any remaining buffered text
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (chunkBufferRef.current) {
        setStreamingText((prev) => prev + chunkBufferRef.current);
        chunkBufferRef.current = '';
      }
      setNodes((res.data.nodes || []) as NodeItem[]);
      setEdges((res.data.edges || []) as EdgeItem[]);
      setStep(2);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '展开失败');
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  const handleFinalize = async () => {
    if (!documentId) return;
    setLoading(true);
    setError('');
    try {
      await saveStep2(documentId, { nodes, edges });
      const res = await finalizeExtraction(documentId);
      navigate(`/draft/${res.draft_graph_id}`);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '完成失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamingText]);

  // ── Tag helpers ──
  const updateTag = (idx: number, value: string) => {
    setTopicTags(prev => prev.map((t, i) => i === idx ? { ...t, name: value } : t));
  };
  const addTag = () => setTopicTags(prev => [...prev, { name: '', confidence: 0.8 }]);
  const removeTag = (idx: number) => setTopicTags(prev => prev.filter((_, i) => i !== idx));

  // ── Claim helpers ──
  const updateClaim = (idx: number, field: string, value: string) => {
    setClaims(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };
  const addClaim = () => setClaims(prev => [...prev, { name: '', description: '' }]);
  const removeClaim = (idx: number) => setClaims(prev => prev.filter((_, i) => i !== idx));

  // ── Node helpers ──
  const updateNode = (idx: number, field: string, value: string) => {
    setNodes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  };
  const addNode = () => {
    const id = `n_${crypto.randomUUID()}`;
    setNodes(prev => [...prev, { temp_id: id, node_type: 'concept' as NodeType, name: '', description: '' }]);
  };
  const removeNode = (idx: number) => {
    setNodes(prev => {
      if (idx < 0 || idx >= prev.length) return prev;
      const removedId = prev[idx].temp_id;
      setEdges(edges => edges.filter(e => e.source !== removedId && e.target !== removedId));
      return prev.filter((_, i) => i !== idx);
    });
  };

  // ── Edge helpers ──
  const updateEdge = (idx: number, field: string, value: string | number) => {
    setEdges(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };
  const addEdge = () => {
    const id = `e_${crypto.randomUUID()}`;
    setEdges(prev => [...prev, {
      temp_id: id, source: nodes[0]?.temp_id || '', target: nodes[1]?.temp_id || '',
      relation_type: 'related_to' as RelationType, confidence: 0.8, evidence: '',
    }]);
  };
  const removeEdge = (idx: number) => setEdges(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="mx-auto h-[calc(100vh-56px)] max-w-[900px] overflow-y-auto p-6">
      {/* Progress bar */}
      <div className="mb-6 flex gap-0">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex-1">
            <div
              className="h-1.5 rounded-l-sm"
              style={{
                background: step > i + 1 ? 'var(--success, #10b981)' : step === i + 1 ? 'var(--accent)' : 'var(--border)',
              }}
            />
            <div
              className="mt-1 text-center text-xs"
              style={{
                color: step === i + 1 ? 'var(--accent)' : step > i + 1 ? 'var(--success, #10b981)' : 'var(--text-subtle)',
                fontWeight: step === i + 1 ? 600 : 400,
              }}
            >
              {i + 1}. {label}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Streaming panel */}
      {isStreaming && (
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-800">
          <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 text-xs text-slate-400">
            <span className="inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
            正在展开知识图谱...
          </div>
          <div
            ref={streamRef}
            className="max-h-[360px] overflow-y-auto bg-slate-950 p-3 font-mono text-xs leading-relaxed text-cyan-300 [white-space:pre-wrap] [word-break:break-word]"
          >
            {streamingText || <span className="text-slate-600">等待 LLM 响应...</span>}
            <span className="text-emerald-500">▋</span>
          </div>
        </div>
      )}

      {/* Step 1: Skeleton */}
      {step === 1 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-text">主题骨架</h3>

          {/* Summary */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-text">文章摘要</label>
            <Textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
              className="resize-y" />
          </div>

          {/* Topic Tags */}
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-text">主题标签 ({topicTags.length})</label>
            <Button variant="outline" size="sm" onClick={addTag}>+ 添加</Button>
          </div>
          {topicTags.map((t, idx) => (
            <div key={idx} className="mb-1.5 flex items-center gap-2">
              <div className="size-2 shrink-0 rounded-full bg-violet-500" />
              <Input value={t.name} onChange={e => updateTag(idx, e.target.value)} placeholder="标签名" className="flex-1" />
              <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => removeTag(idx)}>删除</Button>
            </div>
          ))}

          {/* Core Claims */}
          <div className="mb-2 mt-5 flex items-center justify-between">
            <label className="text-sm font-medium text-text">核心主张 ({claims.length})</label>
            <Button variant="outline" size="sm" onClick={addClaim}>+ 添加</Button>
          </div>
          {claims.map((c, idx) => (
            <div key={idx} className="mb-1.5 rounded-md border border-border border-l-[3px] border-l-accent bg-surface-2 p-2.5">
              <Input value={c.name} onChange={e => updateClaim(idx, 'name', e.target.value)} placeholder="主张名称" className="mb-1 font-semibold" />
              <Input value={c.description} onChange={e => updateClaim(idx, 'description', e.target.value)} placeholder="简短说明" className="text-xs" />
              <Button variant="ghost" size="xs" className="mt-1 text-destructive hover:text-destructive" onClick={() => removeClaim(idx)}>删除</Button>
            </div>
          ))}

          {/* 抽取模式切换 */}
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
            <div className="mb-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">抽取模式</div>
            <div className="mb-2 flex gap-4">
              <label className="flex cursor-pointer items-center gap-1 text-sm text-text">
                <input type="radio" checked={extractionMode === 'proposition'} onChange={() => setExtractionMode('proposition')} />
                命题化（推荐 · 每个 claim 展开 2-5 个自包含命题，还原度更高）
              </label>
              <label className="flex cursor-pointer items-center gap-1 text-sm text-text">
                <input type="radio" checked={extractionMode === 'standard'} onChange={() => setExtractionMode('standard')} />
                标准（topic + claim + 实体，适合抽象理论文）
              </label>
            </div>
            <div className="text-xs leading-relaxed text-text-muted">
              💡 命题化在新闻/综述/工程类文章上 F1 提升 20-50%；
              高度抽象的理论文（纯数学/纯概念关系）建议用标准模式。
            </div>
          </div>

          <div className="mt-5 text-right">
            <Button onClick={handleSaveStep1} disabled={loading} size="lg">
              {loading ? '生成中...' : '确认骨架并展开图谱'}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Expanded Graph */}
      {step === 2 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-text">图谱展开结果</h3>

          {/* Nodes */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-text-muted">节点数: {nodes.length} | 关系数: {edges.length}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addNode}>+ 添加节点</Button>
              <Button variant="outline" size="sm" onClick={addEdge}>+ 添加关系</Button>
            </div>
          </div>

          {/* Node list */}
          {nodes.map((n, idx) => (
            <div key={n.temp_id} className="mb-1.5 flex items-center gap-2 border-l-[3px] pl-2"
              style={{ borderLeftColor: NODE_COLORS[n.node_type] || 'var(--border)' }}>
              <select value={n.node_type} onChange={e => updateNode(idx, 'node_type', e.target.value)}
                className={`${SELECT_CLASSNAME} w-[110px] text-xs`}>
                {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input value={n.name} onChange={e => updateNode(idx, 'name', e.target.value)} placeholder="名称" className="flex-[2]" />
              <Input value={n.description} onChange={e => updateNode(idx, 'description', e.target.value)} placeholder="描述" className="flex-[3]" />
              <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => removeNode(idx)}>删除</Button>
            </div>
          ))}

          {/* Edge list */}
          <h4 className="mb-2 mt-4 text-sm text-text-muted">关系列表</h4>
          {edges.map((e, idx) => (
            <div key={e.temp_id} className="mb-1.5 rounded-md border border-border bg-surface-2 p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <select value={e.source} onChange={ev => updateEdge(idx, 'source', ev.target.value)}
                  className={`${SELECT_CLASSNAME} flex-[2] text-xs`}>
                  <option value="">选择源节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <select value={e.relation_type} onChange={ev => updateEdge(idx, 'relation_type', ev.target.value)}
                  className={`${SELECT_CLASSNAME} flex-1 text-xs`} style={{ color: 'var(--accent)' }}>
                  {RELATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={e.target} onChange={ev => updateEdge(idx, 'target', ev.target.value)}
                  className={`${SELECT_CLASSNAME} flex-[2] text-xs`}>
                  <option value="">选择目标节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <Input type="number" min={0} max={1} step={0.05} value={e.confidence}
                  onChange={ev => updateEdge(idx, 'confidence', parseFloat(ev.target.value))}
                  className="w-[60px] text-center text-xs" />
                <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => removeEdge(idx)}>删除</Button>
              </div>
              <Input value={e.evidence} onChange={ev => updateEdge(idx, 'evidence', ev.target.value)} placeholder="证据（引用原文）" className="text-xs" />
            </div>
          ))}

          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>返回骨架</Button>
            <Button onClick={handleFinalize} disabled={loading} size="lg"
              style={{ background: loading ? undefined : 'var(--success, #10b981)' }}>
              {loading ? '校验中...' : '确认并生成图谱'}
            </Button>
          </div>
        </div>
      )}

      {/* Loading */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center p-16 text-text-muted">
          <div className="mb-2 text-base">正在分析文章，提取主题骨架...</div>
        </div>
      )}
    </div>
  );
}
