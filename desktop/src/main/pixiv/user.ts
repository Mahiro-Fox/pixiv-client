import type {
  NovelWork,
  SearchWork,
  UserContentParams,
  UserContentResult,
  UserContentTab,
  UserProfile,
  UserSearchItem,
  UserSearchParams,
  UserSearchResult,
  UserWorkThumb
} from '../../shared/types'
import { BASE, fetchJson } from './http'
import { toSearchWork } from './search'
import { toNovel } from './novels'

/** 用户主页每页条数；profile/illusts 支持一次传多个 ids */
const PROFILE_PAGE_SIZE = 48

const USER_URL = BASE + '/ajax/user/{id}?full=1&lang=zh'
const PROFILE_ALL_URL = BASE + '/ajax/user/{id}/profile/all?lang=zh'
const PROFILE_WORKS_URL =
  BASE +
  '/ajax/user/{id}/profile/illusts?{ids}&work_category=illustManga&is_first_page=1&lang=zh'
const PROFILE_NOVELS_URL =
  BASE + '/ajax/user/{id}/profile/novels?{ids}&work_category=novel&is_first_page=1&lang=zh'
const BOOKMARKS_URL =
  BASE + '/ajax/user/{id}/illusts/bookmarks?tag=&offset={offset}&limit={limit}&rest=show&lang=zh'
// i=1 只搜「投稿过作品」的用户，i=0 为全部用户；翻页用 p（不传默认第一页）
const USER_SEARCH_URL =
  BASE + '/ajax/search/users?nick={nick}&s_mode=s_usr&p={page}&i={scope}&lang=zh'

interface RawUserItem {
  userId?: string | number
  name?: string
  account?: string
  comment?: string
  /** 头像字段在不同版本/接口里叫法不一，全部兜底 */
  profileImageUrl?: string
  profileImageSmallUrl?: string
  image?: string
  imageBig?: string
  avatar?: string
  /** 其余未知字段：用「像图片地址」的启发式再兜一层 */
  [key: string]: unknown
}

/** 头像兜底：在用户对象里找第一个像 pixiv 图片地址的字符串字段 */
function pickImageUrl(raw: RawUserItem): string {
  for (const value of Object.values(raw)) {
    if (typeof value !== 'string' || !value) continue
    if (!/^https?:\/\/([a-z0-9-]+\.)*(pixiv|pximg)\.net\//i.test(value)) continue
    if (/\.(jpe?g|png|webp|gif|webm)(\?|$)/i.test(value)) return value
  }
  return ''
}

interface UserSearchResponse {
  error?: boolean
  message?: string
  body?: {
    page?: {
      total?: number
      userIds?: (string | number)[]
      /** 用户 ID -> 该用户前四个作品（可能是 id 字符串，也可能是作品对象） */
      workIds?: Record<string, unknown[]>
    }
    users?: RawUserItem[]
    /** 实测：按作品类型分组的数组（illust / novel / novelSeries …），每项带 id 与 url */
    thumbnails?: Record<string, unknown>
  }
}

interface UserInfoResponse {
  error?: boolean
  message?: string
  body?: {
    userId?: string
    name?: string
    image?: string
    imageBig?: string
    premium?: boolean
    following?: number
    comment?: string
    background?: { url?: string }
  }
}

type IdMap = Record<string, unknown> | (string | number)[]

interface ProfileAllResponse {
  error?: boolean
  message?: string
  body?: { illusts?: IdMap; manga?: IdMap; novels?: IdMap }
}

interface ProfileWorksResponse {
  error?: boolean
  message?: string
  body?: { works?: Record<string, unknown> | unknown[] }
}

interface BookmarksResponse {
  error?: boolean
  message?: string
  body?: { works?: unknown[]; total?: number }
}

/** profile/all 的 illusts/manga/novels 可能是「id -> null」的对象，也可能是数组 */
function idList(raw: IdMap | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((id) => String(id).trim()).filter(Boolean)
  return Object.keys(raw).filter(Boolean)
}

/** works 字段可能是「id -> 作品」的对象，也可能是数组 */
function workValues(raw: Record<string, unknown> | unknown[] | undefined): unknown[] {
  if (!raw) return []
  return Array.isArray(raw) ? raw : Object.values(raw)
}

/** 按 id 顺序还原作品：接口返回的是对象，直接 Object.values 会丢失新作品优先的顺序 */
function pickById(values: unknown[], ids: string[]): unknown[] {
  const map = new Map<string, unknown>()
  values.forEach((value) => {
    const item = value as { id?: string | number }
    const id = String(item?.id ?? '').trim()
    if (id) map.set(id, value)
  })
  return ids.map((id) => map.get(id)).filter((value): value is unknown => Boolean(value))
}

function pageOf<T>(list: T[], page: number, limit: number): T[] {
  const start = (page - 1) * limit
  return list.slice(start, start + limit)
}

/**
 * thumbnails 是按类型分组的作品数组：{ illust: [...], novel: [...] }，
 * 这里摊平成「作品 ID -> 缩略图地址」，供 workIds 里的纯 id 补图。
 */
function thumbUrlMap(raw: Record<string, unknown> | undefined): Map<string, string> {
  const map = new Map<string, string>()
  Object.values(raw || {}).forEach((group) => {
    if (!Array.isArray(group)) return
    group.forEach((entry) => {
      const item = entry as { id?: string | number; url?: string; thumbnail?: string }
      const id = String(item?.id ?? '').trim()
      const url = item?.url || item?.thumbnail || ''
      if (id && url) map.set(id, url)
    })
  })
  return map
}

/** workIds 里既可能是作品 id，也可能是作品对象；缩略图统一从 thumbnails 补齐 */
function userWorkThumb(
  entry: unknown,
  thumbUrls: Map<string, string>
): UserWorkThumb | null {
  if (typeof entry === 'string' || typeof entry === 'number') {
    const id = String(entry).trim()
    const url = thumbUrls.get(id) || ''
    return id && url ? { id, url } : null
  }
  if (entry && typeof entry === 'object') {
    const item = entry as { id?: string | number; illustId?: string | number; url?: string; thumbnail?: string }
    const id = String(item.id ?? item.illustId ?? '').trim()
    const url = item.url || item.thumbnail || thumbUrls.get(id) || ''
    return id && url ? { id, url } : null
  }
  return null
}

export async function searchUsers(
  params: UserSearchParams,
  cookie = '',
  signal?: AbortSignal
): Promise<UserSearchResult> {
  const word = params.word.trim()
  if (!word) return { users: [], total: 0 }

  const page = Math.max(1, Math.round(Number(params.page) || 1))
  const url = USER_SEARCH_URL.replace('{nick}', encodeURIComponent(word))
    .replace('{page}', String(page))
    .replace('{scope}', params.postedOnly ? '1' : '0')

  const data = await fetchJson<UserSearchResponse>(url, cookie, signal)
  if (data.error) throw new Error(`用户搜索接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  const thumbUrls = thumbUrlMap(body.thumbnails)
  const workIds = body.page?.workIds || {}
  const users = (body.users || [])
    .map((raw): UserSearchItem => {
      const id = String(raw.userId ?? '').trim()
      return {
        id,
        name: raw.name || '未知用户',
        comment: raw.comment || '',
        // 用户搜索接口实际给的是 image（50px）与 imageBig（170px）
        avatar:
          raw.imageBig ||
          raw.image ||
          raw.profileImageUrl ||
          raw.profileImageSmallUrl ||
          raw.avatar ||
          pickImageUrl(raw) ||
          '',
        works: (workIds[id] || [])
          .map((entry) => userWorkThumb(entry, thumbUrls))
          .filter((thumb): thumb is UserWorkThumb => thumb !== null)
          .slice(0, 4)
      }
    })
    .filter((user) => user.id)

  return { users, total: Number(body.page?.total || users.length) }
}

/** 用户主页基础信息；作品数来自 profile/all（该接口无需登录） */
export async function fetchUserProfile(
  userId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<UserProfile> {
  const id = userId.trim()
  if (!id) throw new Error('用户 ID 无效')

  const [info, all] = await Promise.all([
    fetchJson<UserInfoResponse>(USER_URL.replace('{id}', encodeURIComponent(id)), cookie, signal),
    fetchJson<ProfileAllResponse>(
      PROFILE_ALL_URL.replace('{id}', encodeURIComponent(id)),
      cookie,
      signal
    )
  ])
  if (info.error) throw new Error(`用户信息接口报错：${info.message || '未知错误'}`)

  const body = info.body || {}
  const counts = {
    illust: idList(all.body?.illusts).length,
    manga: idList(all.body?.manga).length,
    novel: idList(all.body?.novels).length
  }

  return {
    id: String(body.userId || id),
    name: body.name || '未知用户',
    comment: body.comment || '',
    avatar: body.imageBig || body.image || '',
    background: body.background?.url || '',
    premium: Boolean(body.premium),
    following: Number(body.following || 0),
    counts
  }
}

/**
 * 用户主页作品列表。
 * 插画与漫画共用 profile/illusts（用 profile/all 里的 id 集合区分栏目），
 * 小说走 profile/novels；收藏走 bookmarks 接口（需要登录态，非本人私密收藏无权限）。
 */
export async function fetchUserContent(
  params: UserContentParams,
  cookie = '',
  signal?: AbortSignal
): Promise<UserContentResult> {
  const userId = params.userId.trim()
  if (!userId) throw new Error('用户 ID 无效')

  const page = Math.max(1, Math.round(Number(params.page) || 1))
  const limit = Math.max(1, Math.min(100, Math.round(Number(params.limit) || PROFILE_PAGE_SIZE)))
  const tab: UserContentTab = params.tab

  if (tab === 'bookmarks') {
    const url = BOOKMARKS_URL.replace('{id}', encodeURIComponent(userId))
      .replace('{offset}', String((page - 1) * limit))
      .replace('{limit}', String(limit))
    const data = await fetchJson<BookmarksResponse>(url, cookie, signal)
    if (data.error) throw new Error(`收藏接口报错：${data.message || '未知错误'}`)

    const works = (data.body?.works || [])
      .map((raw) => toSearchWork(raw as Parameters<typeof toSearchWork>[0]))
      .filter((work) => work.id)
    const total = Number(data.body?.total || works.length)
    return { works, novels: [], total, hasMore: page * limit < total }
  }

  if (tab === 'novel') {
    const all = await fetchJson<ProfileAllResponse>(
      PROFILE_ALL_URL.replace('{id}', encodeURIComponent(userId)),
      cookie,
      signal
    )
    const ids = idList(all.body?.novels)
    const pageIds = pageOf(ids, page, limit)
    if (pageIds.length === 0) return { works: [], novels: [], total: ids.length, hasMore: false }

    const url = PROFILE_NOVELS_URL.replace('{id}', encodeURIComponent(userId)).replace(
      '{ids}',
      pageIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&')
    )
    const data = await fetchJson<ProfileWorksResponse>(url, cookie, signal)
    const novels: NovelWork[] = pickById(workValues(data.body?.works), pageIds).map((raw) =>
      toNovel(raw as Parameters<typeof toNovel>[0])
    )
    return { works: [], novels, total: ids.length, hasMore: page * limit < ids.length }
  }

  const all = await fetchJson<ProfileAllResponse>(
    PROFILE_ALL_URL.replace('{id}', encodeURIComponent(userId)),
    cookie,
    signal
  )
  const ids = idList(tab === 'manga' ? all.body?.manga : all.body?.illusts)
  const pageIds = pageOf(ids, page, limit)
  if (pageIds.length === 0) return { works: [], novels: [], total: ids.length, hasMore: false }

  const url = PROFILE_WORKS_URL.replace('{id}', encodeURIComponent(userId)).replace(
    '{ids}',
    pageIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&')
  )
  const data = await fetchJson<ProfileWorksResponse>(url, cookie, signal)
  const works: SearchWork[] = pickById(workValues(data.body?.works), pageIds)
    .map((raw) => toSearchWork(raw as Parameters<typeof toSearchWork>[0]))
    .filter((work) => work.id)

  return { works, novels: [], total: ids.length, hasMore: page * limit < ids.length }
}
