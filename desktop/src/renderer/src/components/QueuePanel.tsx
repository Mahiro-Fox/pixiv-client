import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FolderOpen,
  ListRestart,
  Loader2,
  Play,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import type { FailureItem, QueueStatus, QueueSummary } from '@shared/types'
import { cn, formatBytes, formatElapsed } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { MessageKey } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface QueuePanelProps {
  jobs: QueueSummary[]
  running: boolean
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onOpenDir: (dir: string) => void
  loadFailures: (id: string) => Promise<FailureItem[]>
  onExportFailures: (id: string) => void
}

const STATUS_TEXT: Record<QueueStatus, MessageKey> = {
  resolving: 'queue.statusResolving',
  downloading: 'queue.statusDownloading',
  paused: 'queue.statusPaused',
  done: 'queue.statusDone'
}

const STATUS_VARIANT: Record<
  QueueStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  resolving: 'warning',
  downloading: 'default',
  paused: 'destructive',
  done: 'success'
}

function jobPercent(job: QueueSummary): number {
  if (!job.total) return 0
  return Math.round(((job.ok + job.exists) / job.total) * 100)
}

export function QueuePanel(props: QueuePanelProps): React.JSX.Element | null {
  const { t } = useI18n()
  /** 当前展开失败详情的任务；失败清单按需拉取 */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, FailureItem[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)

  if (props.jobs.length === 0) return null

  const toggleFailures = async (id: string): Promise<void> => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (failures[id]) return
    setLoadingId(id)
    try {
      const items = await props.loadFailures(id)
      setFailures((previous) => ({ ...previous, [id]: items }))
    } catch {
      setFailures((previous) => ({ ...previous, [id]: [] }))
    } finally {
      setLoadingId(null)
    }
  }

  const handleResume = (id: string): void => {
    // 重试会改写失败状态，清掉缓存与展开，避免展示过期错误
    setExpandedId(null)
    setFailures((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    props.onResume(id)
  }

  return (
    <Card className="shrink-0">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <ListRestart className="h-4 w-4 text-primary" />
          {t('queue.title')}
        </CardTitle>
        <Badge variant="outline">{t('queue.resumable', { count: props.jobs.length })}</Badge>
      </CardHeader>
      <CardContent className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto">
        {props.jobs.map((job) => {
          const percent = jobPercent(job)
          const failureCount = job.failed + job.resolveFailed
          const expanded = expandedId === job.id
          const list = failures[job.id] || []

          return (
            <div
              key={job.id}
              className="rounded-lg border border-border/70 bg-background/50 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {t('queue.jobWorks', { tag: job.tag, count: job.totalWorks })}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{job.rootDir}</p>
                </div>
                <Badge variant={STATUS_VARIANT[job.status]}>{t(STATUS_TEXT[job.status])}</Badge>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {t('queue.done', { done: job.ok + job.exists, total: job.total, percent })}
                </span>
                {job.failed > 0 ? (
                  <span className="text-destructive">{t('queue.imageFailed', { count: job.failed })}</span>
                ) : null}
                {job.resolveFailed > 0 ? (
                  <span className="text-destructive">
                    {t('queue.resolveFailed', { count: job.resolveFailed })}
                  </span>
                ) : null}
                <span>{t('queue.pending', { count: job.pending })}</span>
                <span>{formatBytes(job.bytes)}</span>
                <span>{formatElapsed(job.updatedAt - job.createdAt)}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  disabled={props.running}
                  onClick={() => handleResume(job.id)}
                >
                  {props.running ? <Loader2 className="animate-spin" /> : <Play className="h-3 w-3" />}
                  {failureCount > 0
                    ? t('queue.retryFailed', { count: failureCount })
                    : t('queue.resume')}
                </Button>

                {failureCount > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void toggleFailures(job.id)}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {t('queue.failureDetail')}
                  </Button>
                ) : null}

                {failureCount > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => props.onExportFailures(job.id)}
                  >
                    <FileDown className="h-3 w-3" />
                    {t('queue.exportFailures')}
                  </Button>
                ) : null}

                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  disabled={props.running}
                  onClick={() => props.onRemove(job.id)}
                >
                  <Trash2 className="h-3 w-3" />
                  {t('queue.remove')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => props.onOpenDir(job.rootDir)}
                >
                  <FolderOpen className="h-3 w-3" />
                  {t('queue.openDir')}
                </Button>
              </div>

              {expanded ? (
                <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-secondary/20 p-2">
                  {loadingId === job.id ? (
                    <p className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('queue.loadingFailures')}
                    </p>
                  ) : list.length === 0 ? (
                    <p className="py-1 text-[11px] text-muted-foreground">
                      {t('queue.noFailures')}
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        {t('queue.failuresCount', { count: list.length })}
                      </p>
                      <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto">
                        {list.map((item, index) => (
                          <li
                            key={`${item.kind}-${item.illustId}-${index}`}
                            className="flex items-start gap-1.5 text-[11px]"
                          >
                            <span
                              className={cn(
                                'shrink-0 rounded px-1 py-0.5 text-[10px]',
                                item.kind === 'work'
                                  ? 'bg-amber-500/15 text-amber-500'
                                  : 'bg-destructive/15 text-destructive'
                              )}
                            >
                              {item.kind === 'work' ? t('queue.kindResolve') : t('queue.kindDownload')}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-foreground/90">{item.label}</p>
                              <p className="truncate text-muted-foreground">{item.error}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
