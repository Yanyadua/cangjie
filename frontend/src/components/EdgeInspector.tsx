import type { GraphEdge } from '../types/graph';
import { RELATION_TYPES } from '../types/graph';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';

export type EdgeInspectorProps = {
  edge: GraphEdge;
  editable?: boolean;
  onUpdate?: (edge: GraphEdge) => void;
  onDelete?: (id: string) => void;
};

export default function EdgeInspector({ edge, editable = false, onUpdate, onDelete }: EdgeInspectorProps) {
  const handleChange = (field: string, value: string | number) => {
    if (!onUpdate) return;
    onUpdate({ ...edge, [field]: value });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-base font-semibold text-text">关系详情</h3>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">源节点</Label>
        <div className="text-sm font-medium text-text">{edge.source}</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">目标节点</Label>
        <div className="text-sm font-medium text-text">{edge.target}</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">关系类型</Label>
        {editable ? (
          <select
            value={edge.relationType}
            onChange={(e) => handleChange('relationType', e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-text">{edge.relationType}</div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">置信度</Label>
        {editable ? (
          <Input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={edge.confidence ?? 0.5}
            onChange={(e) => handleChange('confidence', parseFloat(e.target.value))}
          />
        ) : (
          <div className="text-sm text-text">{edge.confidence?.toFixed(2) ?? '-'}</div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">证据</Label>
        {editable ? (
          <Textarea
            value={edge.evidence || ''}
            onChange={(e) => handleChange('evidence', e.target.value)}
            rows={3}
          />
        ) : (
          <div className="text-sm text-text-subtle">{edge.evidence || '-'}</div>
        )}
      </div>

      {editable && onDelete && (
        <Button
          variant="destructive"
          onClick={() => onDelete(edge.id)}
        >
          删除关系
        </Button>
      )}
    </div>
  );
}
