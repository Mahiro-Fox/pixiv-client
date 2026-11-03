import type {
  RankingMode,
  RankingParams,
  RankingResult,
  SearchWork
} from '../../shared/types'
import { fetchJson } from './http'
import { webEndpoints } from './endpoints'
import { searchWorkBase, thumbUrl } from './workFields'

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

function toSearchWork(raw: RawRankingWork): SearchWork {
  return {
    ...searchWorkBase({
      id: raw.illust_id,
      title: raw.title,
      userId: raw.user_id,
      userName: raw.user_name,
      // 榜单给的是 480x960 竖图，列表只要小图
      thumbnail: thumbUrl(raw.url),
      profileImageUrl: raw.profile_img,
      pageCount: raw.illust_page_count,
      width: raw.width,
      height: raw.height,
      // 榜单没有 xRestrict 字段，用内容分级里的 sexual 代替
      xRestrict: raw.illust_content_type?.sexual,
      illustType: raw.illust_type,
      tags: raw.tags,
      createDate: raw.date,
      // 榜单接口不返回收藏数与 AI 标识，留默认值
      bookmarkCount: 0,
      aiType: 0
    }),
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

  // 日期只接受 YYYYMMDD，其它输入交给 pixiv 报错反而更难懂
  const rawDate = String(params.date || '').trim()
  const date = /^\d{8}$/.test(rawDate) ? rawDate : ''

  const url = webEndpoints.ranking({ mode, content, page, date })
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
