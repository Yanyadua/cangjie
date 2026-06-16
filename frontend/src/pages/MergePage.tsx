import React, { useEffect, useState, useCallback } from 'react';
import {
  detectDuplicateTopics,
  mergeNodes,
  listPartitions,
  mergePartitions,
  getPartitionChildren,
  splitPartition,
} from '../api/client';

type DuplicatePair = {
  source: { id: string; name: string; description?: string };
  target: { id: string; name: string; description?: string };
  similarity: number;
};

type Partition = {
  id: string;
  name: string;
  description?: string;
  article_count?: number;
  topic_count?: number;
};

type PartitionChild = {
  topics: Array<{ id: string; name: string; description?: string }>;
  articles: Array<{ id: string; name: string; description?: string }>;
};

type Tab = 'dedup' | 'mergePartition' | 'splitPartition';

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  fontSize: 14,
  border: 'none',
  borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#3b82f6' : '#64748b',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});

export default function MergePage() {
  const [tab, setTab] = useState<Tab>('dedup');

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h2 style={{ margin: '0 0 16px 0' }}>合并去重管理</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'dedup')} onClick={() => setTab('dedup')}>Topic 去重</button>
        <button style={tabStyle(tab === 'mergePartition')} onClick={() => setTab('mergePartition')}>分区合并</button>
        <button style={tabStyle(tab === 'splitPartition')} onClick={() => setTab('splitPartition')}>分区拆分</button>
      </div>

      {tab === 'dedup' && <DedupTab />}
      {tab === 'mergePartition' && <MergePartitionTab />}
      {tab === 'splitPartition' && <SplitPartitionTab />}
    </div>
  );
}

// ── Tab 1: Topic 去重 ──

function DedupTab() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await detectDuplicateTopics(0.82);
      setPairs(data || []);
    } catch (e) {
      console.error('检测失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMerge = async (sourceId: string, targetId: string, pairKey: string) => {
    setMerging(pairKey);
    try {
      await mergeNodes(sourceId, targetId);
      await load();
    } catch (e: any) {
      alert('合并失败: ' + (e?.message || '未知错误'));
    } finally {
      setMerging(null);
    }
  };

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>检测中...</div>;

  if (pairs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
        <div style={{ fontSize: 15, marginBottom: 8 }}>没有检测到重复 topic</div>
        <button onClick={load} style={{ padding: '6px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
          重新检测
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
        检测到 {pairs.length} 组相似 topic，选择合并方向（箭头指向被保留的节点）：
      </div>
      {pairs.map((pair, idx) => {
        const pairKey = `${pair.source.id}-${pair.target.id}`;
        return (
          <div key={pairKey} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 14, marginBottom: 8, background: '#f8fafc',
            borderRadius: 8, border: '1px solid #e2e8f0',
          }}>
            {/* source */}
            <NodeCard name={pair.source.name} description={pair.source.description} />

            {/* similarity */}
            <div style={{ textAlign: 'center', minWidth: 60 }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>相似度</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>
                {(pair.similarity * 100).toFixed(0)}%
              </div>
            </div>

            {/* target */}
            <NodeCard name={pair.target.name} description={pair.target.description} />

            {/* merge buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 }}>
              <button
                onClick={() => handleMerge(pair.source.id, pair.target.id, pairKey)}
                disabled={merging === pairKey}
                style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #3b82f6', borderRadius: 4, cursor: 'pointer', background: '#fff', color: '#3b82f6' }}
              >
                ← 合并到右边
              </button>
              <button
                onClick={() => handleMerge(pair.target.id, pair.source.id, pairKey)}
                disabled={merging === pairKey}
                style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #3b82f6', borderRadius: 4, cursor: 'pointer', background: '#fff', color: '#3b82f6' }}
              >
                合并到左边 →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeCard({ name, description }: { name: string; description?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{name}</div>
      {description && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {description}
        </div>
      )}
    </div>
  );
}

// ── Tab 2: 分区合并 ──

function MergePartitionTab() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e) {
      console.error('加载分区失败', e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleMerge = async () => {
    if (!sourceId || !targetId || sourceId === targetId) {
      alert('请选择不同的源分区和目标分区');
      return;
    }
    const src = partitions.find(p => p.id === sourceId);
    if (!confirm(`确定将「${src?.name}」合并到「${partitions.find(p => p.id === targetId)?.name}」吗？\n源分区将被删除，其下所有 topic 和文章转移到目标分区。`)) return;

    setLoading(true);
    try {
      await mergePartitions(sourceId, targetId);
      setSourceId('');
      setTargetId('');
      await load();
      alert('合并成功');
    } catch (e: any) {
      alert('合并失败: ' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  if (partitions.length < 2) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>至少需要 2 个分区才能合并</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        选择两个分区合并。源分区的所有 topic 和文章将转移到目标分区，源分区将被删除。
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>源分区（将被删除）</label>
          <select value={sourceId} onChange={e => setSourceId(e.target.value)}
            style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}>
            <option value="">请选择...</option>
            {partitions.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.topic_count ?? 0}主题 · {p.article_count ?? 0}文章)</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 20, color: '#94a3b8', paddingBottom: 8 }}>→</div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>目标分区（保留）</label>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}>
            <option value="">请选择...</option>
            {partitions.filter(p => p.id !== sourceId).map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.topic_count ?? 0}主题 · {p.article_count ?? 0}文章)</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleMerge}
        disabled={loading || !sourceId || !targetId || sourceId === targetId}
        style={{
          padding: '10px 24px', background: (!sourceId || !targetId || sourceId === targetId) ? '#cbd5e1' : '#ef4444',
          color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
        }}
      >
        {loading ? '合并中...' : '确认合并'}
      </button>
    </div>
  );
}

// ── Tab 3: 分区拆分 ──

function SplitPartitionTab() {
  const [partitions, setPartitions] = useState<Partition[]>([]);
  const [selectedPartition, setSelectedPartition] = useState('');
  const [children, setChildren] = useState<PartitionChild | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const loadPartitions = useCallback(async () => {
    try {
      const data = await listPartitions();
      setPartitions(data || []);
    } catch (e) {
      console.error('加载分区失败', e);
    }
  }, []);

  useEffect(() => { loadPartitions(); }, [loadPartitions]);

  const loadChildren = useCallback(async (pid: string) => {
    if (!pid) { setChildren(null); return; }
    try {
      const data = await getPartitionChildren(pid);
      setChildren(data);
      setSelectedTopics(new Set());
    } catch (e) {
      console.error('加载分区内容失败', e);
    }
  }, []);

  const toggleTopic = (id: string) => {
    setSelectedTopics(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSplit = async () => {
    if (selectedTopics.size === 0) { alert('请至少选择一个 topic'); return; }
    if (!newName.trim()) { alert('请输入新分区名'); return; }

    setLoading(true);
    try {
      await splitPartition(selectedPartition, Array.from(selectedTopics), newName.trim(), newDesc.trim());
      setNewName('');
      setNewDesc('');
      setSelectedTopics(new Set());
      await loadChildren(selectedPartition);
      alert(`拆分成功！已将 ${selectedTopics.size} 个 topic 转移到新分区「${newName}」`);
    } catch (e: any) {
      alert('拆分失败: ' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        从已有分区中选取部分 topic，创建新分区并转移。
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>选择源分区</label>
        <select
          value={selectedPartition}
          onChange={e => { setSelectedPartition(e.target.value); loadChildren(e.target.value); }}
          style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, boxSizing: 'border-box' }}
        >
          <option value="">请选择分区...</option>
          {partitions.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {children && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1e293b' }}>
              选择要拆分的 topic ({children.topics.length} 个可选，已选 {selectedTopics.size})
            </div>
            {children.topics.length === 0 ? (
              <div style={{ fontSize: 13, color: '#94a3b8', padding: 8 }}>该分区下没有 topic</div>
            ) : (
              children.topics.map(t => (
                <label key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', marginBottom: 4, background: '#f8fafc',
                  borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={selectedTopics.has(t.id)}
                    onChange={() => toggleTopic(t.id)}
                  />
                  <span style={{ fontWeight: 500 }}>{t.name}</span>
                  {t.description && <span style={{ color: '#94a3b8' }}>— {t.description}</span>}
                </label>
              ))
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="新分区名"
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' }}
            />
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="新分区描述（可选）"
              style={{ width: '100%', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>

          <button
            onClick={handleSplit}
            disabled={loading || selectedTopics.size === 0 || !newName.trim()}
            style={{
              padding: '10px 24px',
              background: (loading || selectedTopics.size === 0 || !newName.trim()) ? '#cbd5e1' : '#3b82f6',
              color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
            }}
          >
            {loading ? '拆分中...' : `拆分 ${selectedTopics.size} 个 topic 到新分区`}
          </button>
        </>
      )}
    </div>
  );
}
