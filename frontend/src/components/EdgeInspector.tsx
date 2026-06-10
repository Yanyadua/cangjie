import React from 'react';
import type { GraphEdge, RelationType } from '../types/graph';
import { RELATION_TYPES } from '../types/graph';

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
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>关系详情</h3>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>源节点</label>
        <div style={{ fontWeight: 500 }}>{edge.source}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>目标节点</label>
        <div style={{ fontWeight: 500 }}>{edge.target}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>关系类型</label>
        {editable ? (
          <select
            value={edge.relationType}
            onChange={(e) => handleChange('relationType', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4 }}
          >
            {RELATION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        ) : (
          <div>{edge.relationType}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>置信度</label>
        {editable ? (
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={edge.confidence ?? 0.5}
            onChange={(e) => handleChange('confidence', parseFloat(e.target.value))}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4 }}
          />
        ) : (
          <div>{edge.confidence?.toFixed(2) ?? '-'}</div>
        )}
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>证据</label>
        {editable ? (
          <textarea
            value={edge.evidence || ''}
            onChange={(e) => handleChange('evidence', e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, resize: 'vertical' }}
          />
        ) : (
          <div style={{ color: '#475569' }}>{edge.evidence || '-'}</div>
        )}
      </div>

      {editable && onDelete && (
        <button
          onClick={() => onDelete(edge.id)}
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
          删除关系
        </button>
      )}
    </div>
  );
}
