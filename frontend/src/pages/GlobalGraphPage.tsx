import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import GraphEditor from '../components/GraphEditor';
import NodeInspector from '../components/NodeInspector';
import { getGlobalGraph, getLocalGraph, getArticleSubgraph } from '../api/client';
import { graphJsonToGraphData } from '../lib/graph-mappers';
import { toErrorMessage } from '../lib/errors';
import { nodeColorVar } from '@/lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../components/ui/sheet';
import { Alert, AlertDescription } from '../components/ui/alert';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import type { GraphNode, GraphEdge, NodeType } from '../types/graph';

type FilterType = 'all' | 'topic' | 'article' | 'partition';

const LEGEND_TYPES: NodeType[] = ['concept', 'topic', 'article', 'claim', 'question'];

const FILTER_LABEL: Record<FilterType, string> = {
  all: '全部',
  topic: '主题',
  article: '文章',
  partition: '分区',
};

export default function GlobalGraphPage() {
  const navigate = useNavigate();
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [articleGraph, setArticleGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadGlobalGraph = useCallback(async (ft: FilterType) => {
    setLoading(true);
    setError('');
    try {
      const result = await getGlobalGraph(ft);
      setGraphData(graphJsonToGraphData(result));
    } catch (e: unknown) {
      setError(toErrorMessage(e));
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
        setArticleGraph(graphJsonToGraphData(data));
      } catch { /* ignore */ }
    } else {
      try {
        const result = await getLocalGraph(nodeId, 1);
        setGraphData(graphJsonToGraphData(result));
      } catch { /* ignore */ }
    }
  }, [graphData.nodes]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await getLocalGraph(searchQuery, 2);
      if (result.nodes?.length > 0) {
        setGraphData(graphJsonToGraphData(result));
      } else {
        setError('未找到节点：' + searchQuery);
        await loadGlobalGraph(filterType);
      }
    } catch {
      setError('未找到节点：' + searchQuery);
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

  const topicCount = graphData.nodes.filter(n => n.nodeType === 'topic').length;
  const articleCount = graphData.nodes.filter(n => n.nodeType === 'article').length;
  const partitionCount = graphData.nodes.filter(n => n.nodeType === 'partition').length;

  const filterCounts: Record<FilterType, number> = {
    all: topicCount + articleCount,
    topic: topicCount,
    article: articleCount,
    partition: partitionCount,
  };

  return (
    <div className="relative h-[calc(100vh-56px)] w-full">
      {/* Top bar: search + filter buttons */}
      <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
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
        {/* Type filter buttons */}
        <div className="flex items-center gap-1">
          {(['all', 'topic', 'article', 'partition'] as FilterType[]).map(ft => (
            <Button
              key={ft}
              variant={filterType === ft ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType(ft)}
            >
              {FILTER_LABEL[ft]} ({filterCounts[ft]})
            </Button>
          ))}
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

      {/* Error state (when no graph data loaded) */}
      {error && isEmpty && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="mt-4 flex justify-center">
              <Button onClick={() => loadGlobalGraph(filterType)} variant="outline" size="sm">
                重试
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state (only when no error) */}
      {isEmpty && !error && !loading && (
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

          {/* Error banner — floating top-center over canvas (partial load) */}
          {error && (
            <div className="absolute left-1/2 top-16 z-20 w-full max-w-md -translate-x-1/2 px-4">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

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
