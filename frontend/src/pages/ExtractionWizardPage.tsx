import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  runStage1, saveStage1,
  runStage2, saveStage2,
  runStage3, saveStage3,
  finalizeExtraction,
} from '../api/client';
import type { NodeType, RelationType } from '../types/graph';
import { NODE_TYPES, RELATION_TYPES, NODE_COLORS } from '../types/graph';

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

  useEffect(() => {
    // Auto-start stage 1
    handleRunStage1();
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '阶段1失败');
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '阶段2失败');
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '阶段3失败');
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
    } catch (e: any) {
      setError(e?.response?.data?.detail || '完成失败');
    } finally {
      setLoading(false);
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

  const nodeNameMap = Object.fromEntries(nodes.map(n => [n.temp_id, n.name]));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{
              height: 6, background: step > i ? '#10b981' : step === i + 1 ? '#3b82f6' : '#e2e8f0',
              borderRadius: i === 0 ? 3 : 0,
            }} />
            <div style={{
              fontSize: 12, marginTop: 4, textAlign: 'center',
              color: step === i + 1 ? '#3b82f6' : step > i ? '#10b981' : '#94a3b8',
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

      {/* Stage 1: Summary + Concepts */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>阶段1：摘要与核心概念</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>文章摘要</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>核心概念 ({concepts.length})</label>
            <button onClick={addConcept} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加</button>
          </div>
          {concepts.map((c, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input value={c.name} onChange={e => updateConcept(idx, 'name', e.target.value)} placeholder="名称"
                style={{ flex: 2, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <select value={c.type} onChange={e => updateConcept(idx, 'type', e.target.value)}
                style={{ flex: 1, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}>
                {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={c.description} onChange={e => updateConcept(idx, 'description', e.target.value)} placeholder="描述"
                style={{ flex: 3, padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              <button onClick={() => removeConcept(idx)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer' }}>删除</button>
            </div>
          ))}

          <div style={{ marginTop: 20, textAlign: 'right' }}>
            <button onClick={handleSaveStage1} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '处理中...' : '确认并进入阶段2'}
            </button>
          </div>
        </div>
      )}

      {/* Stage 2: Nodes */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>阶段2：实体与观点节点</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>节点数: {nodes.length}</span>
            <button onClick={addNode} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加节点</button>
          </div>
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
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setStep(1)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>返回阶段1</button>
            <button onClick={handleSaveStage2} disabled={loading}
              style={{ padding: '10px 32px', background: loading ? '#94a3b8' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              {loading ? '处理中...' : '确认并进入阶段3'}
            </button>
          </div>
        </div>
      )}

      {/* Stage 3: Edges */}
      {step === 3 && (
        <div>
          <h3 style={{ marginBottom: 12 }}>阶段3：关系抽取</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>关系数: {edges.length}</span>
            <button onClick={addEdge} style={{ padding: '4px 12px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>+ 添加关系</button>
          </div>
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
            <button onClick={() => setStep(2)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>返回阶段2</button>
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
          <div style={{ fontSize: 16, marginBottom: 8 }}>正在分析文章，抽取核心概念...</div>
        </div>
      )}
    </div>
  );
}
