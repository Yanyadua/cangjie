import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocuments, getDraftGraph } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import type { GraphNode, GraphEdge } from '../types/graph';

type DocItem = {
  id: string;
  title: string;
  source_type?: string;
  author?: string;
  summary?: string;
  status: string;
  created_at: string;
};

export default function HistoryPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<DocItem | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [graphStatus, setGraphStatus] = useState<string>('');

  useEffect(() => {
    getDocuments(0, 100)
      .then((res) => setDocuments(res.documents || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSelectDoc = async (doc: DocItem) => {
    setSelectedDoc(doc);
    setGraphData(null);
    setGraphStatus('加载中...');

    // Find draft graph for this document
    try {
      const dgRes = await fetch(`/api/draft-graphs?document_id=${doc.id}`);
      if (!dgRes.ok) throw new Error('not found');
      // Backend doesn't have list-by-doc endpoint, use direct query
    } catch {
      // fallback: no direct list API, show info
    }

    // Use the document list from DB to find draft_graph_id
    // We need to query draft_graphs by document_id
    try {
      const res = await fetch(`/api/documents/${doc.id}/draft-graph`);
      if (!res.ok) throw new Error('not found');
      const dg = await res.json();
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
      setGraphData({ nodes, edges });
      setGraphStatus(dg.status);
    } catch {
      setGraphData({ nodes: [], edges: [] });
      setGraphStatus('未找到图谱');
    }
  };

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      {/* Left: document list */}
      <div style={{ width: 340, borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 14 }}>
          历史文章 ({documents.length})
        </div>
        {documents.length === 0 && (
          <div style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>暂无文章</div>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            onClick={() => handleSelectDoc(doc)}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f1f5f9',
              cursor: 'pointer',
              background: selectedDoc?.id === doc.id ? '#eff6ff' : '#fff',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.4 }}>
              {doc.title}
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#94a3b8' }}>
              <span>{doc.source_type || '手动导入'}</span>
              <span>{new Date(doc.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{
                color: doc.status === 'processed' ? '#10b981' : '#f59e0b',
              }}>
                {doc.status}
              </span>
            </div>
            {doc.summary && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.summary}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Right: graph preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedDoc ? (
          <>
            {/* Header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{selectedDoc.title}</h3>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {selectedDoc.summary}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    图谱状态: {graphStatus} | 节点: {graphData?.nodes.length || 0} | 关系: {graphData?.edges.length || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Graph */}
            {graphData && graphData.nodes.length > 0 ? (
              <div style={{ flex: 1 }}>
                <GraphEditor
                  graphData={graphData}
                  editable={false}
                />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                {graphStatus || '选择一篇文章查看图谱'}
              </div>
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            选择左侧文章查看对应图谱
          </div>
        )}
      </div>
    </div>
  );
}
