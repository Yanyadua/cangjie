import React from 'react';
import type { GraphNode, NodeType } from '../types/graph';
import { NODE_TYPES } from '../types/graph';

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
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>节点详情</h3>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>名称</label>
        {editable ? (
          <input
            value={node.name}
            onChange={(e) => handleChange('name', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4 }}
          />
        ) : (
          <div style={{ fontWeight: 600 }}>{node.name}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>类型</label>
        {editable ? (
          <select
            value={node.nodeType}
            onChange={(e) => handleChange('nodeType', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4 }}
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : (
          <div>{node.nodeType}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>描述</label>
        {editable ? (
          <textarea
            value={node.description || ''}
            onChange={(e) => handleChange('description', e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, resize: 'vertical' }}
          />
        ) : (
          <div style={{ color: '#475569' }}>{node.description || '-'}</div>
        )}
      </div>

      {editable && onDelete && (
        <button
          onClick={() => onDelete(node.id)}
          style={{
            marginTop: 8,
            padding: '6px 16px',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          删除节点
        </button>
      )}
    </div>
  );
}
