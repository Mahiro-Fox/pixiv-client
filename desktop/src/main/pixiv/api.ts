import type {
  AuthorContent,
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
  UserTag,
  UserWorkThumb,
  WorkContent,
  WorkPage
} from '../../shared/types'
import { buildTagQuery, hasTagFilter, matchesTagQuery } from '../../shared/tags'
import { fetchJson } from './http'
import { webEndpoints } from './endpoints'
import { mapPool } from './pool'
import { workBase } from './workFields'

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

interface TagSuggestCandidate {
  tag_name?: string
  tag_translation?: string
}

interface TagSuggestResponse {
  error?: boolean
  message?: string
  candidates?: TagSuggestCandidate[]
}

function toWork(raw: RawWork): PixivWork {
  return {
    ...workBase({
      id: raw.id,
      title: raw.title,
      userId: raw.userId,
      userName: raw.userName,
      pageCount: raw.pageCount,
      width: raw.width,
      height: raw.height,
      xRestrict: raw.xRestrict,
      illustType: raw.illustType,
      tags: raw.tags,
      createDate: raw.createDate,
      aiType: raw.aiType
    }),
    // 作者主页接口直接给列表缩略图，保持原样（下载不用这个字段）
    url: raw.url || ''
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
  signal?: AbortSignal,
  /** all：插画+漫画（作者主页「作品」口径）；illust / manga：只取单类 */
  content: AuthorContent = 'all'
): Promise<{ works: PixivWork[]; total: number }> {
  const url = webEndpoints.userTagWorks(userId, { tag, offset, limit, kind: content })

  const data = await fetchJson<ListResponse>(url, cookie, signal)
  if (data.error) throw new Error(`作品列表接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  return {
    works: (body.works || []).map(toWork),
    total: Number(body.total || 0)
  }
}

/** 作者主页的作品 id 清单：illusts / manga 各自是「id → null」对象 */
interface ProfileAllResponse {
  error?: boolean
  message?: string
  body?: {
    illusts?: Record<string, unknown> | string[]
    manga?: Record<string, unknown> | string[]
  }
}

interface ProfileWorksResponse {
  error?: boolean
  message?: string
  body?: { works?: Record<string, unknown> | unknown[] }
}

/**
 * 作品 id 清单。
 * 接口给的是「id → null」对象，JS 会把整数形式的键按数值升序枚举，
 * 而作品 id 随时间递增——原样 Object.keys 就成了「旧作品在前」，所以显式按 id 降序。
 */
function profileIds(raw: Record<string, unknown> | string[] | undefined): string[] {
  if (!raw) return []
  const ids = Array.isArray(raw) ? raw.map((id) => String(id)) : Object.keys(raw)
  return ids.filter(Boolean).sort((left, right) => Number(right) - Number(left))
}

/**
 * 一次抓取里 profile/all 会被每一页复用（400 件作品就是 9 页），缓存同一用户的 id 清单，
 * 并发翻页共享同一个请求。collectWorks 每次开始前会清掉，跨轮次不会吃到旧清单。
 *
 * 插画与漫画分开存：工作台的「全部 / 插画 / 漫画」栏目过滤只在这一层切，不再多打一次接口。
 */
interface ProfileIds {
  illusts: string[]
  manga: string[]
}

const profileIdsCache = new Map<string, Promise<ProfileIds>>()

async function allWorksIds(
  userId: string,
  cookie: string,
  signal?: AbortSignal
): Promise<ProfileIds> {
  const cached = profileIdsCache.get(userId)
  if (cached) return cached

  const task = (async () => {
    const data = await fetchJson<ProfileAllResponse>(
      webEndpoints.userProfileAll(userId),
      cookie,
      signal
    )
    if (data.error) throw new Error(`作品清单接口报错：${data.message || '未知错误'}`)
    return {
      illusts: profileIds(data.body?.illusts),
      manga: profileIds(data.body?.manga)
    }
  })()
  profileIdsCache.set(userId, task)
  try {
    return await task
  } catch (error) {
    // 失败的 promise 不能留在缓存里，否则这一轮后续翻页会全部跟着失败
    profileIdsCache.delete(userId)
    throw error
  }
}

/** profile/illusts 单次请求的 id 上限：与作者主页首屏一致 */
const PROFILE_IDS_PER_REQUEST = 48

/**
 * 「不限标签」时的全量作品分页。
 *
 * 不能再用 `illustmanga/tag?tag=`：那个列表会漏作品（实测某作者 401 件只回 366，
 * 漏掉的 35 件在 profile/all 与详情接口里都还在，与分级、AI 标记、发布时间都无关）。
 * 作者主页用的是 `profile/all` → `profile/illusts`，覆盖完整，这里走同一条路径：
 * 先取 id 清单，按 offset/limit 切出本页需要的 id，再分批换详情。
 * 请求数并不增加：limit=48 时一页一次，400 件作品共 9 次，和翻 9 页一样。
 */
async function fetchProfileWorksPage(
  userId: string,
  offset: number,
  limit: number,
  cookie = '',
  signal?: AbortSignal,
  content: AuthorContent = 'all'
): Promise<{ works: PixivWork[]; total: number }> {
  const lists = await allWorksIds(userId, cookie, signal)
  // 三个栏目共用同一份 profile/all：插画 / 漫画各取一组，全部则合并后按 id 降序
  const ids =
    content === 'illust'
      ? lists.illusts
      : content === 'manga'
        ? lists.manga
        : [...lists.illusts, ...lists.manga].sort((left, right) => Number(right) - Number(left))
  const pageIds = ids.slice(offset, offset + limit)
  if (pageIds.length === 0) return { works: [], total: ids.length }

  const batches: string[][] = []
  for (let index = 0; index < pageIds.length; index += PROFILE_IDS_PER_REQUEST) {
    batches.push(pageIds.slice(index, index + PROFILE_IDS_PER_REQUEST))
  }
  const pages = await mapPool(
    batches,
    2,
    async (batch) => {
      const data = await fetchJson<ProfileWorksResponse>(
        webEndpoints.userProfileIllusts(userId, batch),
        cookie,
        signal
      )
      if (data.error) throw new Error(`作品详情接口报错：${data.message || '未知错误'}`)
      const raw = data.body?.works
      const list = Array.isArray(raw) ? raw : Object.values(raw || {})
      return list.map((item) => toWork(item as RawWork))
    },
    signal
  )

  // 响应是按 id 索引的对象，顺序不可靠：按 id 清单还原，保证「新作品在前」
  const map = new Map<string, PixivWork>()
  pages.flat().forEach((work) => {
    if (work.id) map.set(work.id, work)
  })
  const works = pageIds.map((id) => map.get(id)).filter((work): work is PixivWork => Boolean(work))
  return { works, total: ids.length }
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
export async function fetchSelfUser(cookie = '', signal?: AbortSignal): Promise<SelfUser | null> {
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
  const data = await fetchJson<PagesResponse>(webEndpoints.illustPages(illustId), cookie, signal)
  if (data.error) throw new Error(`作品分页接口报错：${data.message || '未知错误'}`)
  return data.body || []
}

/** 动图（ugoira）元数据：zip 地址、帧顺序与每帧时长 */
export async function fetchUgoiraMeta(
  illustId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<UgoiraMeta> {
  const data = await fetchJson<UgoiraResponse>(webEndpoints.ugoiraMeta(illustId), cookie, signal)
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
 * 标签联想：网页搜索框走的是 `rpc/cps.php`，直接返回候选标签列表，
 * 每项带日文原名与当前界面语言的译文；这里去重后原样映射。
 */
export async function suggestTags(
  word: string,
  cookie = '',
  signal?: AbortSignal
): Promise<TagSuggestion[]> {
  const keyword = word.trim()
  if (keyword.length < 2) return []

  const data = await fetchJson<TagSuggestResponse>(webEndpoints.tagSuggest(keyword), cookie, signal)
  if (data.error) return []

  const seen = new Set<string>()
  return (data.candidates ?? []).reduce<TagSuggestion[]>((result, item) => {
    const tag = (item.tag_name ?? '').trim()
    if (!tag || seen.has(tag.toLowerCase())) return result
    seen.add(tag.toLowerCase())
    result.push({ tag, translation: (item.tag_translation ?? '').trim() || undefined })
    return result
  }, [])
}

interface RawUserTag {
  tag?: string
  tag_translation?: string
  tag_yomigana?: string
  cnt?: number
}

interface UserTagsResponse {
  error?: boolean
  message?: string
  body?: RawUserTag[] | { tagCloud?: RawUserTag[] }
}

/** 标签云接口的 body 正常是数组，个别版本包一层 tagCloud，这里两种都认 */
function tagItems(raw: UserTagsResponse['body']): RawUserTag[] {
  if (!raw) return []
  return Array.isArray(raw) ? raw : raw.tagCloud || []
}

/**
 * 作者用过的全部标签（作者主页「高级搜索」里的那份清单）。
 *
 * pixiv 把插画与漫画的标签分成两套：`all` 两边合并（同名标签累加计数，译文/读音取第一个非空值），
 * `illust` / `manga` 只读对应那一套，保证工作台切换栏目后弹窗里的件数与实际列表口径一致。
 * 漫画那份失败不影响整体——很多作者根本没有漫画。
 */
export async function fetchUserTags(
  userId: string,
  content: AuthorContent = 'all',
  cookie = '',
  signal?: AbortSignal
): Promise<UserTag[]> {
  const wantIllust = content !== 'manga'
  const wantManga = content !== 'illust'
  const [illusts, manga] = await Promise.all([
    wantIllust
      ? fetchJson<UserTagsResponse>(webEndpoints.userIllustTags(userId), cookie, signal)
      : Promise.resolve(null),
    wantManga
      ? fetchJson<UserTagsResponse>(webEndpoints.userMangaTags(userId), cookie, signal).catch(
          () => null
        )
      : Promise.resolve(null)
  ])
  if (illusts?.error) throw new Error(`标签接口报错：${illusts.message || '未知错误'}`)
  if (!illusts && !manga) return []

  const merged = new Map<string, UserTag>()
  const absorb = (items: RawUserTag[]): void => {
    for (const item of items) {
      const tag = String(item.tag || '').trim()
      if (!tag) continue
      const key = tag.toLowerCase()
      const translation = String(item.tag_translation || '').trim()
      const reading = String(item.tag_yomigana || '').trim()
      const count = Number(item.cnt || 0)
      const current = merged.get(key)
      if (current) {
        current.count += count
        if (!current.translation && translation) current.translation = translation
        if (!current.reading && reading) current.reading = reading
        continue
      }
      merged.set(key, {
        tag,
        translation: translation || undefined,
        reading: reading || undefined,
        count
      })
    }
  }
  if (illusts) absorb(tagItems(illusts.body))
  if (manga && !manga.error) absorb(tagItems(manga.body))

  // 常用标签在前；次数相同时按名称排，保证每次打开顺序一致
  return [...merged.values()].sort(
    (left, right) => right.count - left.count || left.tag.localeCompare(right.tag)
  )
}

export interface CollectOptions {
  userId: string
  tag: string
  /** 栏目：全部 / 插画 / 漫画 / 收藏；收藏栏目换的是接口，其余流程完全一致 */
  contentKind?: WorkContent
  /** 收藏栏目的公开 / 私密；其它栏目忽略 */
  bookmarkRest?: BookmarkRest
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
    query.include.length === 0
      ? ['']
      : query.mode === 'or'
        ? query.include
        : [query.include[0] ?? '']

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

/** 栏目白名单：手改配置或旧版本传进来的奇怪值一律按「全部」处理 */
const CONTENT_KINDS: WorkContent[] = ['all', 'illust', 'manga', 'bookmarks']

export function contentKindOf(value: unknown): WorkContent {
  return CONTENT_KINDS.includes(value as WorkContent) ? (value as WorkContent) : 'all'
}

/**
 * 抓取某一栏目：
 * - 收藏走 `illusts/bookmarks`（公开 / 私密由 rest 决定），标签直接交给接口；
 * - 插画 / 漫画 / 全部走作者主页那套（profile/all + profile/illusts，空标签时）；
 * 除此之外分页、组合标签、进度、失败计数全部是同一份 collectCombined。
 */
export function collectWorks(options: CollectOptions): Promise<CollectResult> {
  const { userId, cookie } = options
  const content = contentKindOf(options.contentKind)

  if (content === 'bookmarks') {
    const rest: BookmarkRest = options.bookmarkRest === 'hide' ? 'hide' : 'show'
    return collectCombined(
      (tag, offset, limit, signal) =>
        fetchBookmarks(userId, tag, offset, limit, rest, cookie, signal),
      options
    )
  }

  // 每次抓取都重新取 id 清单：同一轮翻页共享缓存，跨轮次（刚投稿完再抓）不吃旧数据
  profileIdsCache.delete(userId)
  return collectCombined(
    (tag, offset, limit, signal) =>
      // 不限标签走作者主页那条完整路径；带标签仍用 pixiv 的标签检索
      tag
        ? fetchWorks(userId, tag, offset, limit, cookie, signal, content)
        : fetchProfileWorksPage(userId, offset, limit, cookie, signal, content),
    options
  )
}
