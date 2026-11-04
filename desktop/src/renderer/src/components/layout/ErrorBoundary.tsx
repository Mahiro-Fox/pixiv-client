import { useI18n } from '@renderer/i18n';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from '../ui/button';

interface BoundaryProps {
  labels: { title: string; body: string; retry: string; reload: string };
  children?: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * 渲染异常兜底（类组件：函数组件接不到 componentDidCatch）。
 *
 * 之前任何一处渲染抛错都会让整个窗口白屏，而且没有任何提示 —— 配合托盘常驻，
 * 用户会以为程序还在跑，其实界面已经没了。这里只兜住路由内容区，
 * 顶栏、托盘和后台下载不受影响，并提供「重试 / 重新加载」两条出路。
 */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 没有接日志服务，至少把异常和组件栈留在控制台，方便反馈时定位是哪个页面
    console.error('[render]', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { labels } = this.props;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3 rounded-xl border border-destructive/40 bg-card/60 p-5 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium">{labels.title}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {labels.body}
          </p>
          {/* 异常原文对定位问题有用，用小字露出来，不占版面 */}
          <p className="max-h-24 overflow-auto break-all rounded-lg bg-secondary/50 px-2 py-1.5 text-left font-mono text-[10px] leading-4 text-muted-foreground/80">
            {error.message || String(error)}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={this.retry}
            >
              <RotateCcw className="h-4 w-4" />
              {labels.retry}
            </Button>
            <Button type="button" size="sm" onClick={this.reload}>
              {labels.reload}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** 文案要跟随界面语言，类组件里用不了 hook，所以在这里取好再传进去 */
export function ErrorBoundary({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Boundary
      labels={{
        title: t('error.crashTitle'),
        body: t('error.crashBody'),
        retry: t('error.retry'),
        reload: t('error.reload'),
      }}
    >
      {children}
    </Boundary>
  );
}
