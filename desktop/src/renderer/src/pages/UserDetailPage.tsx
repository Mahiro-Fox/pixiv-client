import { ArrowLeft, Bookmark, ExternalLink, Loader2, User as UserIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  NovelWork,
  UserContentResult,
  UserContentTab,
  UserProfile
} from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Pagination } from '@renderer/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { SearchWorkGrid } from '@renderer/components/WorkCard'
import { useWorkPreview } from '@renderer/lib/workPreview'

const PAGE_SIZE = 48
const TABS: UserContentTab[] = ['illust', 'manga', 'novel', 'bookmarks']

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 用户主页：插画 / 漫画 / 小说 / 收藏 四个栏目 */
export function UserDetailPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { userId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  /** 用户主页作品缩略图同样用应用内预览 */
  const { openPreview, previewNode } = useWorkPreview()

  const tab = (TABS.includes(params.get('tab') as UserContentTab)
    ? params.get('tab')
    : 'illust') as UserContentTab
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const [content, setContent] = useState<UserContentResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 未登录时收藏接口必然失败，先取登录状态，避免把接口原始报错抛给用户 */
  const [hasCookie, setHasCookie] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void window.pixiv
      .getCookie()
      .then((status) => {
        if (alive) setHasCookie(Boolean(status.hasCookie))
      })
      .catch(() => {
        if (alive) setHasCookie(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let alive = true
    setProfile(null)
    setProfileError('')
    void window.pixiv
      .getUserProfile(userId)
      .then((data) => {
        if (alive) setProfile(data)
      })
      .catch((reason: unknown) => {
        if (alive) setProfileError(messageOf(reason))
      })
    return () => {
      alive = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    // 未登录时收藏接口必然失败：登录状态确定后直接展示友好提示，不发请求
    if (tab === 'bookmarks' && hasCookie !== true) {
      setContent(null)
      setError('')
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .getUserContent({ userId, tab, page, limit: PAGE_SIZE })
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
  }, [userId, tab, page, hasCookie])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  const total = content?.total || 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const counts = profile?.counts
  /** 未登录时的收藏栏目：只展示提示，不请求、不显示空态 */
  const bookmarksLocked = tab === 'bookmarks' && hasCookie === false

  const tabLabel = (key: UserContentTab): string => {
    if (key === 'illust') return t('user.tabIllust')
    if (key === 'manga') return t('user.tabManga')
    if (key === 'novel') return t('user.tabNovel')
    return t('user.tabBookmarks')
  }

  const countOf = (key: UserContentTab): number | null => {
    if (!counts) return null
    if (key === 'illust') return counts.illust
    if (key === 'manga') return counts.manga
    if (key === 'novel') return counts.novel
    return null
  }

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t('user.back')}
        </Button>
        <a
          href={`https://www.pixiv.net/users/${userId}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
        >
          pixiv
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {profileError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {profileError}
        </div>
      ) : null}

      {profile ? (
        <div className="flex items-start gap-4 rounded-xl border border-border/60 bg-card/40 p-4">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-border/60 bg-secondary object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <UserIcon className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{profile.name}</h2>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {profile.id}
              </Badge>
              {profile.premium ? (
                <span className="rounded bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-500">
                  {t('user.premium')}
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('user.followingCount', { count: profile.following })}
            </p>
            {profile.comment ? (
              <p className="line-clamp-3 whitespace-pre-line text-[11px] leading-4 text-muted-foreground/90">
                {profile.comment}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => apply({ tab: value, page: '1' })}
        className="flex min-h-0 flex-col"
      >
        <TabsList>
          {TABS.map((key) => {
            const count = countOf(key)
            return (
              <TabsTrigger key={key} value={key}>
                {tabLabel(key)}
                {count !== null ? `（${count}）` : ''}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value={tab} className="min-h-0">
          {bookmarksLocked ? (
            <div className="mt-2 flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-4 py-8 text-center">
              <Bookmark className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{t('user.bookmarksHint')}</p>
              <p className="text-[11px] text-muted-foreground/70">{t('user.bookmarksLoginHint')}</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('works.loading')}
            </div>
          ) : null}

          {!loading && content && content.works.length > 0 && tab !== 'novel' ? (
            <SearchWorkGrid works={content.works} onPreview={openPreview} />
          ) : null}

          {!loading && content && content.novels.length > 0 && tab === 'novel' ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {content.novels.map((novel: NovelWork) => (
                <div
                  key={novel.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/novel/${novel.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      navigate(`/novel/${novel.id}`)
                    }
                  }}
                  className="flex cursor-pointer gap-3 rounded-xl border border-border/60 bg-card/40 p-2.5 transition-colors hover:border-primary/50"
                >
                  {novel.cover ? (
                    <img
                      src={novel.cover}
                      alt=""
                      loading="lazy"
                      className="h-[5.4rem] w-[3.9rem] shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="h-[5.4rem] w-[3.9rem] shrink-0 rounded bg-secondary/60" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="line-clamp-2 text-xs font-medium leading-4">{novel.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('novel.chars', { count: novel.textCount })}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {novel.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {!loading && content && content.works.length === 0 && content.novels.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {t('user.empty')}
            </div>
          ) : null}

          {pageCount > 1 ? (
            <div className="mt-3">
              <Pagination
                page={page}
                lastPage={pageCount}
                onChange={(next) => apply({ page: String(next) })}
                disabled={loading}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {previewNode}
    </main>
  )
}
