import React from 'react';
import type { SearchResult } from '../types/graph';

export type SearchResultsProps = {
  results: SearchResult;
};

export default function SearchResults({ results }: SearchResultsProps) {
  const [tab, setTab] = React.useState<'chunks' | 'nodes' | 'documents'>('chunks');

  const tabItems = [
    { key: 'chunks' as const, label: `片段 (${results.chunks?.length || 0})` },
    { key: 'nodes' as const, label: `节点 (${results.nodes?.length || 0})` },
    { key: 'documents' as const, label: `文档 (${results.documents?.length || 0})` },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
        {tabItems.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: tab === t.key ? '#3b82f6' : '#f1f5f9',
              color: tab === t.key ? '#fff' : '#334155',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chunks' && (
        <div>
          {results.chunks?.map((chunk, i) => (
            <div key={chunk.id || i} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6 }}>
              <div style={{ fontSize: 13, color: '#334155' }}>{chunk.content.slice(0, 200)}...</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                匹配度: {((chunk.score || 0) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'nodes' && (
        <div>
          {results.nodes?.map((node, i) => (
            <div key={node.id || i} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>{node.name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{node.node_type}</div>
              {node.description && (
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{node.description}</div>
              )}
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                匹配度: {((node.score || 0) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'documents' && (
        <div>
          {results.documents?.map((doc, i) => (
            <div key={doc.id || i} style={{ padding: 10, marginBottom: 6, background: '#f8fafc', borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>{doc.title}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{doc.status}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
