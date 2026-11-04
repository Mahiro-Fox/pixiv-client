import type { FollowUser, UserTag, WorkContent, WorkPage } from '@shared/types'

/**
 * 弹窗数据缓存：弹窗卸载后仍保留已拉取的数据与浏览位置，
 * 短时间内重新打开不再重复请求接口。
 */

/** 关注列表缓存 5 分钟，超过后重新拉取该页 */
const FOLLOW_TTL = 5 * 60 * 1000
/** 作品分页缓存 10 分钟，画师改稿频率低 */
const PAGES_TTL = 10 * 60 * 1000

interface FollowPageEntry {
  users: FollowUser[]
  total: number
}

const followPages = new Map<number, FollowPageEntry>()
let followPage = 1
let followFetchedAt = 0

/** 上次浏览到第几页；与缓存是否过期无关，用于重新打开时回到原页码 */
export function lastFollowPage(): number {
  return followPage
}

export function rememberFollowPage(page: number): void {
  followPage = page
}

/** 读取未过期的关注列表页；过期返回 null 触发重新拉取 */
export function readFollowPage(page: number): FollowPageEntry | null {
  if (!followFetchedAt || Date.now() - followFetchedAt > FOLLOW_TTL) return null
  return followPages.get(page) ?? null
}

export function writeFollowPage(page: number, entry: FollowPageEntry): void {
  followPages.set(page, entry)
  followFetchedAt = Date.now()
}

const workPages = new Map<string, { pages: WorkPage[]; at: number }>()

/** 读取未过期的作品分页；命中时详情弹窗可立即渲染，不再等待接口 */
export function readWorkPages(illustId: string): WorkPage[] | null {
  const entry = workPages.get(illustId)
  if (!entry || Date.now() - entry.at > PAGES_TTL) return null
  return entry.pages
}

export function writeWorkPages(illustId: string, pages: WorkPage[]): void {
  workPages.set(illustId, { pages, at: Date.now() })
}

/** 作者标签云缓存 10 分钟：标签变动慢，重复开关弹窗不必再请求两次接口 */
const TAGS_TTL = 10 * 60 * 1000

const userTags = new Map<string, { tags: UserTag[]; at: number }>()

/** 同一作者的插画 / 漫画 / 全部是三份不同的标签清单，缓存要按栏目分开存 */
function tagsKey(userId: string, content: WorkContent): string {
  return `${userId}|${content}`
}

/** 读取未过期的标签云；过期返回 null 触发重新拉取 */
export function readUserTags(userId: string, content: WorkContent = 'all'): UserTag[] | null {
  const entry = userTags.get(tagsKey(userId, content))
  if (!entry || Date.now() - entry.at > TAGS_TTL) return null
  return entry.tags
}

export function writeUserTags(userId: string, tags: UserTag[], content: WorkContent = 'all'): void {
  userTags.set(tagsKey(userId, content), { tags, at: Date.now() })
}
