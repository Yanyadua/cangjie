import React, { useEffect, useState, useCallback } from 'react';
import GraphEditor from '../components/GraphEditor';
import { getGlobalGraph, getLocalGraph, getArticleSubgraph } from '../api/client';
import type { GraphNode, GraphEdge } from '../types/graph';
import { NODE_COLORS } from '../types/graph';

type FilterType = 'all' | 'topic' | 'article' | 'partition';

export default function GlobalGraphPage() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [articleGraph, setArticleGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const loadGlobalGraph = useCallback(async (ft: FilterType) => {
    setLoading(true);
    try {
      const result = await getGlobalGraph(ft);
      const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
        id: n.id,
        nodeType: n.node_type,
        name: n.name,
        description: n.description,
      }));
      const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relationType: e.relation_type,
        confidence: e.confidence,
      }));
      setGraphData({ nodes, edges });
    } catch (e) {
      console.error('Failed to load global graph', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGlobalGraph(filterType);
  }, [filterType, loadGlobalGraph]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    setSelectedNode(node);
    setArticleGraph(null);

    if (node.nodeType === 'article') {
      try {
        const data = await getArticleSubgraph(nodeId);
        const nodes: GraphNode[] = (data.nodes || []).map((n: any) => ({
          id: n.id, nodeType: n.node_type, name: n.name, description: n.description,
        }));
        const edges: GraphEdge[] = (data.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target,
          relationType: e.relation_type, confidence: e.confidence,
        }));
        setArticleGraph({ nodes, edges });
      } catch { /* ignore */ }
    } else {
      try {
        const result = await getLocalGraph(nodeId, 1);
        const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
          id: n.id, nodeType: n.node_type, name: n.name, description: n.description,
        }));
        const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target, relationType: e.relation_type, confidence: e.confidence,
        }));
        setGraphData({ nodes, edges });
      } catch { /* ignore */ }
    }
  }, [graphData.nodes]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const result = await getLocalGraph(searchQuery, 2);
      if (result.nodes?.length > 0) {
        const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
          id: n.id, nodeType: n.node_type, name: n.name, description: n.description,
        }));
        const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
          id: e.id, source: e.source, target: e.target, relationType: e.relation_type, confidence: e.confidence,
        }));
        setGraphData({ nodes, edges });
      } else {
        await loadGlobalGraph(filterType);
      }
    } catch {
      alert('未找到节点');
    } finally {
      setLoading(false);
    }
  };

  const topicCount = graphData.nodes.filter(n => n.nodeType === 'topic').length;
  const articleCount = graphData.nodes.filter(n => n.nodeType === 'article').length;
  const partitionCount = graphData.nodes.filter(n => n.nodeType === 'partition').length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索节点..." onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }} />
          <button onClick={handleSearch} disabled={loading}
            style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            {loading ? '搜索中...' : '搜索'}
          </button>
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {(['all', 'topic', 'article', 'partition'] as FilterType[]).map(ft => (
              <button key={ft} onClick={() => setFilterType(ft)} style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                background: filterType === ft ? '#3b82f6' : '#f1f5f9', color: filterType === ft ? '#fff' : '#64748b', border: 'none',
              }}>
                {ft === 'all' ? `全部 (${topicCount + articleCount})` : ft === 'topic' ? `主题 (${topicCount})` : ft === 'article' ? `文章 (${articleCount})` : `分区 (${partitionCount})`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <GraphEditor graphData={graphData} editable={false} onNodeClick={handleNodeClick} />
        </div>
      </div>
      <div style={{ width: 360, borderLeft: '1px solid #e2e8f0', overflowY: 'auto' }}>
        {selectedNode ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              borderLeft: `4px solid ${NODE_COLORS[selectedNode.nodeType] || '#94a3b8'}`, paddingLeft: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{selectedNode.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedNode.nodeType}</div>
              </div>
            </div>
            {selectedNode.description && (
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 1.5 }}>{selectedNode.description}</div>
            )}
            {articleGraph && (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ fontSize: 13, margin: '0 0 8px 0', color: '#64748b' }}>文章知识子图（claim + proposition）</h4>
                <div style={{ height: 300, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                  <GraphEditor graphData={articleGraph} editable={false} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>
            点击节点查看详情<br /><br />
            点击<b>分区</b>查看分区下内容<br />
            点击<b>主题</b>节点展开邻居<br />
            点击<b>文章</b>节点查看内部图谱
          </div>
        )}
      </div>
    </div>
  );
}
