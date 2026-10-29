import { Bookmark, Loader2, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { SearchWork, WatchLaterEntry } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Pagination } from '@renderer/components/ui/pagination'
import { useWorkPreview } from '@renderer/lib/workPreview'

const PAGE_SIZE = 24

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 稍后看只存展示信息，预览弹窗需要 SearchWork 结构 */
function toSearchWork(entry: WatchLaterEntry): SearchWork {
  return {
    id: entry.id,
    title: entry.title,
    userId: entry.userId,
    userName: entry.userName,
    thumbnail: entry.thumbnail,
    profileImageUrl: '',
    pageCount: entry.pageCount,
    width: 0,
    height: 0,
    xRestrict: entry.xRestrict,
    illustType: entry.illustType,
    tags: [],
    createDate: '',
    bookmarkCount: 0,
    aiType: 0
  }
}

/**
 * 稍后看：在作品详情里手动加入的待看列表，只存本地。
 * 与 pixiv 收藏无关（收藏要写服务端、分公开/私密），这里只是本地的快捷书签。
 * 列表规模不大，搜索与分页都在渲染层完成。
 */
export function WatchLaterPage(): React.JSX.Element {
  const { t } = useI18n()
  const { openPreview, previewNode } = useWorkPreview()
  const [items, setItems] = useState<WatchLaterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .listWatchLater()
      .then((result) => {
        if (alive) setItems(result)
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
  }, [])

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return items
    return items.filter(
      (entry) =>
        entry.title.toLowerCase().includes(query) ||
        entry.userName.toLowerCase().includes(query) ||
        entry.userId.includes(query) ||
        entry.id.includes(query)
    )
  }, [items, keyword])

  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice(
    (Math.min(page, lastPage) - 1) * PAGE_SIZE,
    Math.min(page, lastPage) * PAGE_SIZE
  )

  /** 相对时间与浏览记录页共用文案 */
  const timeText = (at: number): string => {
    const diff = Date.now() - at
    if (diff < 60_000) return t('history.justNow')
    if (diff < 3_600_000) return t('history.minutesAgo', { count: Math.floor(diff / 60_000) })
    if (diff < 86_400_000) return t('history.hoursAgo', { count: Math.floor(diff / 3_600_000) })
    return new Date(at).toLocaleDateString()
  }

  /** 移出列表：主进程返回最新列表，直接替换避免本地与落盘数据不一致 */
  const remove = (id: string): void => {
    void window.pixiv
      .removeWatchLater(id)
      .then((result) => {
        setItems(result)
        setPage(1)
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
  }

  const clear = (): void => {
    setClearing(true)
    void window.pixiv
      .clearWatchLater()
      .then((result) => {
        setItems(result)
        setPage(1)
        setConfirming(false)
      })
      .catch((reason: unknown) => setError(messageOf(reason)))
      .finally(() => setClearing(false))
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bookmark className="h-4 w-4 text-primary" />
            {t('watchLater.title')}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('watchLater.hint')}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
              placeholder={t('watchLater.searchPlaceholder')}
              className="h-8 w-56 pl-7 text-xs"
            />
            {keyword ? (
              <button
                type="button"
                aria-label={t('watchLater.clearSearch')}
                onClick={() => {
                  setKeyword('')
                  setPage(1)
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {confirming ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={clearing}
                onClick={clear}
              >
                {clearing ? <Loader2 className="animate-spin" /> : null}
                {t('watchLater.confirmClear')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirming(false)}
              >
                {t('watchLater.cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={items.length === 0}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
              {t('watchLater.clear')}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('watchLater.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Bookmark className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm">{t('watchLater.empty')}</p>
            <p className="text-[11px]">{t('watchLater.emptyHint')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('watchLater.noMatch')}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {visible.map((entry) => (
              <div
                key={entry.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 transition-colors hover:border-primary/50"
              >
                <button
                  type="button"
                  title={entry.title}
                  onClick={() => openPreview(toSearchWork(entry))}
                  className="flex cursor-zoom-in flex-col text-left"
                >
                  <div className="relative aspect-square overflow-hidden bg-secondary/60">
                    {entry.thumbnail ? (
                      <img
                        src={entry.thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                    ) : null}
                    {entry.xRestrict >= 1 ? (
                      <Badge
                        variant="destructive"
                        className="absolute left-1 top-1 bg-red-500/85 px-1 py-0 text-[10px] text-white"
                      >
                        R-18
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
                    <p className="line-clamp-2 text-xs font-medium leading-4">{entry.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {entry.userName || entry.userId}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">{timeText(entry.at)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  title={t('watchLater.remove')}
                  aria-label={t('watchLater.remove')}
                  onClick={() => remove(entry.id)}
                  className="absolute right-1.5 top-1.5 rounded bg-black/55 p-1 text-white opacity-0 backdrop-blur transition-opacity hover:bg-red-500/85 focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && filtered.length > PAGE_SIZE ? (
        <Pagination page={Math.min(page, lastPage)} lastPage={lastPage} onChange={setPage} />
      ) : null}

      {previewNode}
    </main>
  )
}
