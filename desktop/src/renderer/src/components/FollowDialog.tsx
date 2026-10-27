import { Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Search, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import type { BatchArtist, FollowUser } from '@shared/types'
import { lastFollowPage, readFollowPage, rememberFollowPage, writeFollowPage } from '@renderer/lib/dialogCache'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'

const PAGE_SIZE = 48

interface FollowDialogProps {
  onClose: () => void
  /** 选中用户：回填用户 ID 并触发作品抓取 */
  onPick: (userId: string) => void
  /** 批量同步：勾选的画师，按当前标签逐个抓取并下载 */
  onBatch: (artists: BatchArtist[]) => void
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * 关注列表弹窗：展示当前登录账号关注的画师，
 * 点击任意用户即以该用户 ID 抓取作品列表。
 */
export function FollowDialog(props: FollowDialogProps): React.JSX.Element {
  const { t } = useI18n()
  // 打开时回到上次浏览的页码，并直接使用缓存数据（过期才重新请求）
  const initial = readFollowPage(lastFollowPage())
  const [page, setPage] = useState(lastFollowPage)
  const [users, setUsers] = useState<FollowUser[]>(initial?.users ?? [])
  const [total, setTotal] = useState(initial?.total ?? 0)
  const [loading, setLoading] = useState(initial === null)
  const [error, setError] = useState('')
  // 勾选的画师跨页保留，顺序即勾选顺序
  const [picked, setPicked] = useState<BatchArtist[]>([])
  const [query, setQuery] = useState('')
  // 搜索需要跨页命中，边搜边把剩余页拉下来（并发 3，命中缓存就直接用）
  const [allUsers, setAllUsers] = useState<FollowUser[] | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadedPages, setLoadedPages] = useState(0)
  // StrictMode 下 effect 会执行两次，用 ref 挡住重复的整表加载
  const loadingRef = useRef(false)

  const selectedIds = new Set(picked.map((artist) => artist.id))

  const togglePick = (user: FollowUser): void => {
    setPicked((previous) =>
      previous.some((artist) => artist.id === user.id)
        ? previous.filter((artist) => artist.id !== user.id)
        : [...previous, { id: user.id, name: user.name }]
    )
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  useEffect(() => {
    let alive = true
    rememberFollowPage(page)

    const cached = readFollowPage(page)
    if (cached) {
      setUsers(cached.users)
      setTotal(cached.total)
      setError('')
      setLoading(false)
      return () => {
        alive = false
      }
    }

    setLoading(true)
    setError('')

    void window.pixiv
      .getFollowing({ userId: '', offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE })
      .then((result) => {
        if (!alive) return
        setUsers(result.users)
        setTotal(result.total)
        writeFollowPage(page, { users: result.users, total: result.total })
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setUsers([])
        setError(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [page])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasPrev = page > 1
  const hasNext = page < pageCount

  /** 把所有关注页读到内存：命中文档缓存就直接用，未命中的页并发 3 拉取 */
  const loadAllUsers = async (): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    setLoadingAll(true)
    setLoadedPages(0)
    const buckets: FollowUser[][] = []
    let cursor = 0
    let finished = 0

    const worker = async (): Promise<void> => {
      while (cursor < pages) {
        const index = cursor
        cursor += 1
        const cached = readFollowPage(index + 1)
        if (cached) {
          buckets[index] = cached.users
        } else {
          try {
            const result = await window.pixiv.getFollowing({
              userId: '',
              offset: index * PAGE_SIZE,
              limit: PAGE_SIZE
            })
            buckets[index] = result.users
            writeFollowPage(index + 1, { users: result.users, total: result.total })
          } catch {
            // 单页失败不影响其余页的搜索
            buckets[index] = []
          }
        }
        finished += 1
        setLoadedPages(finished)
      }
    }

    await Promise.all([worker(), worker(), worker()])
    setAllUsers(buckets.flat())
    setLoadingAll(false)
    loadingRef.current = false
  }

  const keyword = query.trim()

  useEffect(() => {
    if (!keyword || allUsers || loadingAll || total <= 0) return
    void loadAllUsers()
  }, [keyword, allUsers, loadingAll, total])

  // 无关键词时仍按当前页展示；关键词命中名称 / 用户 ID / 简介
  const visibleUsers = useMemo(() => {
    if (!keyword) return users
    const needle = keyword.toLowerCase()
    return (allUsers ?? users).filter(
      (user) =>
        user.name.toLowerCase().includes(needle) ||
        user.id.includes(needle) ||
        user.comment.toLowerCase().includes(needle)
    )
  }, [keyword, allUsers, users])

  const allVisiblePicked =
    visibleUsers.length > 0 && visibleUsers.every((user) => selectedIds.has(user.id))

  /** 全选本页：搜索态下作用于当前结果集，方便一次圈定一批画师 */
  const toggleVisible = (): void => {
    setPicked((previous) => {
      if (allVisiblePicked) {
        const ids = new Set(visibleUsers.map((user) => user.id))
        return previous.filter((artist) => !ids.has(artist.id))
      }
      const existing = new Set(previous.map((artist) => artist.id))
      const added = visibleUsers
        .filter((user) => !existing.has(user.id))
        .map((user) => ({ id: user.id, name: user.name }))
      return [...previous, ...added]
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Users className="h-4 w-4 text-primary" />
              {t('follow.title')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t('follow.hint')}
            </p>
            <p className="text-[11px] text-muted-foreground/70">{t('batch.selectHint')}</p>
          </div>
          <button
            type="button"
            aria-label={t('follow.close')}
            onClick={props.onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="shrink-0 border-b border-border/60 px-5 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              spellCheck={false}
              placeholder={t('follow.searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-8 pr-8 text-xs"
            />
            {query ? (
              <button
                type="button"
                aria-label={t('follow.searchClear')}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {keyword ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {loadingAll
                ? t('follow.searchLoading', { done: loadedPages, total: pageCount })
                : t('follow.searchCount', { count: visibleUsers.length })}
            </p>
          ) : null}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('follow.loading')}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : visibleUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              {keyword ? <Search className="h-6 w-6" /> : <Users className="h-6 w-6" />}
              {keyword ? t('follow.searchEmpty') : t('follow.empty')}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleUsers.map((user) => (
                <div
                  key={user.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => togglePick(user)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      togglePick(user)
                    }
                  }}
                  className={cn(
                    'group flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    selectedIds.has(user.id)
                      ? 'border-primary/70 bg-primary/10 ring-1 ring-primary/30'
                      : 'border-border/60 bg-secondary/20 hover:border-primary/50 hover:bg-secondary/40'
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selectedIds.has(user.id)}
                    aria-label={t('batch.select')}
                    onClick={(event) => {
                      event.stopPropagation()
                      togglePick(user)
                    }}
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                      selectedIds.has(user.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/70 bg-background/60 text-transparent hover:border-primary'
                    )}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </button>
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.name}
                      loading="lazy"
                      className="h-12 w-12 shrink-0 rounded-full border border-border/60 object-cover"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                      <Users className="h-5 w-5" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 truncate text-sm font-medium">{user.name}</p>
                      <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                        {user.id}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {user.comment || t('follow.noComment')}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onPick(user.id)
                        }}
                        className="rounded px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
                      >
                        {t('follow.pick')}
                      </button>
                      <a
                        href={`https://www.pixiv.net/users/${user.id}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                      >
                        pixiv
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-muted-foreground">
              {keyword
                ? t('follow.searchCount', { count: visibleUsers.length })
                : total > 0
                  ? t('follow.count', {
                      from: (page - 1) * PAGE_SIZE + 1,
                      to: Math.min(page * PAGE_SIZE, total),
                      total
                    })
                  : t('follow.none')}
            </p>
            <button
              type="button"
              disabled={visibleUsers.length === 0}
              onClick={toggleVisible}
              className="text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allVisiblePicked ? t('batch.deselectPage') : t('batch.selectPage')}
            </button>
            {picked.length > 0 ? (
              <button
                type="button"
                onClick={() => setPicked([])}
                className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {t('batch.clear')}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {picked.length > 0 ? (
              <Button size="sm" onClick={() => props.onBatch(picked)}>
                {t('batch.start', { count: picked.length })}
              </Button>
            ) : null}
            {keyword ? null : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasPrev || loading}
                  onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                >
                  <ChevronLeft />
                  {t('follow.prev')}
                </Button>
                <span className={cn('text-xs tabular-nums text-muted-foreground')}>
                  {page} / {pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasNext || loading}
                  onClick={() => setPage((previous) => Math.min(pageCount, previous + 1))}
                >
                  {t('follow.next')}
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
