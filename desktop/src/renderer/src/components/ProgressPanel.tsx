import { Gauge, Loader2, Settings2, Users, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import type { BatchSyncProgress, QueueSummary, ThrottleState } from '@shared/types'
import { formatBytes, formatElapsed } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { MessageKey, Translate } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Progress } from './ui/progress'

interface ProgressPanelProps {
  /** 队列里的未完成任务；总进度按所有任务的图片数汇总 */
  jobs: QueueSummary[]
  /** 当前同时在跑的下载任务数；大于 1 时提示并行状态 */
  parallel?: number
  /** 设置里的「并行任务数」上限，用于提示用户还能同时跑几个 */
  parallelJobs: number
  /** 打开设置，便于调整并行任务数 */
  onOpenSettings: () => void
  throttle: ThrottleState[]
  /** 批量同步进度；为空表示当前不是批量任务 */
  batch?: BatchSyncProgress | null
  /** 中止批量同步（批量是长任务，不进入队列，保留自己的取消入口） */
  onCancelBatch: () => void
}

const KIND_TEXT: Record<ThrottleState['kind'], MessageKey> = {
  api: 'progress.kindApi',
  cdn: 'progress.kindCdn'
}

/** 429 之后的状态提示：冷却剩余时间 / 已自动降速 */
function throttleNotice(throttle: ThrottleState[], t: Translate): string {
  const cooling = throttle
    .filter((state) => state.cooldownUntil > Date.now())
    .sort((a, b) => b.cooldownUntil - a.cooldownUntil)[0]
  if (cooling) {
    const seconds = Math.max(1, Math.ceil((cooling.cooldownUntil - Date.now()) / 1000))
    return t('progress.throttleCooldown', {
      kind: t(KIND_TEXT[cooling.kind]),
      seconds,
      concurrency: cooling.concurrency
    })
  }

  const slowed = throttle.find((state) => state.penalty > 0)
  if (slowed) {
    return t('progress.throttleSlowed', {
      kind: t(KIND_TEXT[slowed.kind]),
      concurrency: slowed.concurrency
    })
  }
  return ''
}

const BATCH_PHASE_TEXT: Record<BatchSyncProgress['phase'], MessageKey> = {
  collecting: 'batch.phaseCollecting',
  downloading: 'batch.phaseDownloading',
  done: 'batch.phaseDone',
  failed: 'batch.phaseFailed'
}

/** 批量同步提示条：第几位 / 画师名 / 该画师的抓取与下载进度 / 中止入口 */
function BatchBar(props: {
  batch: BatchSyncProgress
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px]">
      <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="font-medium text-primary">
        {t('batch.current', { index: props.batch.index, total: props.batch.total })}
      </span>
      <span className="max-w-[16rem] truncate text-foreground/90">{props.batch.artist.name}</span>
      <Badge variant={props.batch.phase === 'failed' ? 'destructive' : 'secondary'}>
        {t(BATCH_PHASE_TEXT[props.batch.phase])}
      </Badge>
      <span className="tabular-nums text-muted-foreground">
        {t('batch.stats', { works: props.batch.works, files: props.batch.files })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-1.5 text-[11px]"
        onClick={props.onCancel}
      >
        <X className="h-3 w-3" />
        {t('batch.cancel')}
      </Button>
    </div>
  )
}

/**
 * 任务总览：只保留一条汇总进度条 + 百分比，
 * 每个任务自己的统计与操作都在下方任务卡片里，避免重复占用纵向空间。
 */
export function ProgressPanel({
  jobs,
  parallel = 0,
  parallelJobs,
  throttle,
  batch,
  onCancelBatch,
  onOpenSettings
}: ProgressPanelProps): React.JSX.Element {
  const { t } = useI18n()
  const notice = throttleNotice(throttle, t)
  const running = parallel > 0
  // 冷却倒计时与用时靠重渲染推进，这里只负责让倒计时数字变化
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!running && throttle.every((state) => state.cooldownUntil <= Date.now())) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running, throttle])

  const totalFiles = jobs.reduce((sum, job) => sum + job.total, 0)
  const doneFiles = jobs.reduce((sum, job) => sum + job.ok + job.exists, 0)
  const bytes = jobs.reduce((sum, job) => sum + job.bytes, 0)
  // 任务还在排队/解析时 total 为 0，此时不能把百分比算成 100%
  const allDone = jobs.length > 0 && jobs.every((job) => job.status === 'done')
  const percent =
    totalFiles > 0 ? Math.round((doneFiles / totalFiles) * 100) : allDone ? 100 : 0

  return (
    <Card>
      <CardContent className="space-y-2.5 p-3">
        {batch ? <BatchBar batch={batch} onCancel={onCancelBatch} /> : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {running ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <p className="truncate text-sm font-medium">
              {jobs.length === 0
                ? t('progress.notStarted')
                : t('progress.totalProgress', { done: doneFiles, total: totalFiles })}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {parallel > 1 ? (
              <Badge variant="secondary">{t('progress.parallel', { count: parallel })}</Badge>
            ) : null}
            {notice ? <Badge variant="warning">{notice}</Badge> : null}
            <span className="text-sm font-semibold tabular-nums">{percent}%</span>
          </div>
        </div>

        <Progress value={percent} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{t('progress.jobCount', { count: jobs.length })}</span>
          {bytes > 0 ? <span>{formatBytes(bytes)}</span> : null}
          {jobs.length > 0 ? (
            <span>
              {t('progress.elapsed')}{' '}
              {formatElapsed(Math.max(...jobs.map((job) => job.updatedAt - job.createdAt)))}
            </span>
          ) : (
            <span>{t('progress.notStartedHint')}</span>
          )}
        </div>

        {/* 并行任务数提示：点击直接进设置，避免用户以为「同时只能跑一个」 */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
        >
          <Settings2 className="h-3 w-3 shrink-0" />
          {t('progress.parallelHint', { count: parallelJobs })}
        </button>
      </CardContent>
    </Card>
  )
}
