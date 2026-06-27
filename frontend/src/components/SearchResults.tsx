import { useNavigate } from 'react-router-dom';
import type { SearchResult } from '../types/graph';
import { NodeCard } from './NodeCard';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export type SearchResultsProps = {
  results: SearchResult;
};

export default function SearchResults({ results }: SearchResultsProps) {
  const navigate = useNavigate();

  const chunks = results.chunks || [];
  const nodes = results.nodes || [];
  const documents = results.documents || [];

  return (
    <Tabs defaultValue="chunks">
      <TabsList className="mb-3">
        <TabsTrigger value="chunks">片段 ({chunks.length})</TabsTrigger>
        <TabsTrigger value="nodes">节点 ({nodes.length})</TabsTrigger>
        <TabsTrigger value="documents">文档 ({documents.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="chunks">
        <div className="flex flex-col gap-2">
          {chunks.map((chunk, i) => (
            <div
              key={chunk.id || i}
              className="rounded-xl border border-border bg-surface p-3 shadow-sm"
            >
              <p className="text-sm text-text">
                {chunk.content.length > 200 ? (
                  <mark className="rounded bg-accent-soft px-0.5 text-accent">
                    {Array.from(chunk.content).slice(0, 200).join('')}…
                  </mark>
                ) : (
                  <mark className="rounded bg-accent-soft px-0.5 text-accent">
                    {chunk.content}
                  </mark>
                )}
              </p>
              <div className="mt-1.5 text-[11px] text-text-subtle">
                匹配度: {((chunk.score || 0) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="nodes">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {nodes.map((node, i) => (
            <button
              key={node.id || i}
              type="button"
              className="text-left"
              onClick={() => navigate('/cosmos')}
            >
              <NodeCard
                nodeType={node.node_type}
                name={node.name}
                description={node.description}
                meta={<span>匹配度: {((node.score || 0) * 100).toFixed(0)}%</span>}
              />
            </button>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="documents">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {documents.map((doc, i) => (
            <button
              key={doc.id || i}
              type="button"
              className="text-left"
              onClick={() => navigate('/history')}
            >
              <NodeCard
                nodeType="article"
                name={doc.title}
                meta={
                  <>
                    <Badge variant="secondary">{doc.status}</Badge>
                    <span>
                      {new Date(doc.created_at).toLocaleString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </>
                }
              />
            </button>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
