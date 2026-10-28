import type {
  RankingMode,
  RankingParams,
  RankingResult,
  SearchWork
} from '../../shared/types'
import { BASE, fetchJson } from './http'

/** 与 pixiv 网页端 ranking.php 的 mode 参数一致 */
const MODES: RankingMode[] = [
  'daily',
  'weekly',
  'monthly',
  'rookie',
  'original',
  'male',
  'female'
]
/** 榜单每页固定 50 件，网页端最多翻到第 10 页 */
const PAGE_SIZE = 50
const MAX_PAGE = 10

interface RawRankingWork {
  illust_id?: string | number
  title?: string
  date?: string
  tags?: string[]
  url?: string
  illust_type?: string | number
  illust_page_count?: string | number
  user_name?: string
  user_id?: string | number
  profile_img?: string
  width?: number
  height?: number
  rank?: number
  illust_content_type?: { sexual?: number }
}

interface RankingResponse {
  error?: boolean
  message?: string
  contents?: RawRankingWork[]
  rank_total?: number
  page?: number
  date?: string | number
  next_date?: string | number | false
}

/**
 * ranking.php 给的是 480x960 的竖图，卡片只需要小图；
 * 把 /c/... 段换成统一的 250 方图，失败时原样返回。
 */
function thumbOf(url: string): string {
  const text = String(url || '').trim()
  if (!text) return ''
  const match = /^(https?:\/\/i\.pximg\.net)\/c\/[^/]+(\/img-master\/.+)$/i.exec(text)
  return match ? `${match[1]}/c/250x250_80_a2${match[2]}` : text
}

function toSearchWork(raw: RawRankingWork): SearchWork {
  return {
    id: String(raw.illust_id ?? '').trim(),
    title: raw.title || '无题',
    userId: String(raw.user_id ?? '').trim(),
    userName: raw.user_name || '未知作者',
    thumbnail: thumbOf(String(raw.url || '')),
    profileImageUrl: String(raw.profile_img || ''),
    pageCount: Number(raw.illust_page_count || 0),
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    // 榜单没有 xRestrict 字段，用内容分级里的 sexual 代替
    xRestrict: Number(raw.illust_content_type?.sexual || 0),
    illustType: Number(raw.illust_type || 0),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createDate: String(raw.date || ''),
    // 榜单接口不返回收藏数与 AI 标识，留默认值
    bookmarkCount: 0,
    aiType: 0,
    rank: Number(raw.rank || 0)
  }
}

/**
 * pixiv 官方排行榜。
 * 走网页端 `ranking.php?format=json`，只依赖 Cookie（未登录也能取全年龄部分），
 * 与 App API 的推荐接口分开，避免排行榜也受 OAuth 状态影响。
 */
export async function fetchRanking(
  params: RankingParams,
  cookie = '',
  signal?: AbortSignal
): Promise<RankingResult> {
  const mode: RankingMode = MODES.includes(params.mode) ? params.mode : 'daily'
  const content = params.kind === 'manga' ? 'manga' : 'illust'
  const page = Math.max(1, Math.min(MAX_PAGE, Math.round(Number(params.page) || 1)))

  const search = new URLSearchParams({
    mode,
    content,
    p: String(page),
    format: 'json',
    lang: 'zh'
  })
  // 日期只接受 YYYYMMDD，其它输入交给 pixiv 报错反而更难懂
  const date = String(params.date || '').trim()
  if (/^\d{8}$/.test(date)) search.set('date', date)

  const url = `${BASE}/ranking.php?${search.toString()}`
  const data = await fetchJson<RankingResponse>(url, cookie, signal)
  if (data.error) throw new Error(data.message || '排行榜接口报错')

  const works = (data.contents || []).map(toSearchWork).filter((work) => work.id)
  const total = Number(data.rank_total || works.length)
  const lastPage = Math.max(1, Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE)))

  return {
    works,
    page: Math.max(1, Number(data.page || page)),
    lastPage,
    total,
    date: String(data.date || date || ''),
    nextDate: data.next_date ? String(data.next_date) : ''
  }
}
