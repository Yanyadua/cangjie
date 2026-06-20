import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getDocuments } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import { NodeCard } from '../components/NodeCard';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { graphJsonToGraphData } from '../lib/graph-mappers';
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

type TabKey = 'all' | 'pending' | 'processed';

// Map backend status string to a friendly bucket. Backend uses values like
// 'processed', 'pending', 'draft', etc. Treat anything containing 'process'
// (case-insensitive) as 已入库; everything else as 待确认.
function bucketOf(status: string): 'pending' | 'processed' {
  return /process/i.test(status) ? 'processed' : 'pending';
}

const TAB_LABEL: Record<TabKey, string> = {
  all: '全部',
  pending: '待确认',
  processed: '已入库',
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  const b = bucketOf(status);
  if (b === 'processed') return 'default';
  if (/error|fail/i.test(status)) return 'destructive';
  return 'secondary';
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const [filter, setFilter] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<DocItem | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [graphStatus, setGraphStatus] = useState<string>('');
  const [graphLoading, setGraphLoading] = useState(false);

  const loadDocs = useCallback(() => {
    setLoading(true);
    setLoadError('');
    let active = true;
    getDocuments(0, 100)
      .then((res: { documents?: DocItem[] }) => {
        if (!active) return;
        setDocuments(res.documents || []);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const cleanup = loadDocs();
    return cleanup;
  }, [loadDocs]);

  const handleSelectDoc = async (doc: DocItem) => {
    setSelectedDoc(doc);
    setGraphData(null);
    setGraphStatus('加载中...');
    setGraphLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/documents/${doc.id}/draft-graph`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dg = await res.json();
      const { nodes, edges } = graphJsonToGraphData(dg.graph_json);
      setGraphData({ nodes, edges });
      setGraphStatus(dg.status);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setGraphData({ nodes: [], edges: [] });
      setGraphStatus('未找到图谱');
    } finally {
      clearTimeout(timeout);
      setGraphLoading(false);
    }
  };

  const visibleDocs = useMemo(() => {
    let list = documents;
    if (tab !== 'all') {
      list = list.filter((d) => bucketOf(d.status) === tab);
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.summary || '').toLowerCase().includes(q) ||
          (d.source_type || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [documents, tab, filter]);

  if (loading) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={6} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>加载失败：{loadError}</span>
            <Button variant="outline" size="sm" onClick={loadDocs}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Detail view: selected document + graph preview
  if (selectedDoc) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedDoc(null)}>
              <ArrowLeft className="size-4" />
              返回
            </Button>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-text">{selectedDoc.title}</h3>
              {selectedDoc.summary && (
                <div className="truncate text-xs text-text-muted">{selectedDoc.summary}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-text-subtle">
            <Badge variant={statusVariant(selectedDoc.status)}>{selectedDoc.status}</Badge>
            <span>
              图谱状态: {graphStatus} | 节点: {graphData?.nodes.length || 0} | 关系:{' '}
              {graphData?.edges.length || 0}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {graphData && graphData.nodes.length > 0 ? (
            <GraphEditor graphData={graphData} editable={false} />
          ) : graphLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-subtle">
              加载中...
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-subtle">
              {graphStatus || '未找到图谱'}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Grid view
  if (documents.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="还没有导入"
          action={<Button onClick={() => navigate('/import')}>去导入</Button>}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-text">历史文章 ({documents.length})</h2>
        <div className="flex items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              <TabsTrigger value="all">{TAB_LABEL.all}</TabsTrigger>
              <TabsTrigger value="pending">{TAB_LABEL.pending}</TabsTrigger>
              <TabsTrigger value="processed">{TAB_LABEL.processed}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="筛选标题 / 摘要..."
            className="h-9 w-56"
          />
        </div>
      </div>

      {visibleDocs.length === 0 ? (
        <EmptyState title="暂无匹配" hint="尝试切换分类或修改筛选条件。" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="text-left"
              onClick={() => handleSelectDoc(doc)}
            >
              <NodeCard
                nodeType="article"
                name={doc.title}
                description={doc.summary}
                meta={
                  <>
                    <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
                    <span>{doc.source_type || '手动导入'}</span>
                    <span>
                      {new Date(doc.created_at).toLocaleString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                }
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
