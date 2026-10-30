import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  NovelDetail,
  NovelDownloadProgress,
  NovelDownloadResult,
  NovelEpisode,
  NovelOrder,
  NovelSearchMode,
  NovelSearchParams,
  NovelSearchResult,
  NovelSearchTarget,
  NovelSeries,
  NovelSeriesDetail,
  NovelSeriesNav,
  NovelWork
} from '../../shared/types'
// BASE 只用于拼下载文档里的「原文链接」，接口地址统一走 endpoints.ts
import { BASE, fetchJson } from './http'
import { webEndpoints } from './endpoints'
import { safeName } from './files'

/** 小说搜索最多翻到第 10 页 */
const MAX_SEARCH_PAGE = 10
const ORDERS: NovelOrder[] = ['date_d', 'date', 'popular_d', 'popular_male_d', 'popular_female_d']
const MODES: NovelSearchMode[] = ['all', 'safe']
const TARGETS: NovelSearchTarget[] = ['s_tag_full', 's_tag', 's_tc']

/** limit 超过 30 会直接返回 HTTP 400「不正确的请求」 */
const SERIES_PAGE_SIZE = 30

interface RawNovel {
  id?: string | number
  title?: string
  userId?: string | number
  userName?: string
  url?: string
  tags?: string[]
  xRestrict?: number
  createDate?: string
  updateDate?: string
  textCount?: number
  /** 详情接口用的是 characterCount，搜索结果用 textCount */
  characterCount?: number
  wordCount?: number
  readingTime?: number
  bookmarkCount?: number
  description?: string
  seriesId?: string | number
  seriesTitle?: string
  seriesContentOrder?: number
  aiType?: number
}

interface RawTag {
  tag?: string
}

interface RawEpisodeRef {
  id?: string | number
  title?: string
  order?: number
}

interface RawSeriesNav {
  seriesId?: string | number
  title?: string
  order?: number
  isConcluded?: boolean
  prev?: RawEpisodeRef | null
  next?: RawEpisodeRef | null
}

interface SearchResponse {
  error?: boolean
  message?: string
  body?: {
    novel?: { data?: RawNovel[]; total?: number; lastPage?: number }
    relatedTags?: string[]
  }
}

interface DetailResponse {
  error?: boolean
  message?: string
  body?: RawNovel & {
    content?: string
    pageCount?: number
    coverUrl?: string
    tags?: { tags?: RawTag[] }
    language?: string
    isOriginal?: boolean
    seriesNavData?: RawSeriesNav | null
    textEmbeddedImages?: Record<string, unknown>
  }
}

interface SeriesResponse {
  error?: boolean
  message?: string
  body?: {
    id?: string | number
    title?: string
    caption?: string
    cover?: { urls?: Record<string, string> }
    userId?: string | number
    userName?: string
    tags?: string[]
    xRestrict?: number
    isConcluded?: boolean
    publishedContentCount?: number
    publishedTotalCharacterCount?: number
    publishedReadingTime?: number
    updateDate?: string
  }
}

interface SeriesContentResponse {
  error?: boolean
  message?: string
  body?: {
    page?: {
      seriesContents?: {
        id?: string | number
        userId?: string | number
        title?: string
        commentHtml?: string
        tags?: string[]
        xRestrict?: number
        textLength?: number
        wordCount?: number
        readingTime?: number
        bookmarkCount?: number
        url?: string
        uploadTimestamp?: number
        aiType?: number
        series?: { id?: string | number; contentOrder?: number }
      }[]
    }
  }
}

/** 用户主页等其它模块也要把小说原始数据转成 NovelWork，故导出 */
export function toNovel(raw: RawNovel): NovelWork {
  return {
    id: String(raw.id ?? '').trim(),
    title: raw.title || '无题',
    userId: String(raw.userId ?? '').trim(),
    userName: raw.userName || '未知作者',
    cover: raw.url || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    xRestrict: Number(raw.xRestrict || 0),
    createDate: raw.createDate || '',
    updateDate: raw.updateDate || '',
    textCount: Number(raw.characterCount ?? raw.textCount ?? 0),
    wordCount: Number(raw.wordCount || 0),
    readingTime: Number(raw.readingTime || 0),
    bookmarkCount: Number(raw.bookmarkCount || 0),
    description: raw.description || '',
    seriesId: raw.seriesId ? String(raw.seriesId) : undefined,
    seriesTitle: raw.seriesTitle || undefined,
    seriesOrder: Number(raw.seriesContentOrder || 0) || undefined,
    aiType: Number(raw.aiType || 0)
  }
}

/** 正文内嵌图片：接口给的是「图片 ID -> 各种尺寸地址」的映射 */
function toEmbeddedImages(raw: Record<string, unknown> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      result[key] = value
      continue
    }
    if (!value || typeof value !== 'object') continue
    const item = value as { url?: string; src?: string; originalSrc?: string }
    const url = item.url || item.src || item.originalSrc
    if (url) result[key] = url
  }
  return result
}

export async function searchNovels(
  params: NovelSearchParams,
  cookie = '',
  signal?: AbortSignal
): Promise<NovelSearchResult> {
  const word = params.word.trim()
  if (!word) return { novels: [], total: 0, lastPage: 1, relatedTags: [] }

  const order = ORDERS.includes(params.order) ? params.order : 'date_d'
  const mode = MODES.includes(params.mode) ? params.mode : 'all'
  const target = TARGETS.includes(params.target) ? params.target : 's_tag_full'
  const page = Math.max(1, Math.min(MAX_SEARCH_PAGE, Math.round(Number(params.page) || 1)))

  const url = webEndpoints.novelSearch({
    word,
    order,
    mode,
    target,
    page
  })

  const data = await fetchJson<SearchResponse>(url, cookie, signal)
  if (data.error) throw new Error(`小说搜索接口报错：${data.message || '未知错误'}`)

  const novel = data.body?.novel || {}
  return {
    novels: (novel.data || []).map(toNovel).filter((item) => item.id),
    total: Number(novel.total || 0),
    lastPage: Math.max(1, Math.min(MAX_SEARCH_PAGE, Number(novel.lastPage || 1))),
    relatedTags: Array.isArray(data.body?.relatedTags) ? data.body.relatedTags : []
  }
}

export async function fetchNovelDetail(
  novelId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<NovelDetail> {
  const data = await fetchJson<DetailResponse>(
    webEndpoints.novelDetail(novelId),
    cookie,
    signal
  )
  if (data.error) throw new Error(`小说详情接口报错：${data.message || '未知错误'}`)

  const body = data.body
  if (!body) throw new Error('小说详情接口未返回内容')

  const summary = toNovel({ ...body, url: body.coverUrl || body.url })
  const tags = (body.tags?.tags || [])
    .map((item) => String(item.tag || '').trim())
    .filter(Boolean)

  return {
    ...summary,
    tags: tags.length > 0 ? tags : summary.tags,
    content: body.content || '',
    pageCount: Number(body.pageCount || 0),
    language: body.language,
    isOriginal: Boolean(body.isOriginal),
    series: toSeriesNav(body.seriesNavData),
    embeddedImages: toEmbeddedImages(body.textEmbeddedImages)
  }
}

function toSeriesNav(raw: RawSeriesNav | null | undefined): NovelSeriesNav | null {
  if (!raw || !raw.seriesId) return null
  const ref = (value: RawEpisodeRef | null | undefined) =>
    value && value.id
      ? { id: String(value.id), title: value.title || '', order: Number(value.order || 0) }
      : null
  return {
    id: String(raw.seriesId),
    title: raw.title || '',
    order: Number(raw.order || 0),
    isConcluded: Boolean(raw.isConcluded),
    prev: ref(raw.prev),
    next: ref(raw.next)
  }
}

function toSeries(raw: NonNullable<SeriesResponse['body']>): NovelSeries {
  const urls = raw.cover?.urls || {}
  return {
    id: String(raw.id ?? '').trim(),
    title: raw.title || '无题',
    caption: raw.caption || '',
    cover: urls['1200x1200'] || urls['480mw'] || urls['240mw'] || urls.original || '',
    userId: String(raw.userId ?? '').trim(),
    userName: raw.userName || '未知作者',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    xRestrict: Number(raw.xRestrict || 0),
    isConcluded: Boolean(raw.isConcluded),
    publishedContentCount: Number(raw.publishedContentCount || 0),
    publishedTotalCharacterCount: Number(raw.publishedTotalCharacterCount || 0),
    publishedReadingTime: Number(raw.publishedReadingTime || 0),
    updateDate: raw.updateDate || ''
  }
}

async function fetchSeries(
  seriesId: string,
  cookie: string,
  signal?: AbortSignal
): Promise<NovelSeries> {
  const data = await fetchJson<SeriesResponse>(
    webEndpoints.novelSeries(seriesId),
    cookie,
    signal
  )
  if (data.error) throw new Error(`小说系列接口报错：${data.message || '未知错误'}`)
  if (!data.body) throw new Error('小说系列接口未返回内容')
  return toSeries(data.body)
}

/** 系列章节目录：接口每页最多 30 话，超过时按最后序号继续翻 */
async function fetchSeriesEpisodes(
  seriesId: string,
  expected: number,
  cookie: string,
  signal?: AbortSignal
): Promise<NovelEpisode[]> {
  const episodes: NovelEpisode[] = []
  let lastOrder = 0

  for (let guard = 0; guard < 20; guard += 1) {
    const url = webEndpoints.novelSeriesContent(seriesId, lastOrder, SERIES_PAGE_SIZE)
    const data = await fetchJson<SeriesContentResponse>(url, cookie, signal)
    if (data.error) throw new Error(`系列目录接口报错：${data.message || '未知错误'}`)

    const items = data.body?.page?.seriesContents || []
    if (items.length === 0) break

    let added = 0
    for (const item of items) {
      const id = String(item.id ?? '').trim()
      if (!id) continue
      const order = Number(item.series?.contentOrder || 0)
      episodes.push({
        ...toNovel({
          ...item,
          textCount: item.textLength,
          seriesContentOrder: order,
          seriesId,
          seriesTitle: ''
        }),
        id,
        order
      })
      if (order > lastOrder) lastOrder = order
      added += 1
    }

    if (added === 0) break
    if (expected > 0 && episodes.length >= expected) break
    if (items.length < SERIES_PAGE_SIZE) break
  }

  return episodes.sort((a, b) => a.order - b.order)
}

export async function fetchNovelSeries(
  seriesId: string,
  cookie = '',
  signal?: AbortSignal
): Promise<NovelSeriesDetail> {
  const series = await fetchSeries(seriesId, cookie, signal)
  const episodes = await fetchSeriesEpisodes(
    seriesId,
    series.publishedContentCount,
    cookie,
    signal
  )
  return { series, episodes }
}

const RUBY_MARK = /\[\[rb:([^\]>]+?)\s*>\s*([^\]]+?)\]\]/g

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 把 pixiv 小说正文标记转成适合 TXT 阅读的纯文本 */
export function novelContentToText(content: string): string {
  return decodeEntities(
    content
      .replace(RUBY_MARK, (_match, base: string) => base)
      .replace(/\[pixivimage:[^\]]+\]/gi, '［插图］')
      .replace(/\[uploadedimage:[^\]]+\]/gi, '［插图］')
      .replace(/\[jump:[^\]]+\]/gi, '')
      .replace(/\[chapter:([^\]]*)\]/gi, '\n\n■ $1\n\n')
      .replace(/\[newpage\]/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function describeNovel(novel: NovelDetail, index?: number, total?: number): string {
  const lines = [
    `标题：${novel.title}`,
    `作者：${novel.userName}（ID ${novel.userId}）`,
    `链接：${BASE}/novel/show.php?id=${novel.id}`
  ]
  if (novel.series) {
    lines.push(`系列：${novel.series.title}（第 ${novel.series.order} 话）`)
  } else if (index !== undefined && total !== undefined) {
    lines.push(`系列：第 ${index + 1} / ${total} 话`)
  }
  lines.push(
    `字数：${novel.textCount}`,
    `收藏：${novel.bookmarkCount}`,
    `发布：${novel.createDate}`,
    `标签：${novel.tags.join(' ')}`
  )
  if (novel.description.trim()) {
    lines.push('', '简介：', novelContentToText(novel.description))
  }
  return lines.join('\n')
}

export interface NovelDownloadOptions {
  novelId?: string
  seriesId?: string
  outDir: string
  cookie: string
  signal?: AbortSignal
  onProgress?: (progress: NovelDownloadProgress) => void
}

/**
 * 保存小说为 TXT。
 * 单篇直接落盘；整部系列逐话拉取正文后合并成一个文件，
 * 这样离线阅读时不用在多个文件之间来回切换。
 */
export async function downloadNovel(options: NovelDownloadOptions): Promise<NovelDownloadResult> {
  const { outDir, cookie, signal, onProgress } = options

  const isSeries = Boolean(options.seriesId)
  if (!isSeries && !options.novelId) throw new Error('缺少小说 ID')

  let title = ''
  let author = ''
  let seriesTitle = ''
  let body = ''
  let episodes = 0
  let characters = 0
  let cover = ''
  let tags: string[] = []
  let seriesId: string | undefined

  if (isSeries) {
    const detail = await fetchNovelSeries(options.seriesId as string, cookie, signal)
    if (detail.episodes.length === 0) throw new Error('该系列没有可保存的章节')
    title = detail.series.title
    author = detail.series.userName
    seriesTitle = detail.series.title
    cover = detail.series.cover
    tags = detail.series.tags
    seriesId = detail.series.id

    const header = [
      `系列：${detail.series.title}`,
      `作者：${detail.series.userName}（ID ${detail.series.userId}）`,
      `链接：${BASE}/novel/series/${detail.series.id}`,
      `状态：${detail.series.isConcluded ? '已完结' : '连载中'}`,
      `章节：${detail.series.publishedContentCount} 话`,
      `字数：${detail.series.publishedTotalCharacterCount}`,
      `更新：${detail.series.updateDate}`,
      `标签：${detail.series.tags.join(' ')}`,
      '',
      '简介：',
      novelContentToText(detail.series.caption)
    ].join('\n')

    const chunks: string[] = [header]
    for (const [index, episode] of detail.episodes.entries()) {
      if (signal?.aborted) throw new Error('已取消')
      onProgress?.({
        done: index,
        total: detail.episodes.length,
        title: episode.title
      })
      const novel = await fetchNovelDetail(episode.id, cookie, signal)
      characters += novel.textCount
      chunks.push(
        [
          '',
          '========================================',
          `${episode.title}${episode.order ? `（第 ${episode.order} 话）` : ''}`,
          '========================================',
          '',
          describeNovel(novel),
          '',
          '----------------------------------------',
          '',
          novelContentToText(novel.content)
        ].join('\n')
      )
    }
    episodes = detail.episodes.length
    onProgress?.({ done: episodes, total: episodes, title })
    body = chunks.join('\n')
  } else {
    const novel = await fetchNovelDetail(options.novelId as string, cookie, signal)
    title = novel.title
    author = novel.userName
    seriesTitle = novel.series?.title || ''
    cover = novel.cover
    tags = novel.tags
    seriesId = novel.series?.id || novel.seriesId
    characters = novel.textCount
    episodes = 1
    onProgress?.({ done: 0, total: 1, title })
    body = [describeNovel(novel, 0, 1), '', '----------------------------------------', '', novelContentToText(novel.content)].join('\n')
    onProgress?.({ done: 1, total: 1, title })
  }

  const dir = path.join(outDir, '小说', safeName(author, 'novel'))
  await mkdir(dir, { recursive: true })
  const fileName = `${safeName(title, 'novel')}_${safeName(
    isSeries ? options.seriesId : options.novelId,
    'id'
  )}.txt`
  const target = path.join(dir, fileName)
  await writeFile(target, `\ufeff${body}\n`, 'utf-8')

  // 附带一份元数据，本地书库不必解析正文就能显示封面、标签与字数
  await writeFile(
    `${target}.meta.json`,
    JSON.stringify(
      {
        title,
        author,
        kind: isSeries ? 'series' : 'novel',
        novelId: isSeries ? undefined : (options.novelId as string),
        seriesId,
        episodes,
        characters,
        cover,
        tags,
        savedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )

  return {
    path: target,
    title: seriesTitle || title,
    episodes,
    characters
  }
}
