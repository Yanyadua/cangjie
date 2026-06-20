import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
import { askQuestion } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toErrorMessage } from '../lib/errors';

type Evidence = { source: string; text: string; document_title?: string };

type Turn = {
  id: string;
  question: string;
  answer: string;
  evidence: Evidence[];
  error?: boolean;
};

export default function AskPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, loading]);

  const send = async () => {
    const q = draft.trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    setDraft('');
    try {
      const res = await askQuestion(q);
      setTurns((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          question: q,
          answer: res.answer,
          evidence: res.evidence || [],
        },
      ]);
    } catch (e: unknown) {
      const msg = '回答生成失败: ' + toErrorMessage(e);
      setError(msg);
      setTurns((prev) => [
        ...prev,
        { id: `${Date.now()}`, question: q, answer: msg, evidence: [], error: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] max-w-[880px] flex-col">
      {/* Conversation scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
        {turns.length === 0 && !loading && (
          <EmptyState title="向知识库提问" hint="在下方输入框输入问题，按 Enter 发送。" />
        )}

        <div className="flex flex-col gap-3">
          {turns.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="max-w-[80%] self-end rounded-xl bg-accent-soft px-3 py-2 text-sm text-text">
                  {t.question}
                </div>
              </div>
              {/* AI bubble */}
              <div className="flex justify-start">
                <div className="max-w-[85%] self-start rounded-xl bg-surface px-3 py-2 text-sm leading-relaxed text-text shadow-sm">
                  <div className="whitespace-pre-wrap">{t.answer}</div>
                  {t.evidence.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                      {t.evidence.map((ev, i) => (
                        <button
                          key={`${ev.source}-${i}`}
                          type="button"
                          onClick={() => navigate('/graph')}
                          title={ev.text}
                          aria-label={`查看来源：${ev.document_title || ev.source}`}
                          className="inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-transparent bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {ev.document_title || ev.source || '来源'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex max-w-[85%] flex-col gap-1.5 self-start rounded-xl bg-surface px-3 py-3 shadow-sm">
                <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-64 animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
              </div>
            </div>
          )}
        </div>
      </div>

      {error && !loading && (
        <div className="px-6">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Bottom input bar */}
      <div className="border-t border-border bg-surface px-6 py-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="向知识库提问... (Enter 发送，Shift+Enter 换行)"
            rows={1}
            className="min-h-[40px] flex-1 resize-none"
          />
          <Button onClick={send} disabled={loading || !draft.trim()} className="shrink-0">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
