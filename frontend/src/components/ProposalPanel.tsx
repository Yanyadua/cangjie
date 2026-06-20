import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { InsertionProposalJSON } from '../types/graph';

export type ProposalPanelProps = {
  proposal: InsertionProposalJSON;
  onApply: () => void;
  loading?: boolean;
};

export default function ProposalPanel({ proposal, onApply, loading }: ProposalPanelProps) {
  const positions = proposal.candidate_positions || [];
  const merges = proposal.suggested_merges || [];
  const edges = proposal.suggested_edges || [];
  const conflicts = proposal.possible_conflicts || [];

  const totalItems = positions.length + merges.length + edges.length;
  const conflictRate = totalItems > 0 ? (conflicts.length / totalItems) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">建议概览</CardTitle>
          <CardDescription>
            共 {totalItems} 条建议
            {conflicts.length > 0 && `，其中 ${conflicts.length} 条潜在冲突`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex flex-1 items-center gap-2">
              <Progress value={conflictRate} className="flex-1" />
              <span className="text-xs text-text-muted">冲突率 {conflictRate.toFixed(0)}%</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {positions.length > 0 && (
              <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                候选位置 {positions.length}
              </Badge>
            )}
            {merges.length > 0 && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                建议合并 {merges.length}
              </Badge>
            )}
            {edges.length > 0 && (
              <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                建议关系 {edges.length}
              </Badge>
            )}
            {conflicts.length > 0 && (
              <Badge variant="destructive">潜在冲突 {conflicts.length}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Candidate Positions */}
      {positions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-text">候选位置</h4>
          {positions.map((pos, i) => (
            <Card key={`pos-${i}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span>{pos.target_node_name}</span>
                  <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                    new
                  </Badge>
                </CardTitle>
                <CardDescription>{pos.reason}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-text-subtle">
                  匹配度: {(pos.score * 100).toFixed(0)}%
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Suggested Merges */}
      {merges.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-text">建议合并</h4>
          {merges.map((merge, i) => (
            <Card key={`merge-${i}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span>{merge.draft_node_temp_id} &rarr; {merge.existing_node_id}</span>
                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                    merge
                  </Badge>
                </CardTitle>
                <CardDescription>{merge.reason}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-text-subtle">
                  置信度: {(merge.confidence * 100).toFixed(0)}%
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Suggested Edges */}
      {edges.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-text">建议关系</h4>
          {edges.map((edge, i) => (
            <Card key={`edge-${i}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span>{edge.source} &mdash;[{edge.relation_type}]&rarr; {edge.target}</span>
                  <Badge variant="secondary" className="bg-teal-500/15 text-teal-700 dark:text-teal-300">
                    new
                  </Badge>
                </CardTitle>
                <CardDescription>{edge.reason}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-xs text-text-subtle">
                  置信度: {(edge.confidence * 100).toFixed(0)}%
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Possible Conflicts */}
      {conflicts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-destructive">潜在冲突</h4>
          {conflicts.map((conflict, i) => (
            <Card key={`conflict-${i}`} className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span>冲突 #{i + 1}</span>
                  <Badge variant="destructive">conflict</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-text-muted">
                  {JSON.stringify(conflict, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Apply footer */}
      <Card>
        <CardFooter className="gap-2">
          <Button onClick={onApply} disabled={loading} className="flex-1">
            {loading ? '正在应用...' : '确认应用'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
