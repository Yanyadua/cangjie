import React, { useState, useCallback } from 'react';
import GraphEditor from '../components/GraphEditor';
import NodeInspector from '../components/NodeInspector';
import { getLocalGraph, getNodeDetail } from '../api/client';
import type { GraphNode, GraphEdge } from '../types/graph';

export default function GlobalGraphPage() {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const result = await getLocalGraph(searchQuery, 1);
      const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
        id: n.id,
        nodeType: n.node_type,
        name: n.name,
        description: n.description,
      }));
      const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source || e.source_node_id,
        target: e.target || e.target_node_id,
        relationType: e.relation_type,
        confidence: e.confidence,
        evidence: e.evidence_text || e.evidence,
      }));
      setGraphData({ nodes, edges });
    } catch {
      alert('未找到节点');
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = useCallback(async (nodeId: string) => {
    try {
      const detail = await getNodeDetail(nodeId);
      setSelectedNode({
        id: detail.id,
        nodeType: detail.node_type,
        name: detail.name,
        description: detail.description,
      });
      // Expand to show neighbors
      const result = await getLocalGraph(nodeId, 1);
      const nodes: GraphNode[] = (result.nodes || []).map((n: any) => ({
        id: n.id,
        nodeType: n.node_type,
        name: n.name,
        description: n.description,
      }));
      const edges: GraphEdge[] = (result.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source || e.source_node_id,
        target: e.target || e.target_node_id,
        relationType: e.relation_type,
        confidence: e.confidence,
        evidence: e.evidence_text || e.evidence,
      }));
      setGraphData({ nodes, edges });
    } catch {
      // ignore
    }
  }, []);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Search bar */}
        <div style={{ padding: 12, borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="输入节点 ID 或名称搜索..."
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {loading ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* Graph */}
        <div style={{ flex: 1 }}>
          <GraphEditor
            graphData={graphData}
            editable={false}
            onNodeClick={handleNodeClick}
          />
        </div>
      </div>

      {/* Right panel */}
      <div style={{ width: 320, borderLeft: '1px solid #e2e8f0', overflowY: 'auto' }}>
        {selectedNode ? (
          <NodeInspector node={selectedNode} />
        ) : (
          <div style={{ padding: 16, color: '#94a3b8' }}>搜索并点击节点查看详情</div>
        )}
      </div>
    </div>
  );
}
