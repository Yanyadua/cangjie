import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { importDocument, getDraftGraph } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import { NodeCard } from '../components/NodeCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { GraphNode, GraphEdge } from '../types/graph';

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
      <div className="flex h-[calc(100vh-56px)] flex-col">
        {/* Preview header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-5 py-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text">{title}</h3>
            <div className="mt-1 text-xs text-text-muted">
              摘要：{preview.summary}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setTitle('');
                setContent('');
                setSourceType('');
                setSourceUrl('');
                setAuthor('');
              }}
            >
              继续导入
            </Button>
            <Button onClick={() => navigate(`/draft/${preview.draftGraphId}`)}>
              编辑图谱
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: extracted nodes & edges summary */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-r border-border p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              抽取节点 ({preview.nodes.length})
            </h4>
            <div className="flex flex-col gap-1.5">
              {preview.nodes.map((n) => (
                <NodeCard
                  key={n.id}
                  nodeType={n.nodeType}
                  name={n.name}
                  description={n.description}
                />
              ))}
            </div>

            <h4 className="mt-3 mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              抽取关系 ({preview.edges.length})
            </h4>
            <div className="flex flex-col gap-1.5">
              {preview.edges.map((e) => (
                <div
                  key={e.id}
                  className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-text"
                >
                  <span className="font-medium">
                    {preview.nodes.find((n) => n.id === e.source)?.name || e.source}
                  </span>
                  <span className="mx-1 text-accent">[{e.relationType}]</span>
                  <span className="font-medium">
                    {preview.nodes.find((n) => n.id === e.target)?.name || e.target}
                  </span>
                  {e.confidence !== undefined && (
                    <span className="ml-1.5 text-[10px] text-text-subtle">
                      {(e.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: graph visualization (GraphEditor keeps inline styles — migrated in Batch F) */}
          <div className="min-w-0 flex-1">
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
    <div className="mx-auto max-w-[880px] p-6">
      <h2 className="mb-5 text-2xl font-bold text-text">导入文章</h2>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-3.5">
        <Label className="mb-1 block text-[13px] font-medium">标题 *</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文章标题"
        />
      </div>

      <div className="mb-3.5 flex gap-3">
        <div className="flex-1">
          <Label className="mb-1 block text-[13px] font-medium">来源类型</Label>
          <Input
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            placeholder="如 wechat_article"
          />
        </div>
        <div className="flex-1">
          <Label className="mb-1 block text-[13px] font-medium">作者</Label>
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="作者"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <Label className="mb-1 block text-[13px] font-medium">来源链接</Label>
        <Input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="mb-5">
        <Label className="mb-1 block text-[13px] font-medium">正文 *</Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴文章正文..."
          rows={12}
          className="resize-y font-sans"
        />
      </div>

      <Button
        onClick={handleImport}
        disabled={loading}
        size="lg"
        className="px-8"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {loading ? '正在处理...' : '导入并生成图谱'}
      </Button>
    </div>
  );
}
