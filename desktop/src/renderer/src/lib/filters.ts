import type { AppConfig, PixivWork } from '@shared/types'

/** 把「逗号/空格/顿号」分隔的输入拆成小写词条 */
function splitTerms(raw: string): string[] {
  return (raw || '')
    .split(/[,，、\s]+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
}

export interface FilterOutcome {
  works: PixivWork[]
  /** 被规则排除掉的数量 */
  removed: number
}

/**
 * 按配置中的过滤规则筛选作品（纯函数）。
 * 规则之间是「与」关系：任意一条不满足即排除。
 */
export function applyWorkFilters(works: PixivWork[], config: AppConfig): FilterOutcome {
  const minPages = Math.max(0, Math.round(config.filterMinPages || 0))
  const maxPages = Math.max(0, Math.round(config.filterMaxPages || 0))
  const minWidth = Math.max(0, Math.round(config.filterMinWidth || 0))
  const minHeight = Math.max(0, Math.round(config.filterMinHeight || 0))
  const excludeTags = splitTerms(config.filterExcludeTags)
  const excludeKeywords = splitTerms(config.filterExcludeKeywords)
  const r18 = config.filterR18 || 'any'
  const excludeAi = Boolean(config.filterExcludeAi)

  const keep = (work: PixivWork): boolean => {
    const pages = Number(work.pageCount || 0)
    if (minPages > 0 && pages < minPages) return false
    if (maxPages > 0 && pages > maxPages) return false

    const width = Number(work.width || 0)
    const height = Number(work.height || 0)
    if (minWidth > 0 && width > 0 && width < minWidth) return false
    if (minHeight > 0 && height > 0 && height < minHeight) return false

    const tags = (work.tags || []).map((tag) => tag.toLowerCase())
    if (excludeTags.length > 0) {
      if (tags.some((tag) => excludeTags.includes(tag))) return false
      // 作者名 / 标题里出现同名标签也排除，避免漏网
      const text = `${work.title} ${work.userName}`.toLowerCase()
      if (excludeTags.some((term) => text.includes(term))) return false
    }

    if (excludeKeywords.length > 0) {
      const text = `${work.title} ${work.userName}`.toLowerCase()
      if (excludeKeywords.some((term) => text.includes(term))) return false
    }

    if (r18 === 'only' && Number(work.xRestrict || 0) < 1) return false
    if (r18 === 'exclude' && Number(work.xRestrict || 0) >= 1) return false

    // pixiv 的 aiType：1 非 AI，2 AI 生成
    if (excludeAi && Number(work.aiType || 0) === 2) return false

    return true
  }

  const filtered = works.filter(keep)
  return { works: filtered, removed: works.length - filtered.length }
}

/** 生效的过滤规则数量（用于过滤图标徽标） */
export function countActiveFilters(config: AppConfig): number {
  return [
    config.filterMinPages > 0,
    config.filterMaxPages > 0,
    config.filterMinWidth > 0,
    config.filterMinHeight > 0,
    Boolean(config.filterExcludeTags.trim()),
    Boolean(config.filterExcludeKeywords.trim()),
    config.filterR18 !== 'any',
    config.filterExcludeAi
  ].filter(Boolean).length
}

/** 是否配置了任何过滤规则（用于界面提示） */
export function hasActiveFilters(config: AppConfig): boolean {
  return countActiveFilters(config) > 0
}
