import type {
  SearchWork,
  TagSuggestion,
  WorkSearchChip,
  WorkSearchKind,
  WorkSearchMode,
  WorkSearchOrder,
  WorkSearchParams,
  WorkSearchResult,
  WorkSearchScope
} from '../../shared/types'
import { BASE, fetchJson } from './http'

/** 每页条数由 pixiv 决定（插画/漫画为 60），翻页上限沿用接口返回的 lastPage */
const ORDERS: WorkSearchOrder[] = [
  'date_d',
  'date',
  'popular_d',
  'popular_male_d',
  'popular_female_d'
]

interface RawSearchWork {
  id?: string | number
  illustId?: string | number
  title?: string
  illustTitle?: string
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
  bookmarkCount?: number
  aiType?: number
}

interface RawChip {
  id?: string
  label?: string
  url?: string
  isPremiumFeature?: boolean
  score?: number
}

interface RawBookmarkRange {
  min?: number | null
  max?: number | null
}

interface SearchResponse {
  error?: boolean
  message?: string
  body?: {
    illust?: {
      data?: RawSearchWork[]
      total?: number
      lastPage?: number
      bookmarkRanges?: RawBookmarkRange[]
    }
    manga?: {
      data?: RawSearchWork[]
      total?: number
      lastPage?: number
      bookmarkRanges?: RawBookmarkRange[]
    }
    relatedTags?: string[]
    /* 标签翻译：tag -> { zh, zh_tw, en, romaji, ... } */
    tagTranslation?: Record<string, Record<string, string>>
    suggestChips?: RawChip[]
  }
}

/**
 * suggestChips 解析。
 *
 * pixiv 给的是网页路由（/search?...&q=关键词&type=...），是「整份查询状态」的快照，
 * 而不是我们可用的 ajax 参数，所以不能直接拿来请求。这里取所有 chip 的 url，
 * 对每个参数取出现最多的值当作基线，凡是与基线不同的键就是该 chip 的增量。
 * 这样不依赖 chip id 或文案，pixiv 改 id 也不影响。
 */
const CHIP_KEYS = ['order', 'mode', 'csw', 'blt', 's_mode'] as const
/**
 * 无法映射到 ajax 接口的参数：dgw 含义未知。
 * type 单独处理：动到 type 的 chip 就是「包含漫画」，改由前端合并漫画接口实现。
 */
const CHIP_UNSUPPORTED = ['dgw'] as const
const CHIP_TYPE = 'type'

function parseChips(raw: RawChip[] | undefined): WorkSearchChip[] {
  const source = (raw || []).filter((chip) => chip.id && chip.url)
  if (source.length === 0) return []

  const parsed = source.map((chip) => ({
    chip,
    params: new URL(String(chip.url), 'https://www.pixiv.net').searchParams
  }))

  /** 逐参数取众数作为基线（含「缺失」这一取值） */
  const baseline = (key: string): string => {
    const counts = new Map<string, number>()
    parsed.forEach((item) => {
      const value = item.params.get(key) ?? ''
      counts.set(value, (counts.get(value) || 0) + 1)
    })
    let best = ''
    let bestCount = -1
    counts.forEach((count, value) => {
      if (count > bestCount) {
        best = value
        bestCount = count
      }
    })
    return best
  }

  const base: Record<string, string> = {}
  CHIP_KEYS.forEach((key) => {
    base[key] = baseline(key)
  })
  CHIP_UNSUPPORTED.forEach((key) => {
    base[key] = baseline(key)
  })
  base[CHIP_TYPE] = baseline(CHIP_TYPE)

  return parsed.flatMap(({ chip, params }) => {
    // dgw 等未知参数会改变查询语义，ajax 侧无法复现，直接跳过
    if (CHIP_UNSUPPORTED.some((key) => (params.get(key) ?? '') !== base[key])) return []

    const delta: WorkSearchChip['params'] = {}
    const order = params.get('order')
    if (order && order !== base.order && ORDERS.includes(order as WorkSearchOrder)) {
      delta.order = order as WorkSearchOrder
    }
    const mode = params.get('mode')
    if (mode === 'safe' || mode === 'r18') delta.mode = mode
    if (params.get('csw') === '1' && base.csw !== '1') delta.csw = '1'
    const blt = params.get('blt')
    if (blt && blt !== base.blt && Number(blt) > 0) delta.blt = blt
    const scope = params.get('s_mode')
    if (scope === 'tag_tc' && base.s_mode !== 'tag_tc') delta.scope = 'tag_tc'
    // 「包含漫画」：ajax 的 type=artwork 会 400，改为前端并行请求漫画接口再合并
    const type = params.get(CHIP_TYPE)
    if (type === 'artwork' && type !== base[CHIP_TYPE]) delta.includeManga = '1'

    if (Object.keys(delta).length === 0) return []
    return [
      {
        id: String(chip.id),
        label: chip.label || String(chip.id),
        premium: Boolean(chip.isPremiumFeature),
        params: delta
      }
    ]
  })
}

function parseBookmarkRanges(raw: RawBookmarkRange[] | undefined): number[] {
  const values = (raw || [])
    .map((item) => Number(item.min))
    .filter((value) => Number.isFinite(value) && value > 0)
  return Array.from(new Set(values)).sort((left, right) => right - left)
}

/** 搜索结果里标签的展示语言优先级：中文优先，其次罗马音，最后英文 */
function pickTranslation(dict?: Record<string, string>): string {
  if (!dict) return ''
  return dict.zh || dict.zh_tw || dict.romaji || dict.en || ''
}

/** 用户主页与收藏列表复用同一套作品字段映射 */
export function toSearchWork(raw: RawSearchWork): SearchWork {
  return {
    id: String(raw.id ?? raw.illustId ?? '').trim(),
    title: raw.illustTitle || raw.title || '无题',
    userId: String(raw.userId ?? '').trim(),
    userName: raw.userName || '未知作者',
    thumbnail: raw.url || '',
    profileImageUrl: raw.profileImageUrl || '',
    pageCount: Number(raw.pageCount || 0),
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    xRestrict: Number(raw.xRestrict || 0),
    illustType: Number(raw.illustType || 0),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createDate: raw.createDate || '',
    bookmarkCount: Number(raw.bookmarkCount || 0),
    aiType: Number(raw.aiType || 0)
  }
}

/**
 * 搜索插画 / 漫画。
 * 参数取自 pixiv 网页端：插画多一个 type=illust_and_ugoira，漫画没有；
 * 其余 order / mode / p / ai_type / csw / s_mode 两侧一致。
 */
export async function searchWorks(
  params: WorkSearchParams,
  cookie = '',
  signal?: AbortSignal
): Promise<WorkSearchResult> {
  const word = params.word.trim()
  const empty: WorkSearchResult = {
    works: [],
    total: 0,
    lastPage: 1,
    relatedTags: [],
    tagTranslation: {},
    chips: [],
    bookmarkRanges: []
  }
  if (!word) return empty

  const kind: WorkSearchKind = params.kind === 'manga' ? 'manga' : 'illust'
  const order = ORDERS.includes(params.order) ? params.order : 'date_d'
  const mode: WorkSearchMode =
    params.mode === 'safe' || params.mode === 'r18' ? params.mode : 'all'
  const scope: WorkSearchScope = params.scope === 'tag_tc' ? 'tag_tc' : 'tag'
  const blt = Math.max(0, Math.round(Number(params.blt) || 0))
  const page = Math.max(1, Math.round(Number(params.page) || 1))
  const csw = Boolean(params.csw)
  const query = { word, order, mode, page, csw, blt, scope, cookie, signal }

  const primary = await requestPage(kind, query)
  // 「包含漫画」只在插画页出现：并行再取一页漫画，前端合并展示
  if (kind !== 'illust' || !params.includeManga) return primary

  const manga = await requestPage('manga', query).catch(() => null)
  if (!manga) return primary

  return {
    works: [...primary.works, ...manga.works],
    total: primary.total + manga.total,
    lastPage: Math.max(primary.lastPage, manga.lastPage),
    relatedTags: Array.from(new Set([...primary.relatedTags, ...manga.relatedTags])),
    tagTranslation: { ...manga.tagTranslation, ...primary.tagTranslation },
    chips: primary.chips,
    bookmarkRanges: primary.bookmarkRanges
  }
}

interface PageQuery {
  word: string
  order: WorkSearchOrder
  mode: WorkSearchMode
  page: number
  csw: boolean
  blt: number
  scope: WorkSearchScope
  cookie: string
  signal?: AbortSignal
}

/** 取单个栏目（插画或漫画）的一页结果 */
async function requestPage(
  kind: WorkSearchKind,
  query: PageQuery
): Promise<WorkSearchResult> {
  const search = new URLSearchParams({
    order: query.order,
    mode: query.mode,
    p: String(query.page),
    ai_type: '0',
    csw: query.csw ? '1' : '0',
    s_mode: query.scope === 'tag_tc' ? 's_tag_tc' : 's_tag',
    ratio: '',
    lang: 'zh'
  })
  if (query.blt > 0) search.set('blt', String(query.blt))
  if (kind === 'illust') search.set('type', 'illust_and_ugoira')

  const path = kind === 'illust' ? 'illustrations' : 'manga'
  const url = `${BASE}/ajax/search/${path}/${encodeURIComponent(query.word)}?${search.toString()}`

  const data = await fetchJson<SearchResponse>(url, query.cookie, query.signal)
  if (data.error) throw new Error(`搜索接口报错：${data.message || '未知错误'}`)

  const body = data.body || {}
  const group = kind === 'illust' ? body.illust : body.manga
  const works = (group?.data || []).map(toSearchWork).filter((work) => work.id)
  const total = Number(group?.total || works.length)
  const lastPage = Number(group?.lastPage || Math.ceil(total / Math.max(1, works.length)))

  const tagTranslation: Record<string, string> = {}
  Object.entries(body.tagTranslation || {}).forEach(([tag, dict]) => {
    const text = pickTranslation(dict)
    if (text) tagTranslation[tag] = text
  })

  return {
    works,
    total,
    lastPage: Math.max(1, lastPage),
    relatedTags: (body.relatedTags || []).filter((tag) => Boolean(tag)),
    tagTranslation,
    chips: parseChips(body.suggestChips),
    bookmarkRanges: parseBookmarkRanges(group?.bookmarkRanges)
  }
}

const WORK_DETAIL_URL = BASE + '/ajax/illust/{id}?lang=zh'
const DISCOVERY_URL = BASE + '/ajax/illust/discovery?mode=all&lang=zh'

/** 详情接口给的标签结构与搜索结果不同（tags.tags 里是 { tag, translation }） */
type RawWorkDetail = Omit<RawSearchWork, 'tags'> & {
  tags?: { tags?: { tag?: string }[] }
}

function detailTags(body: RawWorkDetail): string[] {
  const list = body.tags?.tags
  if (!Array.isArray(list)) return []
  return list.map((item) => String(item?.tag || '').trim()).filter(Boolean)
}

/**
 * 用户列表的四图只带了 id 与缩略图地址，
 * 这里按 id 补全标题、作者、标签等详情，用于预览弹窗。
 */
export async function fetchWorkDetail(
  illustId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<SearchWork | null> {
  const id = illustId.trim()
  if (!/^\d+$/.test(id)) return null

  const data = await fetchJson<{ error?: boolean; body?: RawWorkDetail }>(
    WORK_DETAIL_URL.replace('{id}', id),
    cookie,
    signal
  )
  if (data.error || !data.body) return null

  const raw = data.body
  return toSearchWork({ ...raw, tags: detailTags(raw) })
}

/**
 * 热门标签。
 * pixiv 没有现成的「热门标签」接口，这里取首页推荐作品（mode=all），
 * 聚合标签出现频次并跳过 R-18 作品，取前 12 个。
 */
export async function fetchTrendingTags(
  cookie = '',
  signal?: AbortSignal
): Promise<TagSuggestion[]> {
  const data = await fetchJson<{
    error?: boolean
    body?: Record<string, { tags?: string[]; xRestrict?: number }>
  }>(DISCOVERY_URL, cookie, signal)
  if (data.error) return []

  const counts = new Map<string, number>()
  Object.values(data.body || {}).forEach((work) => {
    if (!work || typeof work !== 'object') return
    if (Number(work.xRestrict || 0) > 0) return
    ;(work.tags || []).forEach((tag) => {
      const key = String(tag || '').trim()
      if (!key) return
      counts.set(key, (counts.get(key) || 0) + 1)
    })
  })

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => ({ tag }))
}
