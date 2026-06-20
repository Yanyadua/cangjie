import React, { useEffect, useState } from 'react';
import { getDocuments, runEvaluation } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';

type StrategyResult = {
  strategy: string;
  label: string;
  error?: string;
  graph?: { summary?: string; nodes: any[]; edges: any[] };
  reconstructed?: string[];
  scores?: {
    recall: number;
    precision: number;
    f1: number;
    node_count: number;
    edge_count: number;
    isolated_nodes: number;
    evidence_coverage: number;
    matched?: Array<{ gt: string; reconstructed: string }>;
    missed?: string[];
    hallucinated?: string[];
  };
};

type EvalResponse = {
  document_title: string;
  ground_truth: string[];
  results: StrategyResult[];
};

const STRATEGY_LABELS: Record<string, string> = {
  concise: '简洁',
  standard: '标准',
  detailed: '详细',
  proposition: '命题化',
};

function scoreColor(score: number): string {
  if (score >= 0.85) return '#16a34a';
  if (score >= 0.6) return '#f59e0b';
  return '#dc2626';
}

export default function EvaluationLabPage() {
  const [documents, setDocuments] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState('');
  const [strategies, setStrategies] = useState<string[]>(['concise', 'standard', 'detailed']);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [previewStrategy, setPreviewStrategy] = useState<string | null>(null);

  useEffect(() => {
    getDocuments(0, 50).then((data: any) => {
      setDocuments(data.documents || data || []);
    }).catch(() => {});
  }, []);

  const toggleStrategy = (s: string) => {
    setStrategies(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleRun = async () => {
    if (!selectedDoc || strategies.length === 0) return;
    setRunning(true);
    setResult(null);
    try {
      const data = await runEvaluation(selectedDoc, strategies);
      setResult(data);
    } catch (e: any) {
      alert('评估失败: ' + (e?.message || '未知错误'));
    } finally {
      setRunning(false);
    }
  };

  const convertGraph = (graph: any) => {
    const nodes: GraphNode[] = (graph?.nodes || []).map((n: any) => ({
      id: n.temp_id || n.id, nodeType: n.node_type, name: n.name, description: n.description,
    }));
    const edges: GraphEdge[] = (graph?.edges || []).map((e: any) => ({
      id: e.temp_id || e.id, source: e.source, target: e.target,
      relationType: e.relation_type, confidence: e.confidence,
    }));
    return { nodes, edges };
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      <h2 style={{ margin: '0 0 20px 0' }}>图谱评估实验室</h2>

      {/* 配置区 */}
      <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1e293b' }}>选择文章</label>
          <select value={selectedDoc} onChange={e => setSelectedDoc(e.target.value)}
            style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}>
            <option value="">请选择...</option>
            {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1e293b' }}>策略档位</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['concise', 'standard', 'detailed', 'proposition'].map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={strategies.includes(s)} onChange={() => toggleStrategy(s)} />
                {STRATEGY_LABELS[s]}
              </label>
            ))}
          </div>
        </div>

        <button onClick={handleRun} disabled={running || !selectedDoc || strategies.length === 0}
          style={{
            padding: '10px 24px', background: (running || !selectedDoc || strategies.length === 0) ? '#cbd5e1' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
          }}>
          {running ? '评估中...' : '开始评估'}
        </button>
      </div>

      {/* 结果区 */}
      {result && (
        <>
          {/* Ground Truth */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>Ground Truth 知识点 ({result.ground_truth.length})</h3>
            {result.ground_truth.map((kp, i) => (
              <div key={i} style={{ fontSize: 13, color: '#475569', padding: '3px 0', paddingLeft: 12, borderLeft: '2px solid #e2e8f0' }}>
                {kp}
              </div>
            ))}
          </div>

          {/* 评分对比表 */}
          {result.results.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>评分对比</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>指标</th>
                    {result.results.map(r => (
                      <th key={r.strategy} style={{ padding: '8px 12px', textAlign: 'center', borderBottom: '2px solid #e2e8f0' }}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { key: 'recall', label: '召回率', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                    { key: 'precision', label: '准确率', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                    { key: 'f1', label: 'F1', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                    { key: 'node_count', label: '节点数', format: (v: number) => String(v), colored: false },
                    { key: 'edge_count', label: '边数', format: (v: number) => String(v), colored: false },
                    { key: 'isolated_nodes', label: '孤立节点', format: (v: number) => String(v), colored: false },
                    { key: 'evidence_coverage', label: '证据覆盖', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: false },
                  ]).map(row => (
                    <tr key={row.key}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 500 }}>{row.label}</td>
                      {result.results.map(r => {
                        const val = r.scores?.[row.key as keyof typeof r.scores] as number;
                        return (
                          <td key={r.strategy} style={{
                            padding: '8px 12px', textAlign: 'center', borderBottom: '1px solid #e2e8f0',
                            color: row.colored && typeof val === 'number' ? scoreColor(val) : '#1e293b',
                            fontWeight: row.colored ? 600 : 400,
                          }}>
                            {r.error ? '—' : (typeof val === 'number' ? row.format(val) : '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 差异详情 */}
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>差异详情</h3>
            {result.results.map(r => (
              <div key={r.strategy} style={{ marginBottom: 8, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                <button onClick={() => setExpandedDetail(expandedDetail === r.strategy ? null : r.strategy)}
                  style={{ width: '100%', padding: '10px 14px', background: '#f8fafc', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                  {r.label} {expandedDetail === r.strategy ? '▼' : '▶'}
                </button>
                {expandedDetail === r.strategy && (
                  <div style={{ padding: 12 }}>
                    {r.scores?.missed && r.scores.missed.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>丢失的知识点 ({r.scores.missed.length})</div>
                        {r.scores.missed.map((m, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#dc2626', padding: '2px 0', paddingLeft: 12 }}>• {m}</div>
                        ))}
                      </div>
                    )}
                    {r.scores?.hallucinated && r.scores.hallucinated.length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>编造的知识点 ({r.scores.hallucinated.length})</div>
                        {r.scores.hallucinated.map((h, i) => (
                          <div key={i} style={{ fontSize: 12, color: '#f59e0b', padding: '2px 0', paddingLeft: 12 }}>• {h}</div>
                        ))}
                      </div>
                    )}
                    {!r.scores?.missed?.length && !r.scores?.hallucinated?.length && (
                      <div style={{ fontSize: 12, color: '#16a34a' }}>无差异，完美匹配</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 图谱预览 */}
          <div>
            <h3 style={{ fontSize: 15, margin: '0 0 8px 0' }}>图谱预览</h3>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {result.results.map(r => (
                <button key={r.strategy} onClick={() => setPreviewStrategy(previewStrategy === r.strategy ? null : r.strategy)}
                  style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', border: 'none',
                    background: previewStrategy === r.strategy ? '#3b82f6' : '#f1f5f9',
                    color: previewStrategy === r.strategy ? '#fff' : '#64748b',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            {previewStrategy && (() => {
              const r = result.results.find(x => x.strategy === previewStrategy);
              if (!r?.graph) return null;
              return (
                <div style={{ height: 400, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                  <GraphEditor graphData={convertGraph(r.graph)} editable={false} />
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
