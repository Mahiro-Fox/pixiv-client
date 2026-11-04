import type { AppConfig, PixivWork } from '@shared/types'
import { compileFilters, filterWorks } from '@shared/filters'

export interface FilterOutcome {
  works: PixivWork[]
  /** 被规则排除掉的数量 */
  removed: number
}

/**
 * 按配置中的过滤规则筛选作品（纯函数）。
 * 判定本身在 `@shared/filters`，与其它列表页、下载筛选共用一份实现。
 */
export function applyWorkFilters(works: PixivWork[], config: AppConfig): FilterOutcome {
  const { items, removed } = filterWorks(works, compileFilters(config))
  return { works: items, removed }
}

/** 生效的过滤规则数量（用于过滤图标徽标）；推荐页可忽略内容分级 */
export function countActiveFilters(
  config: AppConfig,
  options?: { ignoreRating?: boolean }
): number {
  return [
    config.filterMinPages > 0,
    config.filterMaxPages > 0,
    config.filterMinWidth > 0,
    config.filterMinHeight > 0,
    Boolean(config.filterExcludeTags.trim()),
    Boolean(config.filterExcludeKeywords.trim()),
    options?.ignoreRating ? false : config.filterR18 !== 'any',
    config.filterExcludeAi,
    Boolean(config.blockTags.trim()),
    Boolean(config.blockUsers.trim())
  ].filter(Boolean).length
}

/** 是否配置了任何过滤规则（用于界面提示） */
export function hasActiveFilters(config: AppConfig): boolean {
  return countActiveFilters(config) > 0
}
