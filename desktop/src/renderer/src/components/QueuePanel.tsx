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

const STATUS_TEXT: Record<QueueStatus, string> = {
  resolving: '解析中',
  downloading: '下载中',
  paused: '未完成',
  done: '已完成'
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
          未完成任务
        </CardTitle>
        <Badge variant="outline">{props.jobs.length} 个可续传</Badge>
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
                    {job.tag} · {job.totalWorks} 个作品
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{job.rootDir}</p>
                </div>
                <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_TEXT[job.status]}</Badge>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  完成 {job.ok + job.exists}/{job.total}（{percent}%）
                </span>
                {job.failed > 0 ? (
                  <span className="text-destructive">图片失败 {job.failed}</span>
                ) : null}
                {job.resolveFailed > 0 ? (
                  <span className="text-destructive">解析失败 {job.resolveFailed}</span>
                ) : null}
                <span>待下载 {job.pending}</span>
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
                  {failureCount > 0 ? `重试失败项 ${failureCount}` : '继续'}
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
                    失败详情
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
                    导出清单
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
                  移除
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => props.onOpenDir(job.rootDir)}
                >
                  <FolderOpen className="h-3 w-3" />
                  打开目录
                </Button>
              </div>

              {expanded ? (
                <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-secondary/20 p-2">
                  {loadingId === job.id ? (
                    <p className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      正在读取失败清单…
                    </p>
                  ) : list.length === 0 ? (
                    <p className="py-1 text-[11px] text-muted-foreground">
                      没有失败项（解析失败的作品会在重试时重新解析）
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        共 {list.length} 项，重试时只会重新处理这些内容
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
                              {item.kind === 'work' ? '解析' : '下载'}
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
