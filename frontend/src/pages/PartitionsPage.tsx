import React, { useEffect, useState, useCallback } from 'react';
import { listPartitions, createPartition, updatePartition, deletePartition } from '../api/client';

type Partition = {
  id: string;
  name: string;
  description?: string;
  article_count?: number;
  topic_count?: number;
};

export default function PartitionsPage() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e) {
      console.error('加载分区失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createPartition(newName.trim(), newDesc.trim());
      setNewName('');
      setNewDesc('');
      await load();
    } catch (e: any) {
      alert('创建失败: ' + (e?.message || '未知错误'));
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await updatePartition(id, { name: editName.trim(), description: editDesc });
      setEditingId(null);
      await load();
    } catch (e: any) {
      alert('更新失败: ' + (e?.message || '未知错误'));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除分区「${name}」吗？分区下的文章和主题不会被删除。`)) return;
    try {
      await deletePartition(id);
      await load();
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || '未知错误'));
    }
  };

  const startEdit = (p: Partition) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditDesc(p.description || '');
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h2 style={{ margin: '0 0 20px 0' }}>分区管理</h2>

      {/* 新建分区 */}
      <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: '#1e293b' }}>新建分区</div>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="分区名（如：智能体）"
          style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' }}
        />
        <input
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="分区描述（可选）"
          style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          style={{
            padding: '8px 20px', border: 'none', borderRadius: 4, cursor: newName.trim() ? 'pointer' : 'not-allowed',
            background: newName.trim() ? '#3b82f6' : '#cbd5e1', color: '#fff', fontSize: 14,
          }}
        >
          创建
        </button>
      </div>

      {/* 分区列表 */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>加载中...</div>
      ) : partitions.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
          还没有分区。导入文章后系统会自动建议分区，也可以在这里手动创建。
        </div>
      ) : (
        partitions.map(p => (
          <div
            key={p.id}
            style={{
              padding: 16, marginBottom: 8, background: '#fff', borderRadius: 8,
              border: '1px solid #e2e8f0', borderLeft: '3px solid #6366f1',
            }}
          >
            {editingId === p.id ? (
              /* 编辑模式 */
              <div>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' }}
                />
                <input
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  placeholder="分区描述..."
                  style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleUpdate(p.id)}
                    style={{ padding: '6px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    style={{ padding: '6px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              /* 展示模式 */
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: '#1e293b' }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {p.topic_count ?? 0} 主题 · {p.article_count ?? 0} 文章
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => startEdit(p)}
                      style={{ padding: '4px 10px', background: '#f1f5f9', border: 'none', borderRadius: 4, color: '#64748b', cursor: 'pointer', fontSize: 12 }}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      style={{ padding: '4px 10px', background: '#fef2f2', border: 'none', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 12 }}
                    >
                      删除
                    </button>
                  </div>
                </div>
                {p.description && (
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{p.description}</div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
