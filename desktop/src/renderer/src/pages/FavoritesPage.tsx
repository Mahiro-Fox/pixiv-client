import { Bookmark, Loader2, Search, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BookmarkRest, SelfUser, UserContentResult } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Pagination } from '@renderer/components/ui/pagination'
import { SearchWorkGrid } from '@renderer/components/WorkCard'
import { useWorkPreview } from '@renderer/lib/workPreview'

const PAGE_SIZE = 48

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * 收藏浏览页：只看不下载，便于按标签翻自己的或别人的公开收藏。
 * 用户 ID 留空时默认用当前登录账号；私密收藏只有本人可见。
 */
export function FavoritesPage(): React.JSX.Element {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const { openPreview, previewNode } = useWorkPreview()

  const [self, setSelf] = useState<SelfUser | null>(null)
  const [cookieReady, setCookieReady] = useState(false)
  /** 输入框单独维护，回车/点搜索才提交到 URL，避免逐字符请求 */
  const [input, setInput] = useState(params.get('userId') || '')
  const [tagInput, setTagInput] = useState(params.get('tag') || '')

  const userId = (params.get('userId') || '').trim()
  const rest: BookmarkRest = params.get('rest') === 'hide' ? 'hide' : 'show'
  const tag = (params.get('tag') || '').trim()
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))

  const [content, setContent] = useState<UserContentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    void window.pixiv
      .getSelfUser()
      .then((user) => {
        if (!alive) return
        setSelf(user)
        // 首次进入且 URL 没指定用户时，直接落到自己的公开收藏，省一次点击
        if (user && !params.get('userId')) {
          setInput(user.id)
          const next = new URLSearchParams(params)
          next.set('userId', user.id)
          setParams(next, { replace: true })
        }
      })
      .finally(() => {
        if (alive) setCookieReady(true)
      })
    return () => {
      alive = false
    }
    // 只在首次挂载时取一次登录信息
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 私密收藏只有本人能看，其它用户直接给提示，不发请求 */
  const privateBlocked = rest === 'hide' && Boolean(self) && userId !== self?.id

  useEffect(() => {
    if (!cookieReady) return
    if (!userId) {
      setContent(null)
      setError('')
      setLoading(false)
      return
    }
    if (privateBlocked) {
      setContent(null)
      setError('')
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .getUserContent({
        userId,
        tab: 'bookmarks',
        page,
        limit: PAGE_SIZE,
        bookmarkRest: rest,
        bookmarkTag: tag
      })
      .then((data) => {
        if (alive) setContent(data)
      })
      .catch((reason: unknown) => {
        if (alive) {
          setContent(null)
          setError(messageOf(reason))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId, rest, tag, page, cookieReady, privateBlocked])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  const submitUser = (): void => {
    apply({ userId: input.trim(), page: '' })
  }

  const submitTag = (): void => {
    apply({ tag: tagInput.trim(), page: '' })
  }

  const total = content?.total || 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Bookmark className="h-4 w-4 text-primary" />
          {t('favorites.title')}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('favorites.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={input}
            placeholder={t('favorites.userIdPlaceholder')}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitUser()
            }}
            className="h-8 w-40 text-xs"
          />
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={submitUser}>
          <Search />
          {t('favorites.load')}
        </Button>
        {self ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setInput(self.id)
              apply({ userId: self.id, rest: '', page: '' })
            }}
          >
            {t('favorites.mine', { name: self.name })}
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-border/70">
            {(['show', 'hide'] as BookmarkRest[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => apply({ rest: key === 'hide' ? 'hide' : '', page: '' })}
                className={
                  rest === key
                    ? 'bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary'
                    : 'px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50'
                }
              >
                {key === 'show' ? t('favorites.public') : t('favorites.private')}
              </button>
            ))}
          </div>

          <Input
            value={tagInput}
            placeholder={t('favorites.tagPlaceholder')}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitTag()
            }}
            className="h-8 w-36 text-xs"
          />
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={submitTag}>
            {t('favorites.filterTag')}
          </Button>
        </div>
      </div>

      {tag ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t('favorites.currentTag', { tag })}</span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setTagInput('')
              apply({ tag: '', page: '' })
            }}
          >
            {t('favorites.clearTag')}
          </button>
        </div>
      ) : null}

      {!cookieReady ? null : !userId ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 text-center">
          <Bookmark className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">{t('favorites.needUser')}</p>
          <p className="text-[11px] text-muted-foreground/70">{t('favorites.needUserHint')}</p>
        </div>
      ) : null}

      {privateBlocked ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-4 py-8 text-center">
          <Bookmark className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">{t('favorites.privateHint')}</p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!userId || privateBlocked ? null : (
        <>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t('favorites.count', { count: total })}</span>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {rest === 'hide' ? t('favorites.private') : t('favorites.public')}
            </Badge>
            <span className="truncate">{userId}</span>
          </div>

          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('works.loading')}
            </div>
          ) : null}

          {!loading && content && content.works.length > 0 ? (
            <SearchWorkGrid works={content.works} onPreview={openPreview} />
          ) : null}

          {!loading && content && content.works.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {t('favorites.empty')}
            </div>
          ) : null}

          {pageCount > 1 ? (
            <Pagination
              page={page}
              lastPage={pageCount}
              onChange={(next) => apply({ page: String(next) })}
              disabled={loading}
            />
          ) : null}
        </>
      )}

      {previewNode}
    </main>
  )
}
