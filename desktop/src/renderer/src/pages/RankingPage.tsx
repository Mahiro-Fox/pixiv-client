import { Loader2, RefreshCw, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RankingMode, RankingResult, WorkSearchKind } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Pagination } from '@renderer/components/ui/pagination'
import { SearchWorkGrid } from '@renderer/components/WorkCard'
import { useWorkPreview } from '@renderer/lib/workPreview'

const MODES: RankingMode[] = [
  'daily',
  'weekly',
  'monthly',
  'rookie',
  'original',
  'male',
  'female'
]

/** 文案键单独列一份，避免用模板字符串拼 key 时丢掉类型检查 */
const MODE_KEYS = {
  daily: 'ranking.mode.daily',
  weekly: 'ranking.mode.weekly',
  monthly: 'ranking.mode.monthly',
  rookie: 'ranking.mode.rookie',
  original: 'ranking.mode.original',
  male: 'ranking.mode.male',
  female: 'ranking.mode.female'
} as const

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 界面用 YYYY-MM-DD（原生日期控件），接口要 YYYYMMDD */
function toInputDate(value: string): string {
  const text = String(value || '').trim()
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function toApiDate(value: string): string {
  const text = toInputDate(value)
  return text.replace(/-/g, '')
}

function formatApiDate(value: string): string {
  return toInputDate(value) || value
}

/**
 * 官方排行榜页：插画 / 漫画 × 7 种榜单，支持指定日期与翻页。
 * 年份榜单要翻到最后一页才算完整，所以页内只取当前页，不做自动合并。
 */
export function RankingPage(): React.JSX.Element {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const { openPreview, previewNode } = useWorkPreview()

  const kind: WorkSearchKind = params.get('kind') === 'manga' ? 'manga' : 'illust'
  const rawMode = params.get('mode') || 'daily'
  const mode: RankingMode = MODES.includes(rawMode as RankingMode)
    ? (rawMode as RankingMode)
    : 'daily'
  /** URL 里保留 YYYY-MM-DD，便于日期控件直接回填 */
  const date = toInputDate(params.get('date') || '')
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))

  const [result, setResult] = useState<RankingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 日期留空的榜单每天都会变，用这个计数强制重新拉取 */
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .listRanking({ kind, mode, page, date: toApiDate(date) })
      .then((data) => {
        if (alive) setResult(data)
      })
      .catch((reason: unknown) => {
        if (alive) {
          setResult(null)
          setError(messageOf(reason))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [kind, mode, page, date, reload])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  /** 切榜单或换日期都要回到第一页 */
  const switchMode = (next: RankingMode): void => {
    apply({ mode: next === 'daily' ? '' : next, page: '' })
  }

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 text-primary" />
          {t('ranking.title')}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('ranking.hint')}</p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border/70">
            {(['illust', 'manga'] as WorkSearchKind[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => apply({ kind: key === 'illust' ? '' : key, page: '' })}
                className={
                  kind === key
                    ? 'bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary'
                    : 'px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50'
                }
              >
                {key === 'illust' ? t('ranking.kind.illust') : t('ranking.kind.manga')}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Input
              type="date"
              value={date}
              onChange={(event) => apply({ date: event.target.value, page: '' })}
              className="h-8 w-36 text-xs"
            />
            {date ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => apply({ date: '', page: '' })}
              >
                {t('ranking.latest')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={() => setReload((value) => value + 1)}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('ranking.refresh')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {MODES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => switchMode(item)}
              className={
                mode === item
                  ? 'rounded-md bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary'
                  : 'rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60'
              }
            >
              {t(MODE_KEYS[item])}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/80">{t('ranking.dateHint')}</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t('ranking.count', { count: result.total })}</span>
          {result.date ? (
            <span>· {t('ranking.date', { date: formatApiDate(result.date) })}</span>
          ) : null}
          {result.nextDate ? (
            <span className="text-muted-foreground/70">
              · {t('ranking.nextDate', { date: formatApiDate(result.nextDate) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading && !result ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('works.loading')}
        </div>
      ) : null}

      {result && result.works.length > 0 ? (
        <SearchWorkGrid works={result.works} onPreview={openPreview} />
      ) : null}

      {!loading && result && result.works.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          {t('ranking.empty')}
        </div>
      ) : null}

      {result && result.lastPage > 1 ? (
        <Pagination
          page={page}
          lastPage={result.lastPage}
          onChange={(next) => apply({ page: next === 1 ? '' : String(next) })}
          disabled={loading}
        />
      ) : null}

      {previewNode}
    </main>
  )
}
