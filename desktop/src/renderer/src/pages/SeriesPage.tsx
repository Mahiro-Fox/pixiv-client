import {
  ArrowLeft,
  Bell,
  BellOff,
  ImageOff,
  Layers,
  Loader2,
  User
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { OAuthStatus, SearchWork, SeriesDetail, SeriesEpisode } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { useWorkPreview } from '@renderer/lib/workPreview'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'

interface SeriesPageProps {
  /** App API 凭据状态；追更按钮依赖它 */
  oauth: OAuthStatus | null
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 系列里的一话转成预览弹窗需要的作品结构 */
function toSearchWork(detail: SeriesDetail, episode: SeriesEpisode): SearchWork {
  return {
    id: episode.id,
    title: episode.title,
    userId: episode.userId,
    userName: episode.userName,
    thumbnail: episode.thumbnail,
    profileImageUrl: detail.avatar,
    pageCount: episode.pageCount,
    width: 0,
    height: 0,
    xRestrict: episode.xRestrict,
    illustType: episode.illustType,
    tags: [],
    createDate: '',
    bookmarkCount: 0,
    aiType: 0,
    series: {
      id: detail.id,
      title: detail.title,
      order: episode.order,
      isConcluded: detail.isConcluded
    }
  }
}

export function SeriesPage({ oauth }: SeriesPageProps): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { seriesId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { openPreview, previewNode } = useWorkPreview()

  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [watching, setWatching] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)

  const workId = searchParams.get('work') || ''

  useEffect(() => {
    if (!seriesId) return
    let alive = true
    setLoading(true)
    setError('')
    setDetail(null)
    void window.pixiv
      .getWorkSeries({ seriesId, workId })
      .then((data) => {
        if (!alive) return
        setDetail(data)
        setWatching(data.watchlisted)
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
  }, [seriesId, workId])

  const toggleWatch = async (): Promise<void> => {
    if (!detail || watchBusy) return
    setWatchBusy(true)
    setError('')
    try {
      const next = !watching
      await window.pixiv.setSeriesWatch(detail.id, next)
      setWatching(next)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setWatchBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('series.loading')}
      </main>
    )
  }

  if (!detail) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
        <p className="text-center text-sm text-destructive">{error || t('series.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t('series.back')}
        </Button>
      </main>
    )
  }

  const episodes = detail.episodes

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t('series.back')}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <section className="flex gap-5 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="relative h-44 w-32 shrink-0 overflow-hidden rounded-xl bg-secondary/60">
          {detail.cover ? (
            <img src={detail.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <ImageOff className="h-6 w-6" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-lg font-semibold leading-7">{detail.title}</h1>
            {/* App API 的漫画系列详情不返回完结状态，只有确定已完结时才显示角标 */}
            {detail.isConcluded ? <Badge variant="outline">{t('series.concluded')}</Badge> : null}
          </div>

          <button
            type="button"
            onClick={() => detail.userId && navigate(`/user/${detail.userId}`)}
            disabled={!detail.userId}
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:hover:text-muted-foreground"
          >
            <User className="h-3.5 w-3.5" />
            {detail.userName || t('series.unknownAuthor')}
          </button>

          <p className="text-[11px] text-muted-foreground">
            {detail.workCount > 0
              ? t('series.episodeCount', { count: detail.workCount })
              : t('series.episodeCountUnknown')}
          </p>

          {detail.caption ? (
            <p className="scrollbar-thin max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-5 text-muted-foreground/90">
              {detail.caption}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {oauth?.connected ? (
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
                window.open(`https://www.pixiv.net/manga/series/${detail.id}`, '_blank')
              }
            >
              {t('series.openWeb')}
            </Button>
          </div>
        </div>
      </section>

      {detail.source === 'web' ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-600">
          {t('series.webLimited')}
        </div>
      ) : null}

      <section className="min-h-0 flex-1">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          {t('series.episodes')}
        </p>
        {episodes.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">{t('series.empty')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {episodes.map((episode) => (
              <button
                key={episode.id}
                type="button"
                onClick={() => openPreview(toSearchWork(detail, episode))}
                className="group overflow-hidden rounded-lg border border-border/60 bg-secondary/40 text-left transition-colors hover:border-border hover:bg-secondary/70"
              >
                <span className="relative block aspect-[3/4] bg-secondary/60">
                  {episode.thumbnail ? (
                    <img
                      src={episode.thumbnail}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                      <ImageOff className="h-5 w-5" />
                    </span>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                    {t('series.episodeOrder', { order: episode.order })}
                  </span>
                </span>
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-[11px] text-foreground">{episode.title}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {t('series.pageCount', { count: episode.pageCount })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {previewNode}
    </main>
  )
}
