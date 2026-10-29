import {
  ArrowLeft,
  Bell,
  BellOff,
  BookOpen,
  Check,
  FileDown,
  FolderOpen,
  ImageOff,
  Loader2,
  Play,
  Timer,
  User
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { NovelDownloadProgress, NovelDownloadResult, NovelSeriesDetail } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import {
  loadReadNovels,
  loadSeriesPosition,
  readingMinutes
} from '@renderer/lib/novel'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function dirOf(file: string): string {
  const index = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return index > 0 ? file.slice(0, index) : file
}

export function NovelSeriesPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { seriesId = '' } = useParams()

  const [detail, setDetail] = useState<NovelSeriesDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<NovelDownloadProgress | null>(null)
  const [saved, setSaved] = useState<NovelDownloadResult | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadNovels())
  const [watching, setWatching] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)
  const [oauthConnected, setOauthConnected] = useState(false)

  useEffect(() => {
    if (!seriesId) return
    let alive = true
    setLoading(true)
    setError('')
    setDetail(null)
    void window.pixiv
      .getNovelSeries(seriesId)
      .then((data) => {
        if (alive) setDetail(data)
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [seriesId])

  useEffect(() => window.pixiv.onNovelDownloadProgress((item) => setProgress(item)), [])

  // 追更按钮依赖 App API 凭据；网页接口不返回追更状态，单独读一次
  useEffect(() => {
    if (!seriesId) return
    let alive = true
    setWatching(false)
    void (async () => {
      try {
        const status = await window.pixiv.getOAuthStatus()
        if (!alive) return
        setOauthConnected(Boolean(status.connected))
        if (!status.connected) return
        const state = await window.pixiv.getNovelSeriesWatchState(seriesId)
        if (alive) setWatching(state)
      } catch {
        // 状态读不到时按「未追更」处理，按钮仍可点击
      }
    })()
    return () => {
      alive = false
    }
  }, [seriesId])

  const toggleWatch = async (): Promise<void> => {
    if (!detail || watchBusy) return
    setWatchBusy(true)
    setError('')
    try {
      const next = !watching
      await window.pixiv.setNovelSeriesWatch(detail.series.id, next)
      setWatching(next)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setWatchBusy(false)
    }
  }

  // 从阅读页返回时重新读取已读标记
  useEffect(() => {
    setReadIds(loadReadNovels())
  }, [seriesId])

  const position = useMemo(() => loadSeriesPosition(seriesId), [seriesId, readIds])
  const episodes = detail?.episodes || []
  const firstEpisode = episodes[0]

  const download = async (): Promise<void> => {
    if (downloading) return
    setDownloading(true)
    setError('')
    setSaved(null)
    setProgress(null)
    try {
      const result = await window.pixiv.downloadNovel({ seriesId })
      setSaved(result)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('novel.loading')}
      </main>
    )
  }

  if (!detail) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
        <p className="text-sm text-destructive">{error || t('novel.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/novel')}>
          <ArrowLeft />
          {t('novel.back')}
        </Button>
      </main>
    )
  }

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t('novel.back')}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
          <span className="flex-1 break-all">{t('novel.saved', { path: saved.path })}</span>
          <Button variant="ghost" size="sm" onClick={() => void window.pixiv.openDir(dirOf(saved.path))}>
            <FolderOpen />
            {t('novel.openDir')}
          </Button>
        </div>
      ) : null}

      <section className="flex gap-5 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="relative h-44 w-32 shrink-0 overflow-hidden rounded-xl bg-secondary/60">
          {detail.series.cover ? (
            <img src={detail.series.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <ImageOff className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-lg font-semibold leading-7">{detail.series.title}</h1>
            {detail.series.isConcluded ? (
              <Badge variant="outline">{t('novel.concluded')}</Badge>
            ) : (
              <Badge variant="success">{t('novel.serializing')}</Badge>
            )}
            {detail.series.xRestrict >= 1 ? (
              <Badge variant="destructive">R-18</Badge>
            ) : null}
          </div>

          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5" />
            {detail.series.userName}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>{t('novel.episodes', { count: detail.series.publishedContentCount })}</span>
            <span>{t('novel.chars', { count: detail.series.publishedTotalCharacterCount })}</span>
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {t('novel.readTime', { minutes: readingMinutes(detail.series.publishedReadingTime) })}
            </span>
          </div>

          {detail.series.caption ? (
            <p className="scrollbar-thin max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-5 text-muted-foreground/90">
              {detail.series.caption}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {detail.series.tags.slice(0, 10).map((tag) => (
              <span
                key={tag}
                className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => {
                const target = position || firstEpisode?.id
                if (target) navigate(`/novel/${target}`)
              }}
              disabled={!firstEpisode}
            >
              <Play />
              {position ? t('novel.continueReading') : t('novel.read')}
            </Button>
            <Button variant="outline" size="sm" disabled={downloading || !firstEpisode} onClick={() => void download()}>
              {downloading ? <Loader2 className="animate-spin" /> : <FileDown />}
              {downloading ? t('novel.downloading') : t('novel.downloadSeries')}
            </Button>
            {oauthConnected ? (
              <Button
                variant={watching ? 'default' : 'outline'}
                size="sm"
                disabled={watchBusy}
                onClick={() => void toggleWatch()}
              >
                {watchBusy ? (
                  <Loader2 className="animate-spin" />
                ) : watching ? (
                  <BellOff />
                ) : (
                  <Bell />
                )}
                {watching ? t('series.watching') : t('series.watch')}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.open(`https://www.pixiv.net/novel/series/${detail.series.id}`, '_blank')
              }
            >
              {t('novel.openWeb')}
            </Button>
            {progress ? (
              <span className="text-[11px] text-muted-foreground">
                {t('novel.downloadProgress', { done: progress.done, total: progress.total })}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="min-h-0 flex-1">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          {t('novel.toc')}
        </p>
        <div className="space-y-1">
          {episodes.map((episode) => {
            const isRead = readIds.has(episode.id)
            const isPosition = position === episode.id
            return (
              <button
                key={episode.id}
                type="button"
                onClick={() => navigate(`/novel/${episode.id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2 text-left transition-colors hover:border-border hover:bg-card/60"
              >
                <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{episode.order}</span>
                <span className="min-w-0 flex-1 truncate text-xs">{episode.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {t('novel.chars', { count: episode.textCount })}
                </span>
                {isRead ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-500">
                    <Check className="h-3 w-3" />
                    {t('novel.readMark')}
                  </span>
                ) : null}
                {isPosition ? (
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('novel.current')}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </section>
    </main>
  )
}
