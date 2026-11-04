import { CheckCircle2, FolderCheck, Loader2, RefreshCcw, ScrollText, XCircle } from 'lucide-react'
import { memo } from 'react'
import type * as React from 'react'
import type { DownloadItemEvent } from '@shared/types'
import { formatBytes } from '@renderer/utils/ui'
import { cn } from '@renderer/utils/ui'
import { useI18n } from '@renderer/i18n'

interface LogPanelProps {
  items: DownloadItemEvent[]
  running: boolean
}

// 文案随语言变化，所以只记 key，渲染时再取
const STATUS_META = {
  ok: { icon: CheckCircle2, tone: 'text-emerald-400', key: 'log.statusOk' },
  exists: { icon: FolderCheck, tone: 'text-sky-400', key: 'log.statusExists' },
  replaced: { icon: RefreshCcw, tone: 'text-amber-400', key: 'log.statusReplaced' },
  failed: { icon: XCircle, tone: 'text-destructive', key: 'log.statusFailed' }
} as const

/**
 * 单行日志。
 *
 * 下载时每个文件都会往列表最前面插一条，整块列表跟着父组件重渲染；
 * 条目对象是复用的（插新条目不会克隆旧条目），所以 memo 一挡，
 * 每次只有新增那一行真正渲染，500 行的历史记录不再逐帧 diff。
 */
const LogRow = memo(function LogRow({ item }: { item: DownloadItemEvent }): React.JSX.Element {
  const { t } = useI18n()
  const meta = STATUS_META[item.status]
  const Icon = meta.icon
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 font-mono text-[11px]">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.tone)} />
      <div className="min-w-0 flex-1">
        <p className="break-all leading-5 text-foreground/90">{item.label}</p>
        {item.error ? (
          <p className="break-all text-[10px] leading-4 text-destructive/80">{item.error}</p>
        ) : null}
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {item.status === 'ok' || item.status === 'replaced'
          ? `${t(meta.key)} ${formatBytes(item.bytes)}`
          : t(meta.key)}
      </span>
    </li>
  )
})

export function LogPanel({ items, running }: LogPanelProps): React.JSX.Element {
  const { t } = useI18n()

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
          <ScrollText className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('log.emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('log.emptyHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/70 bg-card/40">
      <ul className="divide-y divide-border/40">
        {items.map((item) => (
          <LogRow key={item.seq} item={item} />
        ))}
      </ul>
      {running ? (
        <div className="flex items-center justify-center gap-2 border-t border-border/40 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('log.running')}
        </div>
      ) : null}
    </div>
  )
}
