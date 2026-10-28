import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, FileDown, FolderOpen, Loader2, List, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  NovelDetail,
  NovelDownloadResult,
  NovelSeriesDetail
} from '@shared/types'
import { useI18n } from '@renderer/i18n'
import {
  loadReaderSettings,
  loadReadingProgress,
  loadSeriesPosition,
  markNovelRead,
  readingMinutes,
  renderNovelPage,
  saveReaderSettings,
  saveReadingProgress,
  saveSeriesPosition,
  splitNovelPages,
  type ReaderSettings
} from '@renderer/lib/novel'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { NovelReaderSettings } from '@renderer/components/NovelReaderSettings'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function dirOf(file: string): string {
  const index = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return index > 0 ? file.slice(0, index) : file
}

export function NovelReaderPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { novelId = '' } = useParams()

  const [detail, setDetail] = useState<NovelDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings())
  const [percent, setPercent] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)
  const [series, setSeries] = useState<NovelSeriesDetail | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [saved, setSaved] = useState<NovelDownloadResult | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!novelId) return
    let alive = true
    setLoading(true)
    setError('')
    setDetail(null)
    restoredRef.current = false
    setSeries(null)
    setSaved(null)
    void window.pixiv
      .getNovelDetail(novelId)
      .then((data) => {
        if (!alive) return
        setDetail(data)
        markNovelRead(data.id)
        const sid = data.series?.id || data.seriesId
        if (sid) saveSeriesPosition(sid, data.id)
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
  }, [novelId])

  // 正文渲染完成后再恢复上次的滚动位置；图片加载会改变高度，这里做一次近似定位
  useEffect(() => {
    if (!detail || restoredRef.current) return
    const el = scrollRef.current
    if (!el) return
    restoredRef.current = true
    const saved = loadReadingProgress(detail.id)
    if (saved <= 0) return
    requestAnimationFrame(() => {
      el.scrollTop = saved * Math.max(0, el.scrollHeight - el.clientHeight)
      setPercent(Math.round(saved * 100))
    })
  }, [detail])

  // 阅读进度延迟落盘，避免滚动时频繁写 localStorage
  useEffect(() => {
    if (!detail) return
    const timer = window.setTimeout(() => {
      saveReadingProgress(detail.id, percent / 100)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [detail, percent])

  useEffect(() => {
    saveReaderSettings(settings)
  }, [settings])

  const seriesId = detail ? detail.series?.id || detail.seriesId || '' : ''
  const position = seriesId ? loadSeriesPosition(seriesId) : ''

  // 目录按需加载：单篇阅读时不必多打一次系列接口
  useEffect(() => {
    if (!tocOpen || !seriesId || series) return
    let alive = true
    void window.pixiv
      .getNovelSeries(seriesId)
      .then((data) => {
        if (alive) setSeries(data)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [tocOpen, seriesId, series])

  const pages = useMemo(() => (detail ? splitNovelPages(detail.content) : []), [detail])

  const download = async (): Promise<void> => {
    if (!detail || downloading) return
    setDownloading(true)
    setError('')
    setSaved(null)
    try {
      const result = await window.pixiv.downloadNovel({ novelId: detail.id })
      setSaved(result)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setDownloading(false)
    }
  }

  const themeClass =
    settings.theme === 'dark'
      ? 'bg-[#15161a] text-[#c8c8d0]'
      : settings.theme === 'light'
        ? 'bg-[#fbfbfa] text-[#232323]'
        : 'bg-[#f4ecd8] text-[#3a3128]'

  const seriesNav = detail?.series || null
  const isR18 = Number(detail?.xRestrict || 0) >= 1

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
        <p className="max-w-lg text-center text-sm text-destructive">
          {error || t('novel.loadFailed')}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft />
            {t('novel.back')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/novel')}>
            <BookOpen />
            {t('novel.title')}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t('novel.back')}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {detail.title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('novel.progress', { percent })}
        </span>
        <NovelReaderSettings
          settings={settings}
          onChange={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
        />
        {seriesId ? (
          <Button variant="ghost" size="sm" onClick={() => setTocOpen(true)}>
            <List />
            {t('novel.toc')}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={downloading} onClick={() => void download()}>
          {downloading ? <Loader2 className="animate-spin" /> : <FileDown />}
          {downloading ? t('novel.downloading') : t('novel.download')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(`https://www.pixiv.net/novel/show.php?id=${detail.id}`, '_blank')}
        >
          {t('novel.openWeb')}
        </Button>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
          <span className="flex-1 break-all">{t('novel.saved', { path: saved.path })}</span>
          <Button variant="ghost" size="sm" onClick={() => void window.pixiv.openDir(dirOf(saved.path))}>
            <FolderOpen />
            {t('novel.openDir')}
          </Button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          const max = el.scrollHeight - el.clientHeight
          setPercent(max > 0 ? Math.round((el.scrollTop / max) * 100) : 100)
        }}
        className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto ${themeClass}`}
      >
        <article
          className="novel-body mx-auto px-10 py-10"
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            maxWidth: `${settings.maxWidth}px`
          }}
        >
          <header className="mb-8 border-b border-[rgba(128,128,128,0.22)] pb-6">
            <div className="mb-2 flex items-center gap-2">
              {seriesNav ? (
                <Link
                  to={`/novel/series/${seriesNav.id}`}
                  className="max-w-[70%] truncate text-xs text-primary hover:underline"
                >
                  {seriesNav.title}
                </Link>
              ) : null}
              {isR18 ? <Badge variant="destructive">R-18</Badge> : null}
              {detail.aiType === 2 ? (
                <Badge className="bg-violet-500/80 text-white">AI</Badge>
              ) : null}
            </div>
            <h1 className="text-xl font-semibold leading-8">{detail.title}</h1>
            <p className="mt-2 text-xs opacity-60">
              {detail.userName}
              {seriesNav ? ` · ${t('novel.episode', { order: seriesNav.order })}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] opacity-60">
              <span>{t('novel.chars', { count: detail.textCount })}</span>
              <span>{t('novel.readTime', { minutes: readingMinutes(detail.readingTime) })}</span>
              <span>{t('novel.bookmarks', { count: detail.bookmarkCount })}</span>
              <span>{detail.createDate.slice(0, 10)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {detail.tags.slice(0, 12).map((tag) => (
                <span key={tag} className="rounded bg-[rgba(128,128,128,0.14)] px-1.5 py-0.5 text-[10px] opacity-80">
                  {tag}
                </span>
              ))}
            </div>
          </header>

          {pages.map((page, index) => (
            <section key={index} className="novel-page">
              <div
                className="whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: renderNovelPage(page, detail.embeddedImages) }}
              />
              {index < pages.length - 1 ? (
                <div className="my-10 flex items-center gap-3 text-[10px] opacity-30">
                  <span className="h-px flex-1 bg-current" />
                  {t('novel.pageOf', { page: index + 1, total: pages.length })}
                  <span className="h-px flex-1 bg-current" />
                </div>
              ) : null}
            </section>
          ))}

          <footer className="mt-12 flex items-center justify-between gap-3 border-t border-[rgba(128,128,128,0.22)] pt-6">
            {seriesNav?.prev ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/novel/${seriesNav.prev?.id}`)}
              >
                <ChevronLeft />
                {t('novel.prevEpisode')}
              </Button>
            ) : (
              <span />
            )}
            {seriesNav ? (
              <Button variant="ghost" size="sm" onClick={() => navigate(`/novel/series/${seriesNav.id}`)}>
                <BookOpen />
                {t('novel.toc')}
              </Button>
            ) : null}
            {seriesNav?.next ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/novel/${seriesNav.next?.id}`)}
              >
                {t('novel.nextEpisode')}
                <ChevronRight />
              </Button>
            ) : (
              <span />
            )}
          </footer>
        </article>
      </div>

      {tocOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setTocOpen(false)}>
          <aside
            className="scrollbar-thin h-full w-80 overflow-y-auto border-l border-border/60 bg-background p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium">{series?.series.title || seriesNav?.title || t('novel.toc')}</p>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary/60"
                aria-label={t('novel.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {series ? (
              <div className="space-y-1">
                {series.episodes.map((episode) => (
                  <button
                    key={episode.id}
                    type="button"
                    onClick={() => {
                      setTocOpen(false)
                      navigate(`/novel/${episode.id}`)
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                      episode.id === detail.id
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-secondary/50'
                    }`}
                  >
                    <span className="w-6 shrink-0 opacity-70">{episode.order}</span>
                    <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 py-6 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('novel.loading')}
              </p>
            )}
            {position ? (
              <p className="mt-3 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                {t('novel.lastRead', { id: position })}
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  )
}
