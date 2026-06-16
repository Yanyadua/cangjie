import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  runStep1, saveStep1,
  streamStep2, saveStep2,
  finalizeExtraction,
} from '../api/client';
import type { NodeType, RelationType } from '../types/graph';
import { NODE_TYPES, RELATION_TYPES, NODE_COLORS } from '../types/graph';

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

  useEffect(() => {
    handleRunStep1();
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '骨架抽取失败');
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
      });
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '展开失败');
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '完成失败');
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

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{
              height: 6, background: step > i + 1 ? '#10b981' : step === i + 1 ? '#3b82f6' : '#e2e8f0',
              borderRadius: i === 0 ? 3 : 0,
            }} />
            <div style={{
              fontSize: 12, marginTop: 4, textAlign: 'center',
              color: step === i + 1 ? '#3b82f6' : step > i + 1 ? '#10b981' : '#94a3b8',
              fontWeight: step === i + 1 ? 600 : 400,
            }}>
              {i + 1}. {label}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 16 }}>{error}</div>
      )}

      {/* Streaming panel */}
      {isStreaming && (
        <div style={{
          marginBottom: 16,
          border: '1px solid #1e293b',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', background: '#1e293b', color: '#94a3b8', fontSize: 12,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#10b981',
              display: 'inline-block', animation: 'pulse 1s infinite',
            }} />
            正在展开知识图谱...
          </div>
          <div
            ref={streamRef}
            style={{
              maxHeight: 360, overflowY: 'auto', background: '#0f172a',
              padding: 12, fontFamily: "'Menlo', 'Monaco', monospace",
              fontSize: 12, lineHeight: 1.6, color: '#a5f3fc',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {streamingText || <span style={{ color: '#475569' }}>等待 LLM 响应...</span>}
            <span style={{ color: '#10b981' }}>▋</span>
          </div>
        </div>
      )}

      {/* Step 1: Skeleton */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>主题骨架</h3>

          {/* Summary */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>文章摘要</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, resize: 'vertical' }} />
          </div>

          {/* Topic Tags */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>主题标签 ({topicTags.length})</label>
            <button onClick={addTag} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加</button>
          </div>
          {topicTags.map((t, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', flexShrink: 0 }} />
              <input value={t.name} onChange={e => updateTag(idx, e.target.value)} placeholder="标签名"
                style={{ flex: 1, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <button onClick={() => removeTag(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
            </div>
          ))}

          {/* Core Claims */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>核心主张 ({claims.length})</label>
            <button onClick={addClaim} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加</button>
          </div>
          {claims.map((c, idx) => (
            <div key={idx} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', borderLeft: '3px solid #f97316' }}>
              <input value={c.name} onChange={e => updateClaim(idx, 'name', e.target.value)} placeholder="主张名称"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, fontWeight: 600, marginBottom: 4 }} />
              <input value={c.description} onChange={e => updateClaim(idx, 'description', e.target.value)} placeholder="简短说明"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }} />
              <button onClick={() => removeClaim(idx)} style={{ marginTop: 4, padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>删除</button>
            </div>
          ))}

          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button onClick={handleSaveStep1} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '生成中...' : '确认骨架并展开图谱'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Expanded Graph */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>图谱展开结果</h3>

          {/* Nodes */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>节点数: {nodes.length} | 关系数: {edges.length}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addNode} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加节点</button>
              <button onClick={addEdge} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加关系</button>
            </div>
          </div>

          {/* Node list */}
          {nodes.map((n, idx) => (
            <div key={n.temp_id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center',
              borderLeft: `3px solid ${NODE_COLORS[n.node_type] || '#94a3b8'}`, paddingLeft: 8 }}>
              <select value={n.node_type} onChange={e => updateNode(idx, 'node_type', e.target.value)}
                style={{ width: 110, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={n.name} onChange={e => updateNode(idx, 'name', e.target.value)} placeholder="名称"
                style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <input value={n.description} onChange={e => updateNode(idx, 'description', e.target.value)} placeholder="描述"
                style={{ flex: 3, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <button onClick={() => removeNode(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
            </div>
          ))}

          {/* Edge list */}
          <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13, color: '#64748b' }}>关系列表</h4>
          {edges.map((e, idx) => (
            <div key={e.temp_id} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <select value={e.source} onChange={ev => updateEdge(idx, 'source', ev.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                  <option value="">选择源节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <select value={e.relation_type} onChange={ev => updateEdge(idx, 'relation_type', ev.target.value)}
                  style={{ flex: 1, padding: 6, border: '1px solid #3b82f6', borderRadius: 4, fontSize: 12, color: '#3b82f6' }}>
                  {RELATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={e.target} onChange={ev => updateEdge(idx, 'target', ev.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}>
                  <option value="">选择目标节点</option>
                  {nodes.map(n => <option key={n.temp_id} value={n.temp_id}>{n.name}</option>)}
                </select>
                <input type="number" min={0} max={1} step={0.05} value={e.confidence}
                  onChange={ev => updateEdge(idx, 'confidence', parseFloat(ev.target.value))}
                  style={{ width: 60, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, textAlign: 'center' }} />
                <button onClick={() => removeEdge(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
              </div>
              <input value={e.evidence} onChange={ev => updateEdge(idx, 'evidence', ev.target.value)} placeholder="证据（引用原文）"
                style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }} />
            </div>
          ))}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>返回骨架</button>
            <button onClick={handleFinalize} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '校验中...' : '确认并生成图谱'}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {step === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>正在分析文章，提取主题骨架...</div>
        </div>
      )}
    </div>
  );
}
