import React, { useState } from 'react';
import { semanticSearch, graphEnhancedSearch } from '../api/client';
import SearchResults from '../components/SearchResults';
import type { SearchResult } from '../types/graph';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'semantic' | 'graph'>('semantic');
  const [results, setResults] = useState<SearchResult>({ chunks: [], nodes: [], documents: [] });
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = mode === 'semantic'
        ? await semanticSearch(query)
        : await graphEnhancedSearch(query);
      setResults(res);
    } catch (e: any) {
      alert('搜索失败: ' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 20 }}>知识搜索</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入问题或关键词..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '搜索中...' : '搜索'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode('semantic')}
          style={{
            padding: '4px 12px',
            border: '1px solid',
            borderColor: mode === 'semantic' ? '#3b82f6' : '#e2e8f0',
            background: mode === 'semantic' ? '#eff6ff' : '#fff',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          语义搜索
        </button>
        <button
          onClick={() => setMode('graph')}
          style={{
            padding: '4px 12px',
            border: '1px solid',
            borderColor: mode === 'graph' ? '#3b82f6' : '#e2e8f0',
            background: mode === 'graph' ? '#eff6ff' : '#fff',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          图谱增强搜索
        </button>
      </div>

      {(results.chunks.length > 0 || results.nodes.length > 0 || results.documents.length > 0) && (
        <SearchResults results={results} />
      )}
    </div>
  );
}
