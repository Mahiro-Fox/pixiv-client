import type {
  BookmarkRest,
  CollectProgress,
  CollectResult,
  CookieHealth,
  FollowingResult,
  PixivWork,
  SelfUser,
  TagMode,
  TagSuggestion,
  UgoiraFrame,
  UserWorkThumb,
  WorkPage
} from '../../shared/types'
import { buildTagQuery, hasTagFilter, matchesTagQuery } from '../../shared/tags'
import { fetchJson } from './http'
import { webEndpoints } from './endpoints'
import { pickLangText } from './lang'
import { mapPool } from './pool'

/** 自省接口候选：按顺序尝试，命中即止 */
const SELF_CANDIDATES = [webEndpoints.self(), webEndpoints.selfAlt()]

/** 翻页并发上限，避免连续请求触发 429 */
const PAGE_CONCURRENCY = 3

interface RawWork {
  id?: string | number
  title?: string
  userId?: string | number
  userName?: string
  url?: string
  pageCount?: number
  width?: number
  height?: number
  xRestrict?: number
  illustType?: number
  tags?: string[]
  createDate?: string
  aiType?: number
}

interface ListResponse {
  error?: boolean
  message?: string
  body?: {
    works?: RawWork[]
    total?: number
  }
}

/** 关注列表里每项都自带该用户前 4 个插画 / 小说的缩略图信息 */
interface FollowThumb {
  id?: string | number
  url?: string
}

interface FollowingResponse {
  error?: boolean
  message?: string
  body?: {
    users?: {
      userId?: string | number
      userName?: string
      userComment?: string
      profileImageUrl?: string
      profileImageSmallUrl?: string
      illusts?: FollowThumb[]
      novels?: FollowThumb[]
    }[]
    total?: number
  }
}

interface SelfUserData {
  id?: string
  name?: string
  pixivId?: string
  profileImg?: string
  profileImgBig?: string
  premium?: boolean
}

interface SelfResponse {
  error?: boolean
  message?: string
  userData?: SelfUserData
  body?: {
    userId?: string
    userData?: SelfUserData
  }
}

interface PageInfo {
  urls?: Record<string, string>
  width?: number
  height?: number
}

interface PagesResponse {
  error?: boolean
  message?: string
  body?: PageInfo[]
}

interface UgoiraResponse {
  error?: boolean
  message?: string
  body?: {
    src?: string
    originalSrc?: string
    mime_type?: string
    frames?: { file?: string; delay?: number }[]
  }
}

export interface UgoiraMeta {
  zipUrl: string
  mimeType: string
  /** 帧顺序与每帧时长（毫秒），转码时按此编码 */
  frames: UgoiraFrame[]
}

interface TagBreadcrumb {
  tag?: string
  translation?: Record<string, string>
}

interface TagSuggestResponse {
  error?: boolean
  message?: string
  body?: {
    tag?: string
    word?: string
    pixpedia?: { parentTag?: string; tag?: string; siblingsTags?: string[] }
    breadcrumbs?: { successor?: TagBreadcrumb[]; current?: TagBreadcrumb[] }
    tagTranslation?: Record<string, Record<string, string>>
  }
}

function toWork(raw: RawWork): PixivWork {
  return {
    id: String(raw.id ?? '').trim(),
    title: raw.title || '无题',
    userId: String(raw.userId ?? '').trim(),
    userName: raw.userName || '未知作者',
    url: raw.url || '',
    pageCount: Number(raw.pageCount || 0),
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    xRestrict: Number(raw.xRestrict || 0),
    illustType: Number(raw.illustType || 0),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createDate: raw.createDate || '',
    aiType: Number(raw.aiType || 0)
  }
}

export function dedupeWorks(works: PixivWork[]): PixivWork[] {
  const seen = new Set<string>()
  const result: PixivWork[] = []
  for (const work of works) {
    if (!work.id || seen.has(work.id)) continue
    seen.add(work.id)
    result.push(work)
  }
  return result
}

export async function fetchWorks(
  userId: string,
  tag: string,
  offset: number,
  limit: number,
  cookie = '',
  signal?: AbortSignal
): Promise<{ works: PixivWork[]; total: number }> {
  const url = webEndpoints.userTagWorks(userId, { tag, offset, limit })

  const data = await fetchJson<ListResponse>(url, cookie, signal)
  if (data.error) throw new Error(`作品列表接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  return {
    works: (body.works || []).map(toWork),
    total: Number(body.total || 0)
  }
}

/** 收藏夹作品列表；rest 为 show 表示公开收藏，hide 表示私密收藏 */
export async function fetchBookmarks(
  userId: string,
  tag: string,
  offset: number,
  limit: number,
  rest: BookmarkRest,
  cookie = '',
  signal?: AbortSignal
): Promise<{ works: PixivWork[]; total: number }> {
  const url = webEndpoints.userBookmarks(userId, { tag, offset, limit, rest })

  const data = await fetchJson<ListResponse>(url, cookie, signal)
  if (data.error) throw new Error(`收藏夹接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  return {
    works: (body.works || []).map(toWork),
    total: Number(body.total || 0)
  }
}

/**
 * 读取当前登录账号；未登录或 Cookie 失效时返回 null。
 * pixiv 没有公开的自省接口，这里按候选列表依次尝试并做宽松解析，
 * 全部失败时由调用方提示用户手动填写收藏用户 ID。
 */
export async function fetchSelfUser(
  cookie = '',
  signal?: AbortSignal
): Promise<SelfUser | null> {
  for (const url of SELF_CANDIDATES) {
    try {
      const data = await fetchJson<SelfResponse>(url, cookie, signal)
      if (data.error) continue

      const info = data.body?.userData || data.userData
      const id = String(info?.id || data.body?.userId || '').trim()
      if (!id) continue
      return {
        id,
        name: info?.name || info?.pixivId || id,
        account: info?.pixivId ?? '',
        // 优先大图：高分屏下 50px 头像会被拉伸
        avatar: info?.profileImgBig || info?.profileImg || '',
        premium: Boolean(info?.premium)
      }
    } catch {
      // 单个候选失败（404/超时）不影响下一个候选
    }
  }
  return null
}

/**
 * Cookie 体检：只回答「确定有效」「确定失效」「问不出来」三个问题。
 * 不复用 fetchSelfUser：那个会把网络故障一并吞成 null，
 * 而这里必须把「问不出来」和「已失效」分开，否则代理一抖就误报要重新登录。
 * 实测 pixiv 的应答：未登录 → 200 且 userData 为 null；Cookie 失效 → 401。
 */
export async function probeCookieHealth(cookie: string): Promise<CookieHealth> {
  if (!cookie) return 'expired'
  try {
    // 体检只打一次，失败就下结论，不走进 fetchJson 的重试链
    const data = await fetchJson<SelfResponse>(webEndpoints.self(), cookie, undefined, 1)
    const info = data.body?.userData || data.userData
    const id = String(info?.id || data.body?.userId || '').trim()
    return id ? 'valid' : 'expired'
  } catch (error) {
    return /HTTP 40[13]/.test(String(error)) ? 'expired' : 'unknown'
  }
}

/** 关注列表项里的作品缩略图：插画优先，不足四个用小说封面补 */
function followWorks(
  illusts: FollowThumb[] | undefined,
  novels: FollowThumb[] | undefined
): UserWorkThumb[] {
  return [...(illusts || []), ...(novels || [])]
    .map((item) => {
      const id = String(item?.id ?? '').trim()
      const url = item?.url || ''
      return id && url ? { id, url } : null
    })
    .filter((thumb): thumb is UserWorkThumb => thumb !== null)
    .slice(0, 4)
}

/** 关注列表；userId 留空时自动解析当前登录账号 */
export async function fetchFollowing(
  userId: string,
  offset: number,
  limit: number,
  cookie = '',
  signal?: AbortSignal
): Promise<FollowingResult> {
  let target = String(userId || '').trim()
  if (!target) {
    const self = await fetchSelfUser(cookie, signal)
    if (!self) throw new Error('无法识别当前登录账号：请配置 Cookie，或填写用户 ID')
    target = self.id
  }

  const url = webEndpoints.following(target, {
    offset: Math.max(0, offset),
    limit: Math.max(1, Math.min(100, limit))
  })

  const data = await fetchJson<FollowingResponse>(url, cookie, signal)
  if (data.error) throw new Error(`关注列表接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  const users = (body.users || [])
    .map((user) => ({
      id: String(user.userId ?? '').trim(),
      name: user.userName || '未知用户',
      comment: user.userComment || '',
      avatar: user.profileImageSmallUrl || user.profileImageUrl || '',
      works: followWorks(user.illusts, user.novels)
    }))
    .filter((user) => user.id)

  return { users, total: Number(body.total || users.length) }
}

export async function fetchPages(
  illustId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<PageInfo[]> {
  const data = await fetchJson<PagesResponse>(
    webEndpoints.illustPages(illustId),
    cookie,
    signal
  )
  if (data.error) throw new Error(`作品分页接口报错：${data.message || '未知错误'}`)
  return data.body || []
}

/** 动图（ugoira）元数据：zip 地址、帧顺序与每帧时长 */
export async function fetchUgoiraMeta(
  illustId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<UgoiraMeta> {
  const data = await fetchJson<UgoiraResponse>(
    webEndpoints.ugoiraMeta(illustId),
    cookie,
    signal
  )
  if (data.error) throw new Error(`动图接口报错：${data.message || '未知错误'}`)

  const zipUrl = data.body?.originalSrc || data.body?.src || ''
  if (!zipUrl) throw new Error('动图接口未返回 zip 地址')

  const frames = (data.body?.frames || [])
    .map((frame) => ({
      file: String(frame.file || '').trim(),
      delay: Math.max(20, Number(frame.delay || 0))
    }))
    .filter((frame) => Boolean(frame.file))

  return {
    zipUrl,
    mimeType: data.body?.mime_type || 'image/jpeg',
    frames
  }
}

/** 预览用：同时返回常规图与高清原图地址，供详情弹窗切换 */
export async function fetchWorkPages(
  illustId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<WorkPage[]> {
  const pages = await fetchPages(illustId, cookie, signal)
  return pages
    .map((page) => {
      const regular = page.urls?.regular || page.urls?.small || ''
      const original = page.urls?.original || regular
      return {
        url: regular,
        regular,
        original,
        width: Number(page.width || 0),
        height: Number(page.height || 0)
      }
    })
    .filter((page) => Boolean(page.url))
}

/**
 * 标签建议：pixiv 的搜索补全接口对每个关键词只返回最佳匹配，
 * 这里把「搜索词 / 标签 / 父标签 / 关联标签」合并去重后作为候选。
 */
export async function suggestTags(
  word: string,
  cookie = '',
  signal?: AbortSignal
): Promise<TagSuggestion[]> {
  const keyword = word.trim()
  if (keyword.length < 2) return []

  const data = await fetchJson<TagSuggestResponse>(
    webEndpoints.tagSuggest(keyword),
    cookie,
    signal
  )
  if (data.error) return []

  const body = data.body || {}
  const seen = new Set<string>()
  const result: TagSuggestion[] = []

  const push = (tag?: string, translation?: string): void => {
    const value = (tag || '').trim()
    if (!value || seen.has(value.toLowerCase())) return
    seen.add(value.toLowerCase())
    result.push({ tag: value, translation: translation || undefined })
  }

  const successors = body.breadcrumbs?.successor || []
  const translations = new Map<string, string>()
  const translationOf = (tag?: string): string | undefined => {
    const key = (tag || '').trim()
    if (!key) return undefined
    const dict = body.tagTranslation?.[key]
    if (dict) return pickLangText(dict) || undefined
    return translations.get(key.toLowerCase())
  }

  successors.forEach((item) => {
    if (!item.tag) return
    const text = pickLangText(item.translation)
    if (text) translations.set(item.tag.toLowerCase(), text)
  })

  push(body.word)
  push(body.tag, translationOf(body.tag))
  push(body.pixpedia?.parentTag, translationOf(body.pixpedia?.parentTag))
  successors.forEach((item) => push(item.tag, translationOf(item.tag)))
  body.breadcrumbs?.current?.forEach((item) => push(item.tag, translationOf(item.tag)))

  return result.slice(0, 8)
}

export interface CollectOptions {
  userId: string
  tag: string
  /** 附加包含标签（组合搜索），逗号/空格分隔 */
  tagExtra?: string
  /** 排除标签（组合搜索），逗号/空格分隔 */
  tagExclude?: string
  /** 组合方式：and 同时满足 / or 任一满足 */
  tagMode?: TagMode
  offset: number
  limit: number
  workers: number
  /** 最多抓取的作品数（0 表示不限）；批量同步用它避免把整个标签全量拉下来 */
  maxWorks?: number
  cookie: string
  signal?: AbortSignal
  onProgress?: (progress: CollectProgress) => void
}

export interface BookmarkCollectOptions extends CollectOptions {
  rest: BookmarkRest
}

type PageFetcher = (
  offset: number,
  limit: number,
  signal?: AbortSignal
) => Promise<{ works: PixivWork[]; total: number }>

/**
 * 通用分页收集：先取首页确定总数，再补齐剩余分页。
 * 单页失败只计数，不中断整体；翻页并发受限，避免触发 429。
 */
async function collectPaged(
  fetchPage: PageFetcher,
  options: {
    offset: number
    limit: number
    workers: number
    maxWorks?: number
    signal?: AbortSignal
    onProgress?: (progress: CollectProgress) => void
  }
): Promise<CollectResult> {
  const { offset, limit, signal, onProgress } = options
  const first = await fetchPage(offset, limit, signal)

  if (!first.works.length) {
    onProgress?.({ loaded: 0, total: first.total, pagesDone: 1, pagesTotal: 1 })
    return { works: [], total: first.total, failedPages: 0 }
  }

  // maxWorks 只限制「再翻几页」，首页已经发出的请求无法回收
  const capped = Boolean(options.maxWorks && options.maxWorks > 0)
  const stopAt = capped ? offset + (options.maxWorks as number) : first.total
  const offsets: number[] = []
  for (let next = offset + limit; next < first.total && next < stopAt; next += limit) {
    offsets.push(next)
  }

  const chunks: PixivWork[][] = [first.works]
  const pagesTotal = offsets.length + 1
  let loaded = first.works.length
  let pagesDone = 1
  let failedPages = 0
  onProgress?.({ loaded, total: first.total, pagesDone, pagesTotal })

  // 翻页属于接口请求，高潮时最容易触发 429：这里限制为最多 3 路，
  // 实际节奏由 http 层的全局 API 闸门（并发 + 最小间隔 + 429 冷却）把控
  const concurrency = Math.max(1, Math.min(options.workers, offsets.length || 1, PAGE_CONCURRENCY))
  await mapPool(
    offsets,
    concurrency,
    async (pageOffset, index) => {
      try {
        const page = await fetchPage(pageOffset, limit, signal)
        chunks[index + 1] = page.works
        loaded += page.works.length
      } catch {
        failedPages += 1
      } finally {
        pagesDone += 1
        onProgress?.({ loaded, total: first.total, pagesDone, pagesTotal })
      }
    },
    signal
  )

  return { works: dedupeWorks(chunks.flat()), total: first.total, failedPages }
}

type SingleTagFetcher = (
  tag: string,
  offset: number,
  limit: number,
  signal?: AbortSignal
) => Promise<{ works: PixivWork[]; total: number }>

/**
 * 多标签组合抓取：
 * - AND：只按第一个包含标签走接口抓取，其余标签在本地按作品标签筛选；
 * - OR：逐个包含标签抓取后合并去重（顺序执行，避免并发叠加触发 429）；
 * - 排除标签统一在本地过滤。
 */
async function collectCombined(
  fetchTag: SingleTagFetcher,
  options: CollectOptions
): Promise<CollectResult> {
  const query = buildTagQuery(
    options.tag,
    options.tagExtra || '',
    options.tagExclude || '',
    options.tagMode || 'and'
  )

  const plan =
    query.include.length === 0 ? [''] : query.mode === 'or' ? query.include : [query.include[0]]

  const applyFilter = (result: CollectResult): CollectResult => {
    if (!hasTagFilter(query)) return result
    return { ...result, works: result.works.filter((work) => matchesTagQuery(work.tags, query)) }
  }

  if (plan.length <= 1) {
    return applyFilter(
      await collectPaged(
        (offset, limit, signal) => fetchTag(plan[0] ?? '', offset, limit, signal),
        options
      )
    )
  }

  const chunks: PixivWork[][] = []
  let doneLoaded = 0
  let doneTotal = 0
  let donePages = 0
  let donePagesTotal = 0
  let failedPages = 0

  for (const tag of plan) {
    let last: CollectProgress = { loaded: 0, total: 0, pagesDone: 1, pagesTotal: 1 }
    const result = await collectPaged(
      (offset, limit, signal) => fetchTag(tag, offset, limit, signal),
      {
        ...options,
        onProgress: (progress) => {
          last = progress
          options.onProgress?.({
            loaded: doneLoaded + progress.loaded,
            total: doneTotal + progress.total,
            pagesDone: donePages + progress.pagesDone,
            pagesTotal: donePagesTotal + progress.pagesTotal
          })
        }
      }
    )
    chunks.push(result.works)
    failedPages += result.failedPages
    doneLoaded += result.works.length
    doneTotal += last.total || result.total
    donePages += last.pagesDone
    donePagesTotal += last.pagesTotal
  }

  return applyFilter({ works: dedupeWorks(chunks.flat()), total: doneTotal, failedPages })
}

export function collectWorks(options: CollectOptions): Promise<CollectResult> {
  const { userId, cookie } = options
  return collectCombined(
    (tag, offset, limit, signal) => fetchWorks(userId, tag, offset, limit, cookie, signal),
    options
  )
}

export function collectBookmarks(options: BookmarkCollectOptions): Promise<CollectResult> {
  const { userId, rest, cookie } = options
  return collectCombined(
    (tag, offset, limit, signal) =>
      fetchBookmarks(userId, tag, offset, limit, rest, cookie, signal),
    options
  )
}
