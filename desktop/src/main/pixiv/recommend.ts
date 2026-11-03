import type {
  RecommendUsersParams,
  RecommendUsersResult,
  RecommendWorksParams,
  RecommendWorksResult,
  SearchWork,
  UserSearchItem,
  WorkSearchMode
} from '../../shared/types'
import { fetchJson } from './http'
import { appEndpoints, webEndpoints } from './endpoints'
import { appApiGet } from './appApi'
import { getOAuthStatus } from './oauth'
import { searchWorkBase } from './workFields'

/** App API 的插画结构（只取本项目用到的字段） */
interface AppImageUrls {
  square_medium?: string
  medium?: string
  large?: string
  original?: string
}

interface AppUser {
  id?: string | number
  name?: string
  account?: string
  comment?: string
  profile_image_urls?: { px_16x16?: string; px_50x50?: string; px_170x170?: string }
}

interface AppIllust {
  id?: string | number
  title?: string
  type?: number
  image_urls?: AppImageUrls
  user?: AppUser
  tags?: { name?: string }[]
  create_date?: string
  page_count?: number
  width?: number
  height?: number
  x_restrict?: number
  illust_ai_type?: number
  total_bookmarks?: number
  bookmark_count?: number
}

interface AppIllustResponse {
  illusts?: AppIllust[]
  next_url?: string | null
}

interface AppUserPreview {
  user?: AppUser
  illusts?: AppIllust[]
}

interface AppUserResponse {
  user_previews?: AppUserPreview[]
  next_url?: string | null
}

/** 网页发现接口的作品结构与搜索结果接近，直接复用同一套字段 */
interface RawDiscoveryWork {
  id?: string | number
  title?: string
  userId?: string | number
  userName?: string
  url?: string
  profileImageUrl?: string
  pageCount?: number
  width?: number
  height?: number
  xRestrict?: number
  illustType?: number
  tags?: string[]
  createDate?: string
  aiType?: number
}

interface DiscoveryResponse {
  error?: boolean
  body?: { illusts?: RawDiscoveryWork[] }
}

function toSearchWork(raw: AppIllust): SearchWork {
  const images = raw.image_urls || {}
  return searchWorkBase({
    id: raw.id,
    title: raw.title,
    userId: raw.user?.id,
    userName: raw.user?.name,
    thumbnail: images.medium || images.large || images.square_medium,
    profileImageUrl: raw.user?.profile_image_urls?.px_50x50,
    pageCount: raw.page_count,
    width: raw.width,
    height: raw.height,
    xRestrict: raw.x_restrict,
    illustType: raw.type,
    tags: raw.tags,
    createDate: raw.create_date,
    bookmarkCount: raw.total_bookmarks ?? raw.bookmark_count,
    aiType: raw.illust_ai_type
  })
}

function toDiscoveryWork(raw: RawDiscoveryWork): SearchWork {
  return searchWorkBase({
    id: raw.id,
    title: raw.title,
    userId: raw.userId,
    userName: raw.userName,
    thumbnail: raw.url,
    profileImageUrl: raw.profileImageUrl,
    pageCount: raw.pageCount,
    width: raw.width,
    height: raw.height,
    xRestrict: raw.xRestrict,
    illustType: raw.illustType,
    tags: raw.tags,
    createDate: raw.createDate,
    bookmarkCount: 0,
    aiType: raw.aiType
  })
}

/** 头像有多种尺寸键，按大 → 小兜底 */
function avatarOf(urls?: AppUser['profile_image_urls']): string {
  return urls?.px_170x170 || urls?.px_50x50 || urls?.px_16x16 || ''
}

function toUserCard(preview: AppUserPreview): UserSearchItem | null {
  const user = preview.user
  const id = String(user?.id ?? '').trim()
  if (!id) return null

  const works = (preview.illusts || [])
    .slice(0, 4)
    .map((illust) => {
      const images = illust.image_urls || {}
      return {
        id: String(illust.id ?? '').trim(),
        url: images.square_medium || images.medium || ''
      }
    })
    .filter((thumb) => thumb.id && thumb.url)

  return {
    id,
    name: user?.name || '未知用户',
    // 推荐接口通常不带简介，退化成 @账号也能帮助识别
    comment: user?.comment || (user?.account ? `@${user.account}` : ''),
    // 推荐接口的 user 偶尔不带头像，用同一条目里作品作者的头像兜底
    avatar:
      avatarOf(user?.profile_image_urls) ||
      avatarOf(preview.illusts?.[0]?.user?.profile_image_urls),
    works
  }
}

/** 未连接 App API 时的网页兜底地址：发现接口按内容分级筛选 */
function discoverUrl(mode: WorkSearchMode | undefined): string {
  const value = mode === 'safe' || mode === 'r18' ? mode : 'all'
  return webEndpoints.discovery(value)
}

/**
 * 推荐作品。
 * 已连接 App API 时走个性化推荐（支持 next_url 续拉）；
 * 未连接时退回网页发现接口，保证页面不是空的。
 */
export async function fetchRecommendedWorks(
  params: RecommendWorksParams,
  signal?: AbortSignal
): Promise<RecommendWorksResult> {
  const status = await getOAuthStatus()

  if (!status.connected) {
    const data = await fetchJson<DiscoveryResponse>(discoverUrl(params.mode), '', signal)
    if (data.error) throw new Error('发现接口报错')
    const works = (data.body?.illusts || []).map(toDiscoveryWork).filter((work) => work.id)
    return { works, nextUrl: '', source: 'web' }
  }

  const path =
    params.nextUrl || appEndpoints.recommendedIllusts(params.kind === 'manga' ? 'manga' : 'illust')
  const data = await appApiGet<AppIllustResponse>(path, signal)
  const works = (data.illusts || []).map(toSearchWork).filter((work) => work.id)
  return { works, nextUrl: data.next_url || '', source: 'app' }
}

/** 推荐画师：只走 App API，未连接时由界面提示去设置 */
export async function fetchRecommendedUsers(
  params: RecommendUsersParams,
  signal?: AbortSignal
): Promise<RecommendUsersResult> {
  const data = await appApiGet<AppUserResponse>(
    params.nextUrl || appEndpoints.recommendedUsers(),
    signal
  )
  const users = (data.user_previews || [])
    .map(toUserCard)
    .filter((user): user is UserSearchItem => Boolean(user))
  return { users, nextUrl: data.next_url || '' }
}
