import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { semanticSearch, graphEnhancedSearch } from '../api/client';
import SearchResults from '../components/SearchResults';
import { EmptyState } from '../components/EmptyState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toErrorMessage } from '../lib/errors';
import type { SearchResult } from '../types/graph';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'semantic' | 'graph'>('semantic');
  const [results, setResults] = useState<SearchResult>({ chunks: [], nodes: [], documents: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = mode === 'semantic'
        ? await semanticSearch(query)
        : await graphEnhancedSearch(query);
      setResults(res);
      setHasSearched(true);
    } catch (e: unknown) {
      setError('搜索失败: ' + toErrorMessage(e));
      setHasSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const hasResults =
    results.chunks.length > 0 || results.nodes.length > 0 || results.documents.length > 0;

  return (
    <div className="mx-auto max-w-[880px] p-6">
      <h2 className="mb-5 text-xl font-semibold text-text">知识搜索</h2>

      <div className="mb-3 flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入问题或关键词..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={loading} className="shrink-0">
          {loading && <Loader2 className="size-4 animate-spin" />}
          {loading ? '搜索中...' : '搜索'}
        </Button>
      </div>

      <div className="mb-4 flex gap-2">
        <Button
          variant={mode === 'semantic' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('semantic')}
        >
          语义搜索
        </Button>
        <Button
          variant={mode === 'graph' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('graph')}
        >
          图谱增强搜索
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && <LoadingSkeleton />}

      {!loading && !error && hasSearched && !hasResults && (
        <EmptyState title="暂无结果" hint="换个关键词试试" />
      )}

      {!loading && !error && hasResults && <SearchResults results={results} />}
    </div>
  );
}
