import {
  ArrowLeft,
  Bookmark,
  Download,
  ExternalLink,
  Loader2,
  User as UserIcon,
  UserCheck,
  UserPlus
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  NovelWork,
  OAuthStatus,
  UserContentResult,
  UserContentTab,
  UserProfile
} from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Pager } from '@renderer/components/Pager'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { SearchWorkGrid } from '@renderer/components/WorkCard'
import { usePagedQuery } from '@renderer/hooks/usePagedQuery'
import { toast } from '@renderer/utils/toast'

const PAGE_SIZE = 48
const TABS: UserContentTab[] = ['illust', 'manga', 'novel', 'bookmarks']

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export interface UserDetailPageProps {
  /** App 层的 OAuth 状态；设置里保存 / 清除凭据后关注按钮要立刻跟着变 */
  oauth: OAuthStatus | null
  /** 把作者带进下载工作台：参数与抓取由 App 负责，这里只管导航过去 */
  onDownloadAuthor: (userId: string) => void
}

/** 用户主页：插画 / 漫画 / 小说 / 收藏 四个栏目 */
export function UserDetailPage({
  oauth,
  onDownloadAuthor
}: UserDetailPageProps): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { userId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  /** 用户主页作品缩略图同样用应用内预览 */

  const tab = (
    TABS.includes(params.get('tab') as UserContentTab) ? params.get('tab') : 'illust'
  ) as UserContentTab
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))

  const [profile, setProfile] = useState<UserProfile | null>(null)
  /** 未登录时收藏接口必然失败，先取登录状态，避免把接口原始报错抛给用户 */
  const [hasCookie, setHasCookie] = useState<boolean | null>(null)

  /** 关注 / 取关依赖 App API 凭据；自己的主页不显示按钮 */
  const oauthConnected = oauth?.connected ?? false
  const [selfId, setSelfId] = useState('')
  const [followed, setFollowed] = useState(false)
  const [followReady, setFollowReady] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    let alive = true
    setFollowReady(false)
    setFollowed(false)
    void window.pixiv
      // 未配置 Cookie 时取不到自己，按「不是本人」处理即可
      .getSelfUser()
      .catch(() => null)
      .then(async (self) => {
        if (!alive) return
        setSelfId(self?.id || '')
        setFollowReady(true)
        // 未连接 App API 或看自己的主页时，不需要也不允许请求关注状态
        if (!oauthConnected || self?.id === userId) return
        const value = await window.pixiv.getFollowState(userId)
        if (alive) setFollowed(value)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setFollowReady(true)
        toast.error(messageOf(reason))
      })
    return () => {
      alive = false
    }
    // 连接状态变化时重跑：在设置里刚配置好凭据后，关注按钮要立刻出现
  }, [userId, oauthConnected])

  const toggleFollow = async (): Promise<void> => {
    if (followBusy) return
    setFollowBusy(true)
    try {
      setFollowed(await window.pixiv.setFollow(userId, { followed: !followed }))
    } catch (reason) {
      toast.error(messageOf(reason))
    } finally {
      setFollowBusy(false)
    }
  }

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
    void window.pixiv
      .getUserProfile(userId)
      .then((data) => {
        if (alive) setProfile(data)
      })
      .catch((reason: unknown) => {
        if (alive) toast.error(messageOf(reason))
      })
    return () => {
      alive = false
    }
  }, [userId])

  const { data: content, loading } = usePagedQuery<UserContentResult>({
    page,
    signature: [userId, tab].join('|'),
    // 没选用户不发请求；收藏标签在登录状态确定前也不发（必然失败）
    skip: !userId || (tab === 'bookmarks' && hasCookie !== true),
    // 切到别的作者时先清掉上一位的作品，避免看到别人的图闪一下
    clearOnChange: true,
    query: (next) => window.pixiv.getUserContent({ userId, tab, page: next, limit: PAGE_SIZE })
  })

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    // 栏目与页码都只是本页的视图状态，用 replace 不新增历史记录。
    // 否则切几次栏目再点「返回」，会先一步步退回上一个栏目，而不是离开本页。
    setParams(next, { replace: true })
  }

  /**
   * 直接打开 / 刷新本页时历史里只有这一条（初始记录的 key 固定为 "default"），
   * 此时 navigate(-1) 是空操作，点「返回」会毫无反应，退到用户搜索页兜底。
   */
  const goBack = (): void => {
    if (location.key === 'default') navigate('/users', { replace: true })
    else navigate(-1)
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
    <main className=" flex min-h-0 flex-1 flex-col gap-3  px-6 py-4">
      <div className="flex items-center gap-2 justify-between">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('user.back')}
        </Button>
        <a
          href={`https://www.pixiv.net/users/${userId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
        >
          pixiv
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {profile ? (
        <div className="flex items-start gap-4 rounded-xl border border-border/60 bg-card/40 p-4">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              decoding="async"
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
          {/* 把作者带进工作台：填好 ID 并直接抓一轮，省掉回下载页手抄 ID */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              onDownloadAuthor(userId)
              navigate('/workbench')
            }}
          >
            <Download className="h-4 w-4" />
            {t('user.toDownload')}
          </Button>
          {followReady && oauthConnected && selfId !== profile.id ? (
            <Button
              variant={followed ? 'outline' : 'default'}
              size="sm"
              className="shrink-0"
              disabled={followBusy}
              onClick={() => void toggleFollow()}
            >
              {followBusy ? (
                <Loader2 className="animate-spin" />
              ) : followed ? (
                <UserCheck className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {followed ? t('user.followed') : t('user.follow')}
            </Button>
          ) : null}
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

          {loading ? (
            <div className="flex h-42 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('works.loading')}
            </div>
          ) : null}

          {!loading && content && content.works.length > 0 && tab !== 'novel' ? (
            <SearchWorkGrid works={content.works} />
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
                      decoding="async"
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

          {!loading && pageCount > 1 ? (
            <div className="mt-3">
              <Pager
                page={page}
                lastPage={pageCount}
                onChange={(next) => apply({ page: String(next) })}
                disabled={loading}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </main>
  )
}
