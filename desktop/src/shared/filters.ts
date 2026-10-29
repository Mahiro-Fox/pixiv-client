import type { AppConfig } from './types'
import { blockRulesOf, isBlocked, splitBlockTerms, type BlockRules } from './block'

/**
 * 过滤规则的统一实现。
 *
 * 放在 shared 里是因为判定要被两处用到：渲染层各列表（搜索 / 排行 / 推荐 /
 * 收藏 / 用户主页 / 小说 / 工作台）与下载入列前的筛选。以前只有工作台在用，
 * 现在顶部筛选对全站生效，判定必须只有一份，否则同一部作品在两种页面里
 * 会一会儿出现一会儿消失。
 */

/** 判定只关心这几个字段：作品、收藏条目、小说都能套用 */
export interface FilterableWork {
  title?: string
  userId?: string
  userName?: string
  tags?: Array<string | { tag?: string }>
  pageCount?: number
  width?: number
  height?: number
  xRestrict?: number
  aiType?: number
}

/** 小说没有页数 / 尺寸，但有正文字数与简介 */
export interface FilterableNovel {
  title?: string
  description?: string
  userId?: string
  userName?: string
  tags?: Array<string | { tag?: string }>
  xRestrict?: number
  aiType?: number
}

export interface CompiledFilters {
  minPages: number
  maxPages: number
  minWidth: number
  minHeight: number
  excludeTags: string[]
  excludeKeywords: string[]
  r18: 'any' | 'only' | 'exclude'
  excludeAi: boolean
  blocks: BlockRules
  /** 一条规则都没开时可以直接跳过整个过滤流程 */
  active: boolean
}

/** 标签可能是字符串数组，也可能是 {tag} 结构，统一取展示名 */
function tagNames(tags: FilterableWork['tags']): string[] {
  return (tags || []).map((tag) =>
    (typeof tag === 'string' ? tag : String(tag?.tag || '')).toLowerCase()
  )
}

/** 编译选项：某些数据源（例如推荐页）的接口本身不提供分级维度 */
export interface FilterCompileOptions {
  /** 忽略内容分级，等价于把 `r18` 强制为 `any` */
  ignoreRating?: boolean
}

/**
 * 把配置编译成可复用的判定参数。
 * 列表每渲染一次都要过一遍规则，配置只在改动时变，编译一次即可。
 */
export function compileFilters(
  config: AppConfig | null | undefined,
  options?: FilterCompileOptions
): CompiledFilters {
  const source = config || ({} as AppConfig)
  const minPages = Math.max(0, Math.round(source.filterMinPages || 0))
  const maxPages = Math.max(0, Math.round(source.filterMaxPages || 0))
  const minWidth = Math.max(0, Math.round(source.filterMinWidth || 0))
  const minHeight = Math.max(0, Math.round(source.filterMinHeight || 0))
  const excludeTags = splitBlockTerms(source.filterExcludeTags || '')
  const excludeKeywords = splitBlockTerms(source.filterExcludeKeywords || '')
  // 推荐页这类数据源不分级：忽略 r18 而不是当成 'any' 之外的其它值
  const r18 = options?.ignoreRating ? 'any' : source.filterR18 || 'any'
  const excludeAi = Boolean(source.filterExcludeAi)
  const blocks = blockRulesOf({
    blockTags: source.blockTags || '',
    blockUsers: source.blockUsers || ''
  })

  const active =
    minPages > 0 ||
    maxPages > 0 ||
    minWidth > 0 ||
    minHeight > 0 ||
    excludeTags.length > 0 ||
    excludeKeywords.length > 0 ||
    r18 !== 'any' ||
    excludeAi ||
    blocks.tags.length > 0 ||
    blocks.users.length > 0

  return {
    minPages,
    maxPages,
    minWidth,
    minHeight,
    excludeTags,
    excludeKeywords,
    r18,
    excludeAi,
    blocks,
    active
  }
}

/** 标签 / 关键词 / 分级 / AI 这些与内容类型无关的规则 */
function contentPasses(
  item: FilterableWork,
  filters: CompiledFilters,
  extraText: string
): boolean {
  const tags = tagNames(item.tags)
  const text = `${item.title || ''} ${item.userName || ''} ${extraText}`.toLowerCase()

  if (filters.excludeTags.length > 0) {
    if (tags.some((tag) => filters.excludeTags.includes(tag))) return false
    // 作者名 / 标题里出现同名标签也排除，避免漏网
    if (filters.excludeTags.some((term) => text.includes(term))) return false
  }

  if (filters.excludeKeywords.length > 0) {
    if (filters.excludeKeywords.some((term) => text.includes(term))) return false
  }

  const xRestrict = Number(item.xRestrict || 0)
  if (filters.r18 === 'only' && xRestrict < 1) return false
  if (filters.r18 === 'exclude' && xRestrict >= 1) return false

  // pixiv 的 aiType：1 非 AI，2 AI 生成
  if (filters.excludeAi && Number(item.aiType || 0) === 2) return false

  return true
}

/** 单个作品是否保留（规则之间是「与」关系，任意一条不满足即排除） */
export function workPasses(work: FilterableWork, filters: CompiledFilters): boolean {
  if (!filters.active) return true
  if (isBlocked(work, filters.blocks)) return false

  const pages = Number(work.pageCount || 0)
  if (filters.minPages > 0 && pages < filters.minPages) return false
  if (filters.maxPages > 0 && pages > filters.maxPages) return false

  const width = Number(work.width || 0)
  const height = Number(work.height || 0)
  if (filters.minWidth > 0 && width > 0 && width < filters.minWidth) return false
  if (filters.minHeight > 0 && height > 0 && height < filters.minHeight) return false

  return contentPasses(work, filters, '')
}

/** 单篇小说是否保留：与作品共用内容规则，跳过页数与尺寸 */
export function novelPasses(novel: FilterableNovel, filters: CompiledFilters): boolean {
  if (!filters.active) return true
  if (isBlocked(novel, filters.blocks)) return false
  return contentPasses(novel, filters, novel.description || '')
}

/** 过滤作品列表，同时返回被排除的数量 */
export function filterWorks<T extends FilterableWork>(
  works: T[],
  filters: CompiledFilters
): { items: T[]; removed: number } {
  if (!filters.active) return { items: works, removed: 0 }
  const items = works.filter((work) => workPasses(work, filters))
  return { items, removed: works.length - items.length }
}

/** 过滤小说列表 */
export function filterNovels<T extends FilterableNovel>(
  novels: T[],
  filters: CompiledFilters
): { items: T[]; removed: number } {
  if (!filters.active) return { items: novels, removed: 0 }
  const items = novels.filter((novel) => novelPasses(novel, filters))
  return { items, removed: novels.length - items.length }
}
