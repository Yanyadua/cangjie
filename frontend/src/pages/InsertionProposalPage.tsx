import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInsertionProposal, applyInsertionProposal } from '../api/client';
import ProposalPanel from '../components/ProposalPanel';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toErrorMessage } from '../lib/errors';
import type { InsertionProposalJSON } from '../types/graph';

export default function InsertionProposalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<InsertionProposalJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getInsertionProposal(id)
      .then((res) => {
        if (!cancelled) setProposal(res.proposal_json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(toErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const handleApply = async () => {
    if (!id) return;
    setApplying(true);
    setError('');
    try {
      const result = await applyInsertionProposal(id);
      if (result.status === 'applied') {
        navigate('/cosmos');
      } else {
        setError('应用失败: ' + JSON.stringify(result.errors || result.error));
      }
    } catch (e: unknown) {
      setError('应用失败: ' + toErrorMessage(e));
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[880px] p-6">
        <LoadingSkeleton count={4} />
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="mx-auto max-w-[880px] p-6">
        <EmptyState title="未找到插入建议" hint="该建议可能已被处理或链接有误" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[880px] p-6">
      <h2 className="mb-2 text-xl font-semibold text-text">插入建议</h2>
      <p className="mb-5 text-sm text-text-muted">
        系统根据新文章内容，在全局知识库中找到了以下连接建议。请检查后确认。
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ProposalPanel
        proposal={proposal}
        onApply={() => setConfirmOpen(true)}
        loading={applying}
      />

      {/* Confirmation dialog (replaces window.confirm) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认应用插入建议</DialogTitle>
            <DialogDescription>
              应用后将对全局知识图谱执行写入操作，此操作不可撤销。是否继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={applying}>
              取消
            </Button>
            <Button onClick={handleApply} disabled={applying}>
              {applying ? '正在应用...' : '确认应用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
