import type { SeriesDetail, SeriesEpisode, WorkSeriesParams } from '../../shared/types'
import { appApiGet, appApiPost, ensureAppConnected, explainAppError } from './appApi'
import { getOAuthStatus } from './oauth'
import { BASE, fetchJson } from './http'

/** `/v1/illust/series` 的作品条目，只需要列表展示用到的字段 */
interface RawAppIllust {
  id?: string | number
  title?: string
  page_count?: number
  x_restrict?: number
  illust_type?: number
  create_date?: string
  user?: { id?: string | number; name?: string }
  image_urls?: { medium?: string; px_128x128?: string }
}

interface RawAppSeriesDetail {
  id?: string | number
  title?: string
  caption?: string
  watchlist_added?: boolean
  series_work_count?: number
  is_concluded?: boolean
  user?: {
    id?: string | number
    name?: string
    profile_image_urls?: Record<string, string>
  }
  cover_image_urls?: { medium?: string }
}

interface RawAppSeriesResponse {
  illust_series_detail?: RawAppSeriesDetail
  illusts?: RawAppIllust[]
  next_url?: string
}

/** 网页 `/ajax/illust/{id}` 里与系列相关的字段；无系列时可能是空对象 */
interface RawWebSeriesNav {
  seriesId?: string | number
  /** 网页接口用 title，另有少数接口用 seriesTitle */
  title?: string
  seriesTitle?: string
  order?: number
  isConcluded?: boolean
}

interface RawWebIllust {
  id?: string | number
  title?: string
  userId?: string | number
  userName?: string
  url?: string
  profileImageUrl?: string
  pageCount?: number
  xRestrict?: number
  illustType?: number
  description?: string
  seriesNavData?: RawWebSeriesNav | null
}

/**
 * 系列详情接口。
 * App API 的列表带 next_url 分页，这里循环取完；每页条数由服务端决定。
 */
const APP_SERIES_URL = '/v1/illust/series?illust_series_id={id}&filter=for_android'
/** 防御性上限：异常响应不至于把翻页变成死循环 */
const MAX_SERIES_PAGES = 30

function toEpisode(raw: RawAppIllust, order: number): SeriesEpisode | null {
  const id = String(raw.id ?? '').trim()
  if (!id) return null
  return {
    id,
    title: raw.title || '无题',
    order,
    thumbnail: raw.image_urls?.medium || raw.image_urls?.px_128x128 || '',
    userId: String(raw.user?.id ?? '').trim(),
    userName: raw.user?.name || '',
    pageCount: Number(raw.page_count || 0),
    xRestrict: Number(raw.x_restrict || 0),
    illustType: Number(raw.illust_type || 0)
  }
}

function avatarOf(detail: RawAppSeriesDetail): string {
  const urls = detail.user?.profile_image_urls || {}
  return urls.px_170x170 || urls.px_50x50 || ''
}

async function fetchAppSeries(seriesId: string): Promise<SeriesDetail> {
  let next = APP_SERIES_URL.replace('{id}', encodeURIComponent(seriesId))
  const raw: RawAppIllust[] = []
  let detail: RawAppSeriesDetail | undefined

  for (let guard = 0; guard < MAX_SERIES_PAGES; guard += 1) {
    const page = await appApiGet<RawAppSeriesResponse>(next)
    if (!detail) detail = page.illust_series_detail
    raw.push(...(page.illusts || []))
    if (!page.next_url) break
    next = page.next_url
  }

  if (!detail) throw new Error('系列接口未返回内容')

  // App API 不提供话序号，按发布时间升序后从 1 编号
  const sorted = [...raw].sort((left, right) => {
    const a = Date.parse(left.create_date || '')
    const b = Date.parse(right.create_date || '')
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
    return a - b
  })
  const episodes = sorted
    .map((item, index) => toEpisode(item, index + 1))
    .filter((item): item is SeriesEpisode => item !== null)

  return {
    id: String(detail.id ?? seriesId),
    title: detail.title || '无题',
    caption: detail.caption || '',
    userId: String(detail.user?.id ?? '').trim(),
    userName: detail.user?.name || '',
    avatar: avatarOf(detail),
    cover: detail.cover_image_urls?.medium || episodes[0]?.thumbnail || '',
    workCount: Number(detail.series_work_count || episodes.length),
    isConcluded: Boolean(detail.is_concluded),
    watchlisted: Boolean(detail.watchlist_added),
    episodes,
    source: 'app'
  }
}

/**
 * 网页兜底：App API 未连接或不可用时，从当前作品页的 seriesNavData 取系列信息。
 * 网页接口不提供整个系列的作品列表，因此这里只包含当前这一话。
 */
async function fetchWebSeries(seriesId: string, workId: string, cookie: string): Promise<SeriesDetail> {
  const data = await fetchJson<{ error?: boolean; message?: string; body?: RawWebIllust }>(
    `${BASE}/ajax/illust/${encodeURIComponent(workId)}?lang=zh`,
    cookie
  )
  if (data.error) throw new Error(`作品详情接口报错：${data.message || '未知错误'}`)

  const body = data.body
  if (!body) throw new Error('作品详情接口未返回内容')

  const nav = body.seriesNavData || {}
  const actualId = String(nav.seriesId ?? '').trim()
  // 无系列时接口可能返回空对象而不是 null，seriesId 缺失即视为不在系列中
  if (!actualId) throw new Error('该作品不属于任何系列')
  if (actualId !== seriesId) throw new Error('该作品不在这个系列中')

  const order = Math.max(1, Number(nav.order || 1))
  return {
    id: seriesId,
    title: nav.title || nav.seriesTitle || body.title || '无题',
    caption: body.description || '',
    userId: String(body.userId ?? '').trim(),
    userName: body.userName || '',
    avatar: body.profileImageUrl || '',
    cover: body.url || '',
    // 网页兜底拿不到总话数，0 表示未知
    workCount: 0,
    isConcluded: Boolean(nav.isConcluded),
    watchlisted: false,
    episodes: [
      {
        id: String(body.id ?? workId).trim(),
        title: body.title || '无题',
        order,
        thumbnail: body.url || '',
        userId: String(body.userId ?? '').trim(),
        userName: body.userName || '',
        pageCount: Number(body.pageCount || 0),
        xRestrict: Number(body.xRestrict || 0),
        illustType: Number(body.illustType || 0)
      }
    ],
    source: 'web'
  }
}

/** 已连接 App API 时取完整系列；失败或未连接时用作品页信息兜底 */
export async function fetchWorkSeries(
  params: WorkSeriesParams,
  cookie = ''
): Promise<SeriesDetail> {
  const seriesId = String(params?.seriesId || '').trim()
  if (!/^\d+$/.test(seriesId)) throw new Error('缺少有效的系列 ID')

  const workId = String(params?.workId || '').trim()
  let appError: unknown = null

  const status = await getOAuthStatus()
  if (status.connected) {
    try {
      return await fetchAppSeries(seriesId)
    } catch (error) {
      appError = error
    }
  }

  if (!/^\d+$/.test(workId)) {
    if (appError) throw explainAppError(appError)
    throw new Error('读取系列需要连接 App API 凭据（设置 → App API 凭据）')
  }

  try {
    return await fetchWebSeries(seriesId, workId, cookie)
  } catch (error) {
    throw explainAppError(appError ?? error)
  }
}

/** 加入 / 退出系列追更（App API 的漫画 watchlist） */
export async function setSeriesWatch(seriesId: string, watch: boolean): Promise<void> {
  const id = String(seriesId || '').trim()
  if (!/^\d+$/.test(id)) throw new Error('缺少系列 ID')
  await ensureAppConnected()
  try {
    await appApiPost(watch ? '/v1/watchlist/manga/add' : '/v1/watchlist/manga/delete', {
      series_id: id
    })
  } catch (error) {
    throw explainAppError(error)
  }
}
