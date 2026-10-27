import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  FileDown,
  FolderCheck,
  FolderOpen,
  HardDriveDownload,
  ListRestart,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { FailureItem, QueueStatus, QueueSummary } from '@shared/types'
import { cn, formatBytes, formatElapsed } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { MessageKey } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Progress } from './ui/progress'

interface QueuePanelProps {
  jobs: QueueSummary[]
  onResume: (id: string) => void
  onPause: (id: string) => void
  onRemove: (id: string) => void
  onOpenDir: (dir: string) => void
  loadFailures: (id: string) => Promise<FailureItem[]>
  onRetryFailure: (id: string, item: FailureItem) => Promise<void>
  onExportFailures: (id: string) => void
}

const STATUS_TEXT: Record<QueueStatus, MessageKey> = {
  queued: 'queue.statusQueued',
  resolving: 'queue.statusResolving',
  downloading: 'queue.statusDownloading',
  paused: 'queue.statusPaused',
  done: 'queue.statusDone'
}

const STATUS_VARIANT: Record<
  QueueStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  queued: 'secondary',
  resolving: 'warning',
  downloading: 'default',
  paused: 'destructive',
  done: 'success'
}

/** 排队、解析、下载都算「在流程中」：这些状态下不能移除，只能暂停 */
function inFlight(status: QueueStatus): boolean {
  return status === 'queued' || status === 'resolving' || status === 'downloading'
}

function jobPercent(job: QueueSummary): number {
  if (!job.total) return job.status === 'done' ? 100 : 0
  return Math.round(((job.ok + job.exists) / job.total) * 100)
}

/** 单任务统计格：与总览卡片的信息维度一致，只是更紧凑 */
function Stat(props: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-secondary/35 px-2 py-1.5">
      <span className={props.tone ?? 'text-muted-foreground'}>{props.icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] leading-3 text-muted-foreground">{props.label}</p>
        <p className="truncate text-xs font-semibold tabular-nums">{props.value}</p>
      </div>
    </div>
  )
}

export function QueuePanel(props: QueuePanelProps): React.JSX.Element | null {
  const { t } = useI18n()
  /** 当前展开的任务；默认全部折叠，只显示作者与进度条 */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, FailureItem[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  /** 正在逐条重试的失败项，避免同一时间点出多条 */
  const [retryingKey, setRetryingKey] = useState<string | null>(null)
  /** 每秒重渲染一次，让展开任务里的「用时」继续走动 */
  const [, setTick] = useState(0)

  const anyBusy = props.jobs.some((job) => inFlight(job.status))

  useEffect(() => {
    if (!anyBusy) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [anyBusy])

  if (props.jobs.length === 0) return null

  const failureKey = (jobId: string, item: FailureItem): string =>
    `${jobId}|${item.kind}|${item.illustId}|${item.url || ''}`

  const retryOne = async (jobId: string, item: FailureItem): Promise<void> => {
    const key = failureKey(jobId, item)
    setRetryingKey(key)
    try {
      await props.onRetryFailure(jobId, item)
    } finally {
      setRetryingKey(null)
      // 重试会改写失败状态，重新拉一次清单避免展示过期错误
      try {
        const items = await props.loadFailures(jobId)
        setFailures((previous) => ({ ...previous, [jobId]: items }))
      } catch {
        setFailures((previous) => ({ ...previous, [jobId]: [] }))
      }
    }
  }

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
    setFailures((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    props.onResume(id)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <ListRestart className="h-4 w-4 text-primary" />
          {t('queue.title')}
        </CardTitle>
        <Badge variant="outline">{t('queue.resumable', { count: props.jobs.length })}</Badge>
      </CardHeader>
      {/* 队列整页滚动即可，不再做内层限高形成嵌套滚动 */}
      <CardContent className="space-y-2">
        {props.jobs.map((job) => {
          const percent = jobPercent(job)
          const failureCount = job.failed + job.resolveFailed
          const expanded = expandedId === job.id
          const list = failures[job.id] || []
          const busy = inFlight(job.status)
          const paused = job.status === 'paused'
          const doneCount = job.ok + job.exists

          return (
            <div
              key={job.id}
              className="rounded-lg border border-border/70 bg-background/50 px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => void toggleFailures(job.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                    <span className="truncate">{job.artistLabel ?? job.tag}</span>
                    <Badge variant={STATUS_VARIANT[job.status]} className="shrink-0">
                      {t(STATUS_TEXT[job.status])}
                    </Badge>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t('queue.jobWorks', { tag: job.tag, count: job.totalWorks })} · {job.rootDir}
                  </p>
                </button>

                {busy ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => props.onPause(job.id)}
                  >
                    <Pause className="h-3 w-3" />
                    {t('queue.pause')}
                  </Button>
                ) : paused ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => handleResume(job.id)}
                  >
                    <Play className="h-3 w-3" />
                    {failureCount > 0
                      ? t('queue.retryFailed', { count: failureCount })
                      : t('queue.resume')}
                  </Button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void toggleFailures(job.id)}
                  aria-label={expanded ? t('queue.collapse') : t('queue.expand')}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {/* 折叠态也保留进度：一行进度条 + 完成数，方便一眼比较多个任务 */}
              <div className="mt-2 flex items-center gap-2">
                <Progress value={percent} className="h-1.5 flex-1" />
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {t('queue.progressLine', { done: doneCount, total: job.total, percent })}
                </span>
                {failureCount > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-destructive">
                    {t('queue.imageFailed', { count: failureCount })}
                  </span>
                ) : null}
              </div>

              {expanded ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    <Stat
                      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      label={t('progress.ok')}
                      value={String(job.ok)}
                      tone="text-emerald-400"
                    />
                    <Stat
                      icon={<FolderCheck className="h-3.5 w-3.5" />}
                      label={t('progress.exists')}
                      value={String(job.exists)}
                      tone="text-sky-400"
                    />
                    <Stat
                      icon={<XCircle className="h-3.5 w-3.5" />}
                      label={t('progress.failed')}
                      value={String(job.failed)}
                      tone="text-destructive"
                    />
                    <Stat
                      icon={<TriangleAlert className="h-3.5 w-3.5" />}
                      label={t('progress.resolveFailed')}
                      value={String(job.resolveFailed)}
                      tone="text-amber-400"
                    />
                    <Stat
                      icon={<HardDriveDownload className="h-3.5 w-3.5" />}
                      label={t('progress.downloaded')}
                      value={formatBytes(job.bytes)}
                      tone="text-primary"
                    />
                    <Stat
                      icon={<CircleSlash className="h-3.5 w-3.5" />}
                      label={t('progress.elapsed')}
                      value={formatElapsed(job.updatedAt - job.createdAt)}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{t('queue.pending', { count: job.pending })}</span>
                    {job.resolveFailed > 0 ? (
                      <span className="text-destructive">
                        {t('queue.resolveFailed', { count: job.resolveFailed })}
                      </span>
                    ) : null}
                  </div>

                  {failureCount > 0 ? (
                    <div className="space-y-1 rounded-md border border-border/60 bg-secondary/20 p-2">
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
                                  {item.kind === 'work'
                                    ? t('queue.kindResolve')
                                    : t('queue.kindDownload')}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-foreground/90">{item.label}</p>
                                  <p className="truncate text-muted-foreground">{item.error}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={busy || retryingKey !== null}
                                  onClick={() => void retryOne(job.id, item)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
                                >
                                  {retryingKey === failureKey(job.id, item) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3" />
                                  )}
                                  {t('queue.retryOne')}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5">
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
                      disabled={busy}
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
                </div>
              ) : null}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
