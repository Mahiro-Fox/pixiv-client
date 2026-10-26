import type { TagMode } from './types'

/** 多标签组合查询：包含标签 + 排除标签 + 组合方式 */
export interface TagQuery {
  include: string[]
  exclude: string[]
  mode: TagMode
}

/** 把「逗号/空格/顿号」分隔的输入拆成去重后的标签列表（保留原始大小写） */
export function splitTagList(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  ;(raw || '')
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = tag.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      result.push(tag)
    })
  return result
}

/** 由「主标签 + 附加标签 + 排除标签」构建组合查询 */
export function buildTagQuery(
  primary: string,
  extra: string,
  exclude: string,
  mode: TagMode
): TagQuery {
  const include = splitTagList([primary, extra].filter(Boolean).join(','))
  return {
    include,
    exclude: splitTagList(exclude),
    mode: mode === 'or' ? 'or' : 'and'
  }
}

/**
 * 判断作品是否满足组合标签条件（纯函数）。
 * 作品没有返回标签时无法判断，保留作品，避免静默漏抓。
 */
export function matchesTagQuery(tags: string[] | undefined, query: TagQuery): boolean {
  const list = (tags || []).map((tag) => tag.toLowerCase())
  if (list.length === 0) return true

  if (query.exclude.some((tag) => list.includes(tag.toLowerCase()))) return false
  if (query.include.length === 0) return true

  const included = (tag: string): boolean => list.includes(tag.toLowerCase())
  return query.mode === 'or'
    ? query.include.some(included)
    : query.include.every(included)
}

/** 组合查询是否真的需要本地筛选（仅一个包含标签且无排除时无需筛选） */
export function hasTagFilter(query: TagQuery): boolean {
  return query.include.length > 1 || query.exclude.length > 0
}
