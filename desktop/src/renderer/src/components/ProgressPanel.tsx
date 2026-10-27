import {
  CheckCircle2,
  CircleSlash,
  FolderCheck,
  Gauge,
  HardDriveDownload,
  Loader2,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import type { DownloadProgress, ThrottleState } from '@shared/types'
import { formatBytes, formatElapsed } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { MessageKey, Translate } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Card, CardContent } from './ui/card'
import { Progress } from './ui/progress'

interface ProgressPanelProps {
  progress: DownloadProgress | null
  running: boolean
  throttle: ThrottleState[]
}

const PHASE_TEXT: Record<DownloadProgress['phase'], MessageKey> = {
  idle: 'progress.phaseIdle',
  resolving: 'progress.phaseResolving',
  downloading: 'progress.phaseDownloading',
  paused: 'progress.phasePaused',
  done: 'progress.phaseDone'
}

const PHASE_VARIANT: Record<
  DownloadProgress['phase'],
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  idle: 'secondary',
  resolving: 'warning',
  downloading: 'default',
  paused: 'destructive',
  done: 'success'
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

function Stat({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-secondary/35 px-3 py-2">
      <span className={tone ?? 'text-muted-foreground'}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] leading-3 text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

export function ProgressPanel({
  progress,
  running,
  throttle
}: ProgressPanelProps): React.JSX.Element {
  const { t } = useI18n()
  // 每秒刷新一次，让「用时」和限流冷却倒计时保持走动
  const [, setTick] = useState(0)
  const active = running && (progress?.phase === 'resolving' || progress?.phase === 'downloading')

  useEffect(() => {
    if (!active && throttle.every((state) => state.cooldownUntil <= Date.now())) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [active, throttle])

  const notice = throttleNotice(throttle, t)

  if (!progress) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/60 text-muted-foreground">
              <Gauge className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('progress.notStarted')}</p>
              <p className="text-xs text-muted-foreground">{t('progress.notStartedHint')}</p>
            </div>
          </div>
          {notice ? <Badge variant="warning">{notice}</Badge> : <Badge variant="secondary">{t('progress.idle')}</Badge>}
        </CardContent>
      </Card>
    )
  }

  const isResolving = progress.phase === 'resolving'
  const percent = isResolving
    ? progress.totalWorks > 0
      ? Math.round((progress.resolvedWorks / progress.totalWorks) * 100)
      : 0
    : progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : progress.phase === 'done'
        ? 100
        : 0

  // 结束后使用结束时间，避免仅因重渲染就让「用时」继续变大
  const elapsed = Math.max(0, (progress.finishedAt ?? Date.now()) - progress.startedAt)

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {active ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <Gauge className="h-4 w-4 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">
              {isResolving
                ? t('progress.resolvingWorks', {
                    done: progress.resolvedWorks,
                    total: progress.totalWorks
                  })
                : progress.phase === 'downloading'
                  ? t('progress.downloading', {
                      done: progress.done,
                      total: progress.total
                    })
                  : t(PHASE_TEXT[progress.phase])}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {notice ? <Badge variant="warning">{notice}</Badge> : null}
            <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
            <Badge variant={PHASE_VARIANT[progress.phase]}>{t(PHASE_TEXT[progress.phase])}</Badge>
          </div>
        </div>

        <Progress value={percent} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Stat
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t('progress.ok')}
            value={String(progress.ok)}
            tone="text-emerald-400"
          />
          <Stat
            icon={<FolderCheck className="h-4 w-4" />}
            label={t('progress.exists')}
            value={String(progress.exists)}
            tone="text-sky-400"
          />
          <Stat
            icon={<XCircle className="h-4 w-4" />}
            label={t('progress.failed')}
            value={String(progress.failed)}
            tone="text-destructive"
          />
          <Stat
            icon={<TriangleAlert className="h-4 w-4" />}
            label={t('progress.resolveFailed')}
            value={String(progress.resolveFailed)}
            tone="text-amber-400"
          />
          <Stat
            icon={<HardDriveDownload className="h-4 w-4" />}
            label={t('progress.downloaded')}
            value={formatBytes(progress.bytes)}
            tone="text-primary"
          />
          <Stat
            icon={<CircleSlash className="h-4 w-4" />}
            label={t('progress.elapsed')}
            value={formatElapsed(elapsed)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
