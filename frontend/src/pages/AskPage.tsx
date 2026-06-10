import React, { useState } from 'react';
import { askQuestion } from '../api/client';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [evidence, setEvidence] = useState<Array<{ source: string; text: string; document_title?: string }>>([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await askQuestion(question);
      setAnswer(res.answer);
      setEvidence(res.evidence || []);
    } catch (e: any) {
      setAnswer('回答生成失败: ' + (e?.message || '未知错误'));
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 20 }}>知识问答</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="输入你的问题..."
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14 }}
        />
        <button
          onClick={handleAsk}
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
          {loading ? '思考中...' : '提问'}
        </button>
      </div>

      {answer && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>回答</h3>
          <div style={{ padding: 16, background: '#f8fafc', borderRadius: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {answer}
          </div>
        </div>
      )}

      {evidence.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>证据来源</h3>
          {evidence.map((ev, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                marginBottom: 6,
                background: '#f0f9ff',
                borderRadius: 6,
                borderLeft: '3px solid #3b82f6',
                fontSize: 13,
              }}
            >
              <div style={{ color: '#475569' }}>{ev.text}</div>
              {ev.document_title && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>来自: {ev.document_title}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
