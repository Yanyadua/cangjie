import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import GraphEditor from '../components/GraphEditor';
import NodeInspector from '../components/NodeInspector';
import { getGlobalGraph, getLocalGraph, getNodeDetail } from '../api/client';
import { nodeColorVar } from '@/lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../components/ui/sheet';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import type { GraphNode, GraphEdge } from '../types/graph';

type FilterType = 'all' | 'topic' | 'article';

const LEGEND_TYPES: string[] = ['concept', 'topic', 'article', 'claim', 'question'];

export default function GlobalGraphPage() {
  const navigate = useNavigate();
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
        const detail = await getNodeDetail(nodeId);
        if (detail.source_document_id) {
          const dgRes = await fetch(`/api/documents/${detail.source_document_id}/draft-graph`).then(r => r.json());
          if (dgRes?.graph_json) {
            const gj = dgRes.graph_json;
            const nodes: GraphNode[] = (gj.nodes || []).map((n: any) => ({
              id: n.temp_id || n.id, nodeType: n.node_type, name: n.name, description: n.description,
            }));
            const edges: GraphEdge[] = (gj.edges || []).map((e: any) => ({
              id: e.temp_id || e.id, source: e.source, target: e.target,
              relationType: e.relation_type, confidence: e.confidence,
            }));
            setArticleGraph({ nodes, edges });
          }
        }
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

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedNode(null);
    }
  };

  const isEmpty = !loading && graphData.nodes.length === 0;

  return (
    <div className="relative h-[calc(100vh-56px)] w-full">
      {/* Top bar: search + filter tabs */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索节点..."
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="max-w-xs bg-surface"
          />
          <Button onClick={handleSearch} disabled={loading} size="sm">
            {loading ? '搜索中...' : '搜索'}
          </Button>
        </div>
        <div className="flex items-center">
          <Tabs value={filterType} onValueChange={(v) => setFilterType(v as FilterType)}>
            <TabsList>
              <TabsTrigger value="all">力导向</TabsTrigger>
              <TabsTrigger value="topic">聚类</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6">
            <LoadingSkeleton count={4} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="flex h-full items-center justify-center pt-16">
          <EmptyState
            title="知识库还是空的"
            action={<Button onClick={() => navigate('/import')}>去导入</Button>}
          />
        </div>
      )}

      {/* Canvas */}
      {!loading && !isEmpty && (
        <>
          <GraphEditor graphData={graphData} editable={false} onNodeClick={handleNodeClick} />

          {/* Bottom-left legend */}
          <Card className="absolute bottom-4 left-4 z-10 gap-0 py-3 shadow-md">
            <CardContent className="flex flex-col gap-1.5 px-4">
              {LEGEND_TYPES.map((type) => (
                <div key={type} className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ background: nodeColorVar(type) }}
                  />
                  <span className="text-xs text-text-muted">{type}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Node detail Sheet */}
      <Sheet open={selectedNode !== null} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right">
          {selectedNode && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedNode.name}</SheetTitle>
                <SheetDescription>{selectedNode.nodeType}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                {selectedNode.description && (
                  <div className="mb-3 px-4 text-sm text-text-muted">{selectedNode.description}</div>
                )}
                {articleGraph && (
                  <div className="mt-2 px-4">
                    <h4 className="mb-2 text-xs text-text-muted">文章内部图谱</h4>
                    <div className="h-[300px] overflow-hidden rounded-lg border border-border">
                      <GraphEditor graphData={articleGraph} editable={false} />
                    </div>
                  </div>
                )}
                {!articleGraph && (
                  <NodeInspector node={selectedNode} editable={false} />
                )}
              </div>
            </>
          )}
          <SheetFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
