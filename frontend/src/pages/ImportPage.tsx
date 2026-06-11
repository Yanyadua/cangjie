import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importDocument, getDraftGraph } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';
import { NODE_COLORS } from '../types/graph';

type PreviewData = {
  draftGraphId: string;
  summary: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export default function ImportPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);

  const handleImport = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题和正文不能为空');
      return;
    }
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const result = await importDocument({
        title,
        source_type: sourceType || undefined,
        source_url: sourceUrl || undefined,
        author: author || undefined,
        content,
      });
      // Navigate to extraction wizard
      navigate(`/extract/${result.document_id}`);

      // Fetch the generated draft graph to show preview
      const dg = await getDraftGraph(result.draft_graph_id);
      const gj = dg.graph_json;
      const nodes: GraphNode[] = (gj.nodes || []).map((n: any) => ({
        id: n.temp_id || n.id,
        nodeType: n.node_type,
        name: n.name,
        description: n.description,
      }));
      const edges: GraphEdge[] = (gj.edges || []).map((e: any) => ({
        id: e.temp_id || e.id,
        source: e.source,
        target: e.target,
        relationType: e.relation_type,
        confidence: e.confidence,
        evidence: e.evidence,
      }));

      setPreview({
        draftGraphId: result.draft_graph_id,
        summary: result.summary || gj.summary || '',
        nodes,
        edges,
      });
    } catch (e: any) {
      setError(e?.response?.data?.detail || '导入失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // Show preview after successful import
  if (preview) {
    return (
      <div style={{ display: 'flex', height: 'calc(100vh - 56px)', flexDirection: 'column' }}>
        {/* Preview header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                摘要：{preview.summary}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  setPreview(null);
                  setTitle('');
                  setContent('');
                  setSourceType('');
                  setSourceUrl('');
                  setAuthor('');
                }}
                style={{
                  padding: '8px 16px',
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                继续导入
              </button>
              <button
                onClick={() => navigate(`/draft/${preview.draftGraphId}`)}
                style={{
                  padding: '8px 20px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                编辑图谱
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: extracted nodes & edges summary */}
          <div style={{ width: 300, borderRight: '1px solid #e2e8f0', overflowY: 'auto', padding: 12 }}>
            <h4 style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px 0' }}>
              抽取节点 ({preview.nodes.length})
            </h4>
            {preview.nodes.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '6px 10px',
                  marginBottom: 4,
                  borderRadius: 4,
                  borderLeft: `3px solid ${NODE_COLORS[n.nodeType] || '#94a3b8'}`,
                  background: '#f8fafc',
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 500 }}>{n.name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{n.nodeType}</div>
              </div>
            ))}

            <h4 style={{ fontSize: 13, color: '#64748b', margin: '12px 0 8px 0' }}>
              抽取关系 ({preview.edges.length})
            </h4>
            {preview.edges.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: '6px 10px',
                  marginBottom: 4,
                  borderRadius: 4,
                  background: '#f8fafc',
                  fontSize: 12,
                  color: '#475569',
                }}
              >
                <span style={{ fontWeight: 500 }}>
                  {preview.nodes.find((n) => n.id === e.source)?.name || e.source}
                </span>
                <span style={{ color: '#3b82f6', margin: '0 4px' }}>[{e.relationType}]</span>
                <span style={{ fontWeight: 500 }}>
                  {preview.nodes.find((n) => n.id === e.target)?.name || e.target}
                </span>
                {e.confidence !== undefined && (
                  <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>
                    {(e.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Right: graph visualization */}
          <div style={{ flex: 1 }}>
            <GraphEditor
              graphData={{ nodes: preview.nodes, edges: preview.edges }}
              editable={false}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 20 }}>导入文章</h2>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>标题 *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文章标题"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>来源类型</label>
          <input
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            placeholder="如 wechat_article"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>作者</label>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="作者"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>来源链接</label>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>正文 *</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴文章正文..."
          rows={12}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            fontSize: 14,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <button
        onClick={handleImport}
        disabled={loading}
        style={{
          padding: '10px 32px',
          background: loading ? '#94a3b8' : '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {loading ? '正在处理...' : '导入并生成图谱'}
      </button>
    </div>
  );
}
