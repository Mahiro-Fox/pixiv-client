import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import type * as React from 'react'
import { dismissToast, useToasts, type ToastKind } from '@renderer/lib/toast'

/** 不同语气对应的图标与配色，避免用模板字符串拼 class（Tailwind 扫不到） */
const STYLE: Record<ToastKind, { icon: React.JSX.Element; className: string }> = {
  info: {
    icon: <Info className="h-3.5 w-3.5 shrink-0" />,
    className: 'border-border/70 bg-popover text-foreground'
  },
  success: {
    icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />,
    className: 'border-emerald-500/40 bg-popover text-foreground'
  },
  error: {
    icon: <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />,
    className: 'border-destructive/40 bg-popover text-foreground'
  }
}

/**
 * 轻提示渲染容器：挂在 App 根部一次即可。
 * `pointer-events-none` 让整条不影响下方点击，只有气泡本身可点关闭。
 */
export function Toaster(): React.JSX.Element | null {
  const items = useToasts()
  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((item) => {
        const style = STYLE[item.kind]
        return (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex max-w-[26rem] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-lg ${style.className}`}
          >
            {style.icon}
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
            <button
              type="button"
              aria-label="close"
              onClick={() => dismissToast(item.id)}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
