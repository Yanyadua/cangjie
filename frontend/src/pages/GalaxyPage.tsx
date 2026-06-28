// frontend/src/pages/GalaxyPage.tsx
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import RadialKnowledgeGraph from '../components/RadialKnowledgeGraph';
import { GalaxyCanvas } from '../components/cosmos';
import GraphEditor from '../components/GraphEditor';
import { getLocalGraph, getArticleSubgraph } from '../api/client';
import { graphJsonToGraphData } from '../lib/graph-mappers';
import { localGraphToGalaxyScene, capArticles } from '../lib/galaxy-mappers';
import { toErrorMessage } from '../lib/errors';
import { getGpuTier } from '../lib/gpu-tier';
import { useIsCoarsePointer, useIsNarrowViewport } from '../hooks/use-media-query';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '../components/ui/sheet';
import { Alert, AlertDescription } from '../components/ui/alert';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import type { GraphNode, GraphEdge, GraphData } from '../types/graph';

const LEGEND_3D = [
  { label: '星系核（分区）', color: 'var(--node-partition)' },
  { label: '主题星团', color: 'var(--node-topic)' },
  { label: '文章星', color: 'var(--node-article)' },
];

const LEGEND_2D = [
  { label: '分区', color: 'var(--node-partition)' },
  { label: '主题', color: 'var(--node-topic)' },
  { label: '文章', color: 'var(--node-article)' },
];

export default function GalaxyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [partitionHovered, setPartitionHovered] = useState(false);

  // Galaxy interaction state (M2 Task 4)
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(new Set());
  const [hoveredTopicId, setHoveredTopicId] = useState<string | null>(null);
  const [hoveredArticleId, setHoveredArticleId] = useState<string | null>(null);

  // ArticleSheet state
  const [selectedArticle, setSelectedArticle] = useState<GraphNode | null>(null);
  const [articleGraph, setArticleGraph] = useState<GraphData | null>(null);

  const isCoarse = useIsCoarsePointer();
  const isNarrow = useIsNarrowViewport();
  const tier = getGpuTier();
  const isEmpty = !loading && graphData.nodes.length === 0;
  const use3D =
    tier.tier <= 3 && !isCoarse && !isNarrow && !loading && !isEmpty && !error;

  const legend = use3D ? LEGEND_3D : LEGEND_2D;

  const { scene, dropped } = useMemo(() => {
    if (!use3D) return { scene: null, dropped: 0 };
    const raw = localGraphToGalaxyScene(graphData.nodes, graphData.edges);
    const { scene, dropped } = capArticles(raw, 200);
    return { scene, dropped };
  }, [graphData.nodes, graphData.edges, use3D]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const result = await getLocalGraph(id, 2);
      const data = graphJsonToGraphData(result);
      setGraphData(data);
      // Seed expanded topics: those with 1-3 articles (immediate content, no overwhelming sprawl)
      const raw = localGraphToGalaxyScene(data.nodes, data.edges);
      const initial = new Set<string>(
        raw.topics
          .filter(t => t.articles.length > 0 && t.articles.length <= 3)
          .map(t => t.id),
      );
      setExpandedTopicIds(initial);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleArticleClick = useCallback(async (nodeId: string) => {
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node || node.nodeType !== 'article') return;
    setSelectedArticle(node);
    setArticleGraph(null);
    try {
      const data = await getArticleSubgraph(nodeId);
      setArticleGraph(graphJsonToGraphData(data));
    } catch {
      /* ignore subgraph fetch errors */
    }
  }, [graphData.nodes]);

  const handleTopicClick = useCallback((topicId: string) => {
    setExpandedTopicIds(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }, []);

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) setSelectedArticle(null);
  };

  return (
    <div className="relative h-[calc(100vh-56px)] w-full">
      {/* Dev tier indicator */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <div className="rounded-full bg-surface/80 px-3 py-1 text-[10px] text-text-muted backdrop-blur">
          宇宙化 UI · M2 Galaxy · Tier {tier.tier}（{tier.reason}）
          {use3D ? ' · 3D 模式' : ' · 降级模式'}
          {(isCoarse || isNarrow) && ' · 移动端'}
        </div>
      </div>

      {/* Top-left breadcrumb */}
      {!loading && !isEmpty && !error && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 text-xs text-text-muted">
          <button
            type="button"
            onClick={() => navigate('/cosmos')}
            className="rounded px-1.5 py-1 hover:bg-surface hover:text-text"
          >
            宇宙
          </button>
          <span className="text-text-subtle">›</span>
          <span className="max-w-[200px] truncate px-1.5 py-1 font-semibold text-text">
            {scene?.partition?.name ?? '星系'}
          </span>
        </div>
      )}

      {use3D && scene && expandedTopicIds.size > 0 && (
        <button
          type="button"
          onClick={() => setExpandedTopicIds(new Set())}
          className="absolute left-3 top-12 z-10 rounded-full bg-surface/80 px-2 py-1 text-[10px] text-text-muted backdrop-blur hover:bg-surface"
        >
          收起所有主题
        </button>
      )}

      {/* Top-right legend */}
      <Card className="absolute right-3 top-3 z-10 gap-0 py-2 shadow-md">
        <CardContent className="flex items-center gap-3 px-3">
          {legend.map(l => (
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

      {error && (
        <div className="flex h-full items-center justify-center pt-16">
          <div className="w-full max-w-md p-6">
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => navigate('/cosmos')} variant="outline" size="sm">
                ◀ 返回宇宙
              </Button>
              <Button onClick={load} variant="outline" size="sm">重试</Button>
            </div>
          </div>
        </div>
      )}

      {isEmpty && !error && !loading && (
        <div className="flex h-full items-center justify-center pt-16">
          <EmptyState
            title="这个分区还没有内容"
            hint="导入文章后会自动归入分区。"
            action={
              <Button onClick={() => navigate('/cosmos')} variant="outline">
                ◀ 返回宇宙
              </Button>
            }
          />
        </div>
      )}

      {!loading && !isEmpty && !error && (
        use3D && scene ? (
          <div className="galaxy-canvas h-full w-full">
            <GalaxyCanvas
              scene={scene}
              expandedTopicIds={expandedTopicIds}
              hoveredTopicId={hoveredTopicId}
              hoveredArticleId={hoveredArticleId}
              onTopicClick={handleTopicClick}
              onTopicHover={setHoveredTopicId}
              onArticleClick={handleArticleClick}
              onArticleHover={setHoveredArticleId}
              onPartitionHover={setPartitionHovered}
              partitionHovered={partitionHovered}
            />
            {dropped > 0 && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface/80 px-3 py-1 text-[10px] text-text-muted backdrop-blur">
                更多 {dropped} 篇文章已折叠
              </div>
            )}
          </div>
        ) : (
          <div className="galaxy-canvas h-full w-full">
            <RadialKnowledgeGraph
              graphData={graphData}
              onNodeClick={handleArticleClick}
              searchQuery=""
            />
          </div>
        )
      )}

      {/* Article inspector (duplicated from CosmosPage — YAGNI shared component) */}
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
                  <div className="mb-3 px-4 text-sm text-text-muted">
                    {selectedArticle.description}
                  </div>
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
