import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { importDocument } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toErrorMessage } from '../lib/errors';

export default function ImportPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleImport = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题和正文不能为空');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await importDocument({
        title,
        source_type: sourceType || undefined,
        source_url: sourceUrl || undefined,
        author: author || undefined,
        content,
      });
      // Navigate to extraction wizard
      navigate(`/extract/${result.document_id}`);
    } catch (e: unknown) {
      setError(toErrorMessage(e) || '导入失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[880px] p-6">
      <h2 className="mb-5 text-xl font-semibold text-text">导入文章</h2>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-3.5">
        <Label className="mb-1 block text-[13px] font-medium">标题 *</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文章标题"
        />
      </div>

      <div className="mb-3.5 flex gap-3">
        <div className="flex-1">
          <Label className="mb-1 block text-[13px] font-medium">来源类型</Label>
          <Input
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            placeholder="如 wechat_article"
          />
        </div>
        <div className="flex-1">
          <Label className="mb-1 block text-[13px] font-medium">作者</Label>
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="作者"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <Label className="mb-1 block text-[13px] font-medium">来源链接</Label>
        <Input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="mb-5">
        <Label className="mb-1 block text-[13px] font-medium">正文 *</Label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴文章正文..."
          rows={12}
          className="resize-y"
        />
      </div>

      <Button
        onClick={handleImport}
        disabled={loading}
        size="lg"
        className="px-8"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {loading ? '正在处理...' : '导入并生成图谱'}
      </Button>
    </div>
  );
}
