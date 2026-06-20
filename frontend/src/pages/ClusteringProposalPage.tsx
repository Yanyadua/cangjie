import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getClusteringProposal, updateClusteringProposal, applyClusteringProposal, listPartitions } from '../api/client';
import type { TagAction, ClusteringProposalJSON, PartitionAction } from '../types/graph';

const activeBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const inactiveBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: '#fff', color: '#64748b',
  border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};

export default function ClusteringProposalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<ClusteringProposalJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [editedActions, setEditedActions] = useState<TagAction[]>([]);

  // 分区选择 state
  const [partitionMode, setPartitionMode] = useState<'auto' | 'match' | 'new'>('auto');
  const [selectedPartitionId, setSelectedPartitionId] = useState<string>('');
  const [newPartitionName, setNewPartitionName] = useState('');
  const [newPartitionDesc, setNewPartitionDesc] = useState('');
  const [allPartitions, setAllPartitions] = useState<Array<{ id: string; name: string; description?: string }>>([]);

  useEffect(() => {
    if (!id) return;
    getClusteringProposal(id)
      .then((res) => {
        const pj = res.proposal_json as ClusteringProposalJSON;
        setProposal(pj);
        setEditedActions(pj.tag_actions);

        // 初始化分区选择
        const pa = pj.partition_action;
        if (pa) {
          if (pa.action === 'MATCH') {
            setSelectedPartitionId(pa.target_partition_id || '');
          } else if (pa.action === 'NEW') {
            setNewPartitionName(pa.proposed_name || '');
            setNewPartitionDesc(pa.proposed_description || '');
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // 加载所有分区列表（供手动选择）
    listPartitions()
      .then((data) => setAllPartitions(data || []))
      .catch(() => {});
  }, [id]);

  const toggleAction = (idx: number) => {
    setEditedActions(prev => prev.map((a, i) => {
      if (i !== idx) return a;
      if (a.action === 'MERGE') {
        return { ...a, action: 'NEW' as const, target_topic_id: undefined, temp_id: `t_${Date.now()}` };
      }
      return a;
    }));
  };

  const updateActionField = (idx: number, field: string, value: string) => {
    setEditedActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  const removeAction = (idx: number) => {
    setEditedActions(prev => prev.filter((_, i) => i !== idx));
  };

  const removeTopicEdge = (idx: number) => {
    if (!proposal) return;
    setProposal(prev => prev ? { ...prev, topic_edges: prev.topic_edges.filter((_, i) => i !== idx) } : prev);
  };

  const buildFinalPartitionAction = (): PartitionAction | undefined => {
    if (!proposal?.partition_action) return undefined;
    const base = proposal.partition_action;
    if (partitionMode === 'auto') return base;
    if (partitionMode === 'match') {
      if (!selectedPartitionId) return { ...base, action: 'MATCH' as const, target_partition_id: '', target_partition_name: '' };
      const target = allPartitions.find(p => p.id === selectedPartitionId);
      return {
        ...base,
        action: 'MATCH' as const,
        target_partition_id: selectedPartitionId,
        target_partition_name: target?.name || '',
      };
    }
    // new
    return {
      ...base,
      action: 'NEW' as const,
      proposed_name: newPartitionName.trim(),
      proposed_description: newPartitionDesc,
    };
  };

  const handleApply = async () => {
    if (!id || !proposal) return;
    setApplying(true);
    try {
      const finalPA = buildFinalPartitionAction();
      const updated = {
        ...proposal,
        partition_action: finalPA || proposal.partition_action,
        tag_actions: editedActions,
      };
      await updateClusteringProposal(id, updated);
      const result = await applyClusteringProposal(id);
      if (result.status === 'applied') {
        const counts = result.knowledge_nodes_created || {};
        const summary = Object.entries(counts)
          .map(([type, n]) => `${type}: ${n}`)
          .join('，');
        alert(
          `应用成功\n\n入库统计：\n${summary || '无知识节点'}\n知识边：${result.knowledge_edges_created || 0}`
        );
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
  if (!proposal) return <div style={{ padding: 24 }}>未找到聚类提案</div>;

  const pa = proposal.partition_action;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 8px 0' }}>主题聚类提案</h2>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{proposal.article_title}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{proposal.article_summary}</div>
      </div>

      {/* 分区归属卡片 */}
      {pa && (
        <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            📁 分区归属
            {pa.action === 'NEW' && (
              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
                建议新建分区
              </span>
            )}
            {pa.action === 'MATCH' && (
              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#dbeafe', color: '#1d4ed8' }}>
                匹配到「{pa.target_partition_name}」({(pa.score * 100).toFixed(0)}%)
              </span>
            )}
          </h3>

          {pa.reason && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{pa.reason}</div>
          )}

          {/* 模式切换 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setPartitionMode('auto')} style={partitionMode === 'auto' ? activeBtnStyle : inactiveBtnStyle}>
              按建议
            </button>
            <button onClick={() => setPartitionMode('match')} style={partitionMode === 'match' ? activeBtnStyle : inactiveBtnStyle}>
              挂载已有
            </button>
            <button onClick={() => setPartitionMode('new')} style={partitionMode === 'new' ? activeBtnStyle : inactiveBtnStyle}>
              新建分区
            </button>
          </div>

          {/* auto 模式 */}
          {partitionMode === 'auto' && pa.action === 'MATCH' && (
            <div style={{ fontSize: 14, color: '#1e293b' }}>→ {pa.target_partition_name}</div>
          )}
          {partitionMode === 'auto' && pa.action === 'NEW' && (
            <div style={{ fontSize: 14, color: '#1e293b' }}>
              → 新建「{pa.proposed_name}」{pa.proposed_description && <span style={{ color: '#64748b' }}> — {pa.proposed_description}</span>}
            </div>
          )}

          {/* match 模式 */}
          {partitionMode === 'match' && (
            <select
              value={selectedPartitionId}
              onChange={e => setSelectedPartitionId(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14 }}
            >
              <option value="">请选择分区...</option>
              {allPartitions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* new 模式 */}
          {partitionMode === 'new' && (
            <div>
              <input
                value={newPartitionName}
                onChange={e => setNewPartitionName(e.target.value)}
                placeholder="分区名（如：智能体）"
                style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, marginBottom: 6 }}
              />
              <input
                value={newPartitionDesc}
                onChange={e => setNewPartitionDesc(e.target.value)}
                placeholder="分区描述..."
                style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}
              />
            </div>
          )}

          {/* 候选列表 */}
          {pa.candidates?.length > 0 && partitionMode !== 'new' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>其他候选分区:</div>
              {pa.candidates.map(c => (
                <div key={c.id} style={{ fontSize: 12, color: '#64748b', padding: '2px 0' }}>
                  {c.name} — {(c.score * 100).toFixed(0)}%
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tag Actions */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, margin: '0 0 12px 0' }}>
          标签聚类 ({editedActions.length})
        </h3>
        {editedActions.map((action, idx) => (
          <div
            key={idx}
            style={{
              padding: 14,
              marginBottom: 8,
              background: action.action === 'MERGE' ? '#f0f9ff' : '#fefce8',
              borderRadius: 8,
              borderLeft: action.action === 'MERGE' ? '3px solid #3b82f6' : '3px solid #f59e0b',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{action.tag_name}</span>
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: action.action === 'MERGE' ? '#dbeafe' : '#fef3c7',
                  color: action.action === 'MERGE' ? '#1d4ed8' : '#92400e',
                }}>
                  {action.action === 'MERGE' ? '合并到已有' : '新建主题'}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  置信度 {(action.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <button
                onClick={() => removeAction(idx)}
                style={{ padding: '2px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12 }}
              >
                删除
              </button>
            </div>

            {action.reason && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{action.reason}</div>
            )}

            {/* Matched candidates for MERGE actions */}
            {action.action === 'MERGE' && action.matched_candidates?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>匹配到的已有主题:</div>
                {action.matched_candidates.map((c, ci) => (
                  <div key={ci} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 4, fontSize: 12,
                  }}>
                    <span>{c.name}</span>
                    <span style={{ color: '#94a3b8' }}>相似度 {(c.similarity * 100).toFixed(0)}%</span>
                  </div>
                ))}
                <button
                  onClick={() => toggleAction(idx)}
                  style={{ marginTop: 4, padding: '2px 8px', border: '1px solid #f59e0b', background: '#fff', borderRadius: 4, color: '#f59e0b', cursor: 'pointer', fontSize: 11 }}
                >
                  改为新建主题
                </button>
              </div>
            )}

            {/* Editable fields for NEW actions */}
            {action.action === 'NEW' && (
              <div style={{ marginTop: 6 }}>
                <input
                  value={action.proposed_description || ''}
                  onChange={e => updateActionField(idx, 'proposed_description', e.target.value)}
                  placeholder="输入新主题描述..."
                  style={{ width: '100%', padding: 6, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12 }}
                />
                {action.matched_candidates?.length > 0 && (
                  <button
                    onClick={() => toggleAction(idx)}
                    style={{ marginTop: 4, padding: '2px 8px', border: '1px solid #3b82f6', background: '#fff', borderRadius: 4, color: '#3b82f6', cursor: 'pointer', fontSize: 11 }}
                  >
                    改为合并到已有
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Topic Edges */}
      {proposal.topic_edges?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 12px 0' }}>
            主题间关系 ({proposal.topic_edges.length})
          </h3>
          {proposal.topic_edges.map((edge, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: 8, marginBottom: 4,
                background: '#f8fafc', borderRadius: 6, fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 500 }}>{edge.source_tag}</span>
              <span style={{ color: '#3b82f6' }}>[{edge.relation_type}]</span>
              <span style={{ fontWeight: 500 }}>{edge.target_tag}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>{edge.reason}</span>
              <button
                onClick={() => removeTopicEdge(idx)}
                style={{ padding: '2px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 11 }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Apply button */}
      <button
        onClick={handleApply}
        disabled={applying}
        style={{
          width: '100%', padding: '12px',
          background: applying ? '#94a3b8' : '#3b82f6',
          color: '#fff', border: 'none', borderRadius: 8,
          cursor: applying ? 'not-allowed' : 'pointer',
          fontSize: 15, fontWeight: 600,
        }}
      >
        {applying ? '正在写入全局图谱...' : '确认并写入全局图谱'}
      </button>
    </div>
  );
}
