import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';

export default function GalaxyPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="relative flex h-[calc(100vh-56px)] w-full items-center justify-center">
      <div className="max-w-md p-6 text-center">
        <h1 className="mb-2 text-xl font-semibold text-text">星系内部视图</h1>
        <p className="mb-4 text-sm text-text-muted">
          分区 <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{id}</code> 的螺旋星云
          将在 <strong>Milestone 2</strong> 上线。
        </p>
        <p className="mb-6 text-xs text-text-subtle">
          当前路由占位，避免未来深链失效。返回宇宙宏观视图继续浏览。
        </p>
        <Button onClick={() => navigate('/cosmos')} variant="outline" size="sm">
          ◀ 返回宇宙
        </Button>
      </div>
    </div>
  );
}
