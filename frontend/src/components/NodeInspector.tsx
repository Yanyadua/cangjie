import type { GraphNode } from '../types/graph';
import { NODE_TYPES } from '../types/graph';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { SELECT_CLASSNAME } from '@/lib/utils';

export type NodeInspectorProps = {
  node: GraphNode;
  editable?: boolean;
  onUpdate?: (node: GraphNode) => void;
  onDelete?: (id: string) => void;
};

export default function NodeInspector({ node, editable = false, onUpdate, onDelete }: NodeInspectorProps) {
  const handleChange = (field: string, value: string) => {
    if (!onUpdate) return;
    onUpdate({ ...node, [field]: value });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-base font-semibold text-text">节点详情</h3>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">名称</Label>
        {editable ? (
          <Input
            value={node.name}
            onChange={(e) => handleChange('name', e.target.value)}
          />
        ) : (
          <div className="text-sm font-semibold text-text">{node.name}</div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">类型</Label>
        {editable ? (
          <select
            value={node.nodeType}
            onChange={(e) => handleChange('nodeType', e.target.value)}
            className={SELECT_CLASSNAME}
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-text">{node.nodeType}</div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-text-muted">描述</Label>
        {editable ? (
          <Textarea
            value={node.description || ''}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={3}
          />
        ) : (
          <div className="text-sm text-text-subtle">{node.description || '-'}</div>
        )}
      </div>

      {editable && onDelete && (
        <Button
          variant="destructive"
          onClick={() => onDelete(node.id)}
        >
          删除节点
        </Button>
      )}
    </div>
  );
}
