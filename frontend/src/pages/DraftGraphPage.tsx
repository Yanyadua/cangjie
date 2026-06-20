import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDraftGraph, updateDraftGraph, confirmDraftGraph } from '../api/client';
import { toErrorMessage } from '../lib/errors';
import { graphJsonToGraphData } from '../lib/graph-mappers';
import GraphEditor from '../components/GraphEditor';
import NodeInspector from '../components/NodeInspector';
import EdgeInspector from '../components/EdgeInspector';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '../components/ui/sheet';
import type { GraphNode, GraphEdge, GraphData } from '../types/graph';

export default function DraftGraphPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getDraftGraph(id)
      .then((res) => {
        if (cancelled) return;
        setGraphData(graphJsonToGraphData(res.graph_json));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(toErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = graphData.nodes.find((n) => n.id === nodeId);
    setSelectedNode(node || null);
    setSelectedEdge(null);
  }, [graphData.nodes]);

  const handleEdgeClick = useCallback((edgeId: string) => {
    const edge = graphData.edges.find((e) => e.id === edgeId);
    setSelectedEdge(edge || null);
    setSelectedNode(null);
  }, [graphData.edges]);

  const handleNodeUpdate = useCallback((updated: GraphNode) => {
    setGraphData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n)),
    }));
    setSelectedNode(updated);
  }, []);

  const handleEdgeUpdate = useCallback((updated: GraphEdge) => {
    setGraphData((prev) => ({
      ...prev,
      edges: prev.edges.map((e) => (e.id === updated.id ? updated : e)),
    }));
    setSelectedEdge(updated);
  }, []);

  const handleNodeDelete = useCallback((nodeId: string) => {
    setGraphData((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
    setSelectedNode(null);
  }, []);

  const handleEdgeDelete = useCallback((edgeId: string) => {
    setGraphData((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== edgeId),
    }));
    setSelectedEdge(null);
  }, []);

  const handleConfirm = async () => {
    if (!id) return;
    setConfirming(true);
    setError('');
    try {
      const toSave = {
        nodes: graphData.nodes.map((n) => ({
          temp_id: n.id,
          node_type: n.nodeType,
          name: n.name,
          description: n.description,
          x: n.x,
          y: n.y,
        })),
        edges: graphData.edges.map((e) => ({
          temp_id: e.id,
          source: e.source,
          target: e.target,
          relation_type: e.relationType,
          confidence: e.confidence,
          evidence: e.evidence,
        })),
      };
      await updateDraftGraph(id, toSave as unknown as GraphData);
      const result = await confirmDraftGraph(id);
      if (result.proposal_id) {
        navigate(`/clustering/${result.proposal_id}`);
      } else {
        setError('图谱已确认，但生成插入建议失败: ' + (result.error || '未知错误'));
      }
    } catch (e: unknown) {
      setError('确认失败: ' + toErrorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  const sheetOpen = selectedNode !== null || selectedEdge !== null;

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedNode(null);
      setSelectedEdge(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={3} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      {/* Full-bleed canvas */}
      <div className="relative flex-1">
        <GraphEditor
          graphData={graphData}
          onChange={() => {}}
          editable
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
        />

        {/* Error banner — floating top-left over canvas */}
        {error && (
          <div className="absolute left-4 right-4 top-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Confirm button — floating bottom-right over canvas */}
        <div className="absolute bottom-4 right-4">
          <Button
            onClick={handleConfirm}
            disabled={confirming}
            className="shadow-lg"
          >
            {confirming ? '确认中...' : '确认图谱'}
          </Button>
        </div>
      </div>

      {/* Sheet inspector */}
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="right">
          {selectedNode && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedNode.name}</SheetTitle>
                <SheetDescription>节点详情 — {selectedNode.nodeType}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                <NodeInspector
                  node={selectedNode}
                  editable
                  onUpdate={handleNodeUpdate}
                  onDelete={handleNodeDelete}
                />
              </div>
            </>
          )}
          {selectedEdge && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedEdge.relationType}</SheetTitle>
                <SheetDescription>关系详情</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto">
                <EdgeInspector
                  edge={selectedEdge}
                  editable
                  onUpdate={handleEdgeUpdate}
                  onDelete={handleEdgeDelete}
                />
              </div>
            </>
          )}
          <SheetFooter />
        </SheetContent>
      </Sheet>
    </div>
  );
}
