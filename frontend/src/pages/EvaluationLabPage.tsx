import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getDocuments, runEvaluation } from '../api/client';
import GraphEditor from '../components/GraphEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toErrorMessage } from '@/lib/errors';
import type { GraphNode, GraphEdge } from '../types/graph';

type StrategyResult = {
  strategy: string;
  label: string;
  error?: string;
  graph?: { summary?: string; nodes: any[]; edges: any[] };
  reconstructed?: string[];
  scores?: {
    recall: number;
    precision: number;
    f1: number;
    node_count: number;
    edge_count: number;
    isolated_nodes: number;
    evidence_coverage: number;
    matched?: Array<{ gt: string; reconstructed: string }>;
    missed?: string[];
    hallucinated?: string[];
  };
};

type EvalResponse = {
  document_title: string;
  ground_truth: string[];
  results: StrategyResult[];
};

const STRATEGY_LABELS: Record<string, string> = {
  concise: '简洁',
  standard: '标准',
  detailed: '详细',
  proposition: '命题化',
};

function scoreColorClass(score: number): string {
  if (score >= 0.85) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 0.6) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export default function EvaluationLabPage() {
  const [documents, setDocuments] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedDoc, setSelectedDoc] = useState('');
  const [strategies, setStrategies] = useState<string[]>(['concise', 'standard', 'detailed']);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [error, setError] = useState('');
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const [previewStrategy, setPreviewStrategy] = useState<string | null>(null);

  useEffect(() => {
    getDocuments(0, 50).then((data: any) => {
      setDocuments(data.documents || data || []);
    }).catch(() => {});
  }, []);

  const toggleStrategy = (s: string) => {
    setStrategies(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleRun = async () => {
    if (!selectedDoc || strategies.length === 0) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const data = await runEvaluation(selectedDoc, strategies);
      setResult(data);
    } catch (e: unknown) {
      setError('评估失败：' + toErrorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const convertGraph = (graph: any) => {
    const nodes: GraphNode[] = (graph?.nodes || []).map((n: any) => ({
      id: n.temp_id || n.id, nodeType: n.node_type, name: n.name, description: n.description,
    }));
    const edges: GraphEdge[] = (graph?.edges || []).map((e: any) => ({
      id: e.temp_id || e.id, source: e.source, target: e.target,
      relationType: e.relation_type, confidence: e.confidence,
    }));
    return { nodes, edges };
  };

  const canRun = !running && !!selectedDoc && strategies.length > 0;

  return (
    <div className="mx-auto h-[calc(100vh-56px)] max-w-4xl overflow-y-auto p-6">
      <h2 className="mb-5 text-xl font-semibold text-text">图谱评估实验室</h2>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 配置区 */}
      <Card className="mb-6 gap-4 py-4">
        <CardContent className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block text-sm font-medium text-text">选择文章</Label>
            <Select value={selectedDoc} onValueChange={setSelectedDoc}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择..." />
              </SelectTrigger>
              <SelectContent>
                {documents.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-text">策略档位</Label>
            <div className="flex flex-wrap gap-4">
              {['concise', 'standard', 'detailed', 'proposition'].map(s => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-accent"
                    checked={strategies.includes(s)}
                    onChange={() => toggleStrategy(s)}
                  />
                  {STRATEGY_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Button onClick={handleRun} disabled={!canRun}>
              {running ? '评估中...' : '开始评估'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 结果区 */}
      {result && (
        <>
          {/* Ground Truth */}
          <div className="mb-5">
            <h3 className="mb-2 text-[15px] font-semibold text-text">
              Ground Truth 知识点 ({result.ground_truth.length})
            </h3>
            <div className="flex flex-col">
              {result.ground_truth.map((kp, i) => (
                <div key={i} className="border-l-2 border-border py-0.5 pl-3 text-sm text-text-muted">
                  {kp}
                </div>
              ))}
            </div>
          </div>

          {/* 评分对比表 */}
          {result.results.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-[15px] font-semibold text-text">评分对比</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-border bg-surface-2">
                      <th className="px-3 py-2 text-left font-medium text-text">指标</th>
                      {result.results.map(r => (
                        <th key={r.strategy} className="px-3 py-2 text-center font-medium text-text">
                          {r.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: 'recall', label: '召回率', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                      { key: 'precision', label: '准确率', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                      { key: 'f1', label: 'F1', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: true },
                      { key: 'node_count', label: '节点数', format: (v: number) => String(v), colored: false },
                      { key: 'edge_count', label: '边数', format: (v: number) => String(v), colored: false },
                      { key: 'isolated_nodes', label: '孤立节点', format: (v: number) => String(v), colored: false },
                      { key: 'evidence_coverage', label: '证据覆盖', format: (v: number) => `${(v * 100).toFixed(0)}%`, colored: false },
                    ]).map(row => (
                      <tr key={row.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium text-text">{row.label}</td>
                        {result.results.map(r => {
                          const val = r.scores?.[row.key as keyof typeof r.scores] as number;
                          return (
                            <td key={r.strategy} className={cn(
                              'px-3 py-2 text-center',
                              row.colored && typeof val === 'number' ? cn(scoreColorClass(val), 'font-semibold') : 'text-text',
                            )}>
                              {r.error ? '—' : (typeof val === 'number' ? row.format(val) : '—')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 差异详情 */}
          <div className="mb-5">
            <h3 className="mb-2 text-[15px] font-semibold text-text">差异详情</h3>
            <div className="flex flex-col gap-2">
              {result.results.map(r => (
                <div key={r.strategy} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setExpandedDetail(expandedDetail === r.strategy ? null : r.strategy)}
                    className="flex w-full items-center gap-1.5 bg-surface-2 px-3.5 py-2.5 text-left text-sm font-semibold text-text hover:bg-surface-3 transition-colors"
                  >
                    {expandedDetail === r.strategy
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                    {r.label}
                  </button>
                  {expandedDetail === r.strategy && (
                    <div className="p-3">
                      {r.scores?.missed && r.scores.missed.length > 0 && (
                        <div className="mb-2">
                          <div className="mb-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            丢失的知识点 ({r.scores.missed.length})
                          </div>
                          {r.scores.missed.map((m, i) => (
                            <div key={i} className="py-0.5 pl-3 text-xs text-red-600 dark:text-red-400">• {m}</div>
                          ))}
                        </div>
                      )}
                      {r.scores?.hallucinated && r.scores.hallucinated.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                            编造的知识点 ({r.scores.hallucinated.length})
                          </div>
                          {r.scores.hallucinated.map((h, i) => (
                            <div key={i} className="py-0.5 pl-3 text-xs text-amber-600 dark:text-amber-400">• {h}</div>
                          ))}
                        </div>
                      )}
                      {!r.scores?.missed?.length && !r.scores?.hallucinated?.length && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400">无差异，完美匹配</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 图谱预览 */}
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-text">图谱预览</h3>
            <div className="mb-2 flex flex-wrap gap-1">
              {result.results.map(r => (
                <Button
                  key={r.strategy}
                  variant={previewStrategy === r.strategy ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewStrategy(previewStrategy === r.strategy ? null : r.strategy)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
            {previewStrategy && (() => {
              const r = result.results.find(x => x.strategy === previewStrategy);
              if (!r?.graph) return null;
              return (
                <div className="h-[400px] overflow-hidden rounded-lg border border-border">
                  <GraphEditor graphData={convertGraph(r.graph)} editable={false} />
                </div>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
