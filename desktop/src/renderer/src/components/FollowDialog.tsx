import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { FollowUser } from '@shared/types'
import { lastFollowPage, readFollowPage, rememberFollowPage, writeFollowPage } from '@renderer/lib/dialogCache'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

const PAGE_SIZE = 48

interface FollowDialogProps {
  onClose: () => void
  /** 选中用户：回填用户 ID 并触发作品抓取 */
  onPick: (userId: string) => void
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
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Users className="h-6 w-6" />
              {t('follow.empty')}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => props.onPick(user.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') props.onPick(user.id)
                  }}
                  className="group flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-secondary/20 p-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/40"
                >
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
                      <span className="text-[11px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                        {t('follow.pick')}
                      </span>
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

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            {total > 0
              ? t('follow.count', {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: Math.min(page * PAGE_SIZE, total),
                  total
                })
              : t('follow.none')}
          </p>
          <div className="flex items-center gap-2">
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
          </div>
        </footer>
      </div>
    </div>
  )
}
