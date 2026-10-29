import { Clock3, Loader2, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { SearchWork, ViewHistoryEntry } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Pagination } from '@renderer/components/ui/pagination'
import { messageOf } from '@renderer/lib/errors'
import { useWorkContextMenu } from '@renderer/lib/cardMenu'
import { useLocalPage } from '@renderer/lib/usePagedQuery'
import { useWorkPreview } from '@renderer/lib/workPreview'

const PAGE_SIZE = 24

/** 浏览记录只有展示信息，预览弹窗仍需要 SearchWork 结构 */
function toSearchWork(entry: ViewHistoryEntry): SearchWork {
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
 * 浏览记录页：打开过作品详情就自动记一条，仅保存在本地。
 * 记录量不大，关键词过滤与分页都在渲染层完成，不再请求主进程。
 */
export function HistoryPage(): React.JSX.Element {
  const { t } = useI18n()
  const { openPreview, previewNode } = useWorkPreview()
  /** 记录卡片与搜索结果共用同一套右键菜单（下载 / 复制 / 屏蔽作者） */
  const menu = useWorkContextMenu({ onPreview: openPreview })
  const [items, setItems] = useState<ViewHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .listViewHistory()
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

  /** 记录都在本地，取回整表后按关键词过滤 + 分页，不再请求主进程 */
  const { page, lastPage, pageItems, setPage, reset } = useLocalPage(filtered, PAGE_SIZE)

  /** 相对时间：一天以内按分钟/小时，更早的显示日期 */
  const timeText = (at: number): string => {
    const diff = Date.now() - at
    if (diff < 60_000) return t('history.justNow')
    if (diff < 3_600_000) return t('history.minutesAgo', { count: Math.floor(diff / 60_000) })
    if (diff < 86_400_000) return t('history.hoursAgo', { count: Math.floor(diff / 3_600_000) })
    return new Date(at).toLocaleDateString()
  }

  const clear = (): void => {
    setClearing(true)
    void window.pixiv
      .clearViewHistory()
      .then((result) => {
        setItems(result)
        reset()
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
            <Clock3 className="h-4 w-4 text-primary" />
            {t('history.title')}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('history.hint')}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                reset()
              }}
              placeholder={t('history.searchPlaceholder')}
              className="h-8 w-56 pl-7 text-xs"
            />
            {keyword ? (
              <button
                type="button"
                aria-label={t('history.clearSearch')}
                onClick={() => {
                  setKeyword('')
                  reset()
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
                {t('history.confirmClear')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirming(false)}
              >
                {t('history.cancel')}
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
              {t('history.clear')}
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
            {t('history.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Clock3 className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm">{t('history.empty')}</p>
            <p className="text-[11px]">{t('history.emptyHint')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {t('history.noMatch')}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {pageItems.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={entry.title}
                onClick={() => openPreview(toSearchWork(entry))}
                onContextMenu={(event) => menu.onContextMenu(event, toSearchWork(entry))}
                className="group flex cursor-zoom-in flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 text-left transition-colors hover:border-primary/50"
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
            ))}
          </div>
        )}
      </div>

      {!loading && filtered.length > PAGE_SIZE ? (
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
      ) : null}

      {previewNode}
      {menu.menuNode}
    </main>
  )
}
