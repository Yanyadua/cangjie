import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getInsertionProposal, applyInsertionProposal } from '../api/client';
import ProposalPanel from '../components/ProposalPanel';
import type { InsertionProposalJSON } from '../types/graph';

export default function InsertionProposalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<InsertionProposalJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!id) return;
    getInsertionProposal(id)
      .then((res) => setProposal(res.proposal_json))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleApply = async () => {
    if (!id) return;
    setApplying(true);
    try {
      const result = await applyInsertionProposal(id);
      if (result.status === 'applied') {
        navigate('/graph');
      } else {
        alert('应用失败: ' + JSON.stringify(result.errors || result.error));
      }
    } catch (e: any) {
      alert('应用失败: ' + (e?.message || '未知错误'));
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!proposal) return <div style={{ padding: 24 }}>未找到插入建议</div>;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 20 }}>插入建议</h2>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        系统根据新文章内容，在全局知识库中找到了以下连接建议。请检查后确认。
      </p>
      <ProposalPanel proposal={proposal} onApply={handleApply} loading={applying} />
    </div>
  );
}
