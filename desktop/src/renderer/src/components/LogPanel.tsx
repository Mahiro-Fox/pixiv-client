import { CheckCircle2, FolderCheck, Loader2, RefreshCcw, ScrollText, XCircle } from 'lucide-react'
import type * as React from 'react'
import type { DownloadItemEvent } from '@shared/types'
import { formatBytes } from '@renderer/lib/utils'
import { cn } from '@renderer/lib/utils'

interface LogPanelProps {
  items: DownloadItemEvent[]
  running: boolean
}

const STATUS_META = {
  ok: { icon: CheckCircle2, tone: 'text-emerald-400', text: '完成' },
  exists: { icon: FolderCheck, tone: 'text-sky-400', text: '已存在' },
  replaced: { icon: RefreshCcw, tone: 'text-amber-400', text: '覆盖' },
  failed: { icon: XCircle, tone: 'text-destructive', text: '失败' }
} as const

export function LogPanel({ items, running }: LogPanelProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
          <ScrollText className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">还没有下载记录</p>
          <p className="text-xs text-muted-foreground">开始下载后，每张图片的结果会实时记录在这里</p>
        </div>
      </div>
    )
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/70 bg-card/40">
      <ul className="divide-y divide-border/40">
        {items.map((item, index) => {
          const meta = STATUS_META[item.status]
          const Icon = meta.icon
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-start gap-2.5 px-3 py-2 font-mono text-[11px]"
            >
              <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.tone)} />
              <div className="min-w-0 flex-1">
                <p className="break-all leading-5 text-foreground/90">{item.label}</p>
                {item.error ? (
                  <p className="break-all text-[10px] leading-4 text-destructive/80">{item.error}</p>
                ) : null}
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.status === 'ok' || item.status === 'replaced'
                  ? `${meta.text} ${formatBytes(item.bytes)}`
                  : meta.text}
              </span>
            </li>
          )
        })}
      </ul>
      {running ? (
        <div className="flex items-center justify-center gap-2 border-t border-border/40 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          正在继续…
        </div>
      ) : null}
    </div>
  )
}
