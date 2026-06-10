import React from 'react';
import type { InsertionProposalJSON } from '../types/graph';

export type ProposalPanelProps = {
  proposal: InsertionProposalJSON;
  onApply: () => void;
  loading?: boolean;
};

export default function ProposalPanel({ proposal, onApply, loading }: ProposalPanelProps) {
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>插入建议</h3>

      {/* Candidate Positions */}
      {proposal.candidate_positions?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, margin: '0 0 8px 0', color: '#334155' }}>候选位置</h4>
          {proposal.candidate_positions.map((pos, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                marginBottom: 6,
                background: '#f0f9ff',
                borderRadius: 6,
                borderLeft: '3px solid #3b82f6',
              }}
            >
              <div style={{ fontWeight: 600 }}>{pos.target_node_name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{pos.reason}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                匹配度: {(pos.score * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggested Merges */}
      {proposal.suggested_merges?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, margin: '0 0 8px 0', color: '#334155' }}>建议合并</h4>
          {proposal.suggested_merges.map((merge, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                marginBottom: 6,
                background: '#fef3c7',
                borderRadius: 6,
                borderLeft: '3px solid #f59e0b',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {merge.draft_node_temp_id} → {merge.existing_node_id}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{merge.reason}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                置信度: {(merge.confidence * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggested Edges */}
      {proposal.suggested_edges?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, margin: '0 0 8px 0', color: '#334155' }}>建议关系</h4>
          {proposal.suggested_edges.map((edge, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                marginBottom: 6,
                background: '#ecfdf5',
                borderRadius: 6,
                borderLeft: '3px solid #10b981',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {edge.source} —[{edge.relation_type}]→ {edge.target}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{edge.reason}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                置信度: {(edge.confidence * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Possible Conflicts */}
      {proposal.possible_conflicts?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, margin: '0 0 8px 0', color: '#dc2626' }}>潜在冲突</h4>
          {proposal.possible_conflicts.map((conflict, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                marginBottom: 6,
                background: '#fef2f2',
                borderRadius: 6,
                borderLeft: '3px solid #ef4444',
              }}
            >
              <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(conflict, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onApply}
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          background: loading ? '#94a3b8' : '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {loading ? '正在应用...' : '确认应用'}
      </button>
    </div>
  );
}
