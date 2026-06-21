import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import RadialKnowledgeGraph from '../components/RadialKnowledgeGraph';
import GraphEditor from '../components/GraphEditor';
import { getGlobalGraph, getArticleSubgraph } from '../api/client';
import { graphJsonToGraphData } from '../lib/graph-mappers';
import { toErrorMessage } from '../lib/errors';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '../components/ui/sheet';
import { Alert, AlertDescription } from '../components/ui/alert';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import type { GraphNode, GraphEdge } from '../types/graph';

const LEGEND = [
  { label: '我', color: 'var(--node-person)' },
  { label: '分区', color: 'var(--node-partition)' },
  { label: '主题', color: 'var(--node-topic)' },
  { label: '文章', color: 'var(--node-article)' },
];

export default function GlobalGraphPage() {
  const navigate = useNavigate();
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedArticle, setSelectedArticle] = useState<GraphNode | null>(null);
  const [articleGraph, setArticleGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getGlobalGraph('partition');
      setGraphData(graphJsonToGraphData(result));
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (node.nodeType === 'article') {
      setSelectedArticle(node);
      setArticleGraph(null);
      try {
        const data = await getArticleSubgraph(nodeId);
        setArticleGraph(graphJsonToGraphData(data));
      } catch { /* ignore subgraph fetch errors */ }
    }
  }, [graphData.nodes]);

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) setSelectedArticle(null);
  };

  const isEmpty = !loading && graphData.nodes.length === 0;

  return (
    <div className="relative h-[calc(100vh-56px)] w-full">
      {/* Top-right legend (no filter buttons, no search yet — Task 9 will add search) */}
      <Card className="absolute right-3 top-3 z-10 gap-0 py-2 shadow-md">
        <CardContent className="flex items-center gap-3 px-3">
          {LEGEND.map(l => (
            <div key={l.label} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              <span className="text-xs text-text-muted">{l.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6"><LoadingSkeleton count={4} /></div>
        </div>
      )}

      {error && isEmpty && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6">
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            <div className="mt-4 flex justify-center">
              <Button onClick={load} variant="outline" size="sm">重试</Button>
            </div>
          </div>
        </div>
      )}

      {isEmpty && !error && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <EmptyState
            title="你的知识图谱还是空的"
            hint="导入第一篇文章，系统会自动为你构建知识网络。"
            action={<Button onClick={() => navigate('/import')}>去导入</Button>}
          />
        </div>
      )}

      {!loading && !isEmpty && (
        <RadialKnowledgeGraph graphData={graphData} onNodeClick={handleNodeClick} />
      )}

      {/* Article inspector */}
      <Sheet open={selectedArticle !== null} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right">
          {selectedArticle && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedArticle.name}</SheetTitle>
                <SheetDescription>文章</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                {selectedArticle.description && (
                  <div className="mb-3 px-4 text-sm text-text-muted">{selectedArticle.description}</div>
                )}
                {articleGraph && (
                  <div className="mt-2 px-4">
                    <h4 className="mb-2 text-xs text-text-muted">文章内部图谱</h4>
                    <div className="h-[300px] overflow-hidden rounded-lg border border-border">
                      <GraphEditor graphData={articleGraph} editable={false} />
                    </div>
                  </div>
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
