import type { AppConfig } from './types'

/**
 * 全局屏蔽规则：与 FilterDialog 里「只管下载队列」的过滤规则不同，
 * 这里命中后所有作品来源（搜索 / 用户主页 / 收藏 / 下载）都不再出现。
 */
export interface BlockRules {
  tags: string[]
  users: string[]
}

interface Blockable {
  userId?: string
  userName?: string
  /** 标签可能是字符串数组，也可能是 {tag} 结构，统一取展示名 */
  tags?: Array<string | { tag?: string }>
}

/** 把「逗号 / 空格 / 顿号 / 换行」分隔的输入拆成小写词条 */
export function splitBlockTerms(raw: string): string[] {
  return splitBlockTermsRaw(raw).map((term) => term.toLowerCase())
}

/**
 * 原样拆分（保留大小写）。
 * 取消屏蔽要从配置里删掉一条规则再写回，用原书写去重写才不会把用户手输的
 * 大小写、顺序全都改掉。
 */
export function splitBlockTermsRaw(raw: string): string[] {
  return (raw || '')
    .split(/[,，、\s]+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

/** 词条数组写回配置：统一用「逗号 + 空格」分隔，与手动输入的习惯一致 */
export function joinBlockTerms(terms: string[]): string {
  return terms.filter(Boolean).join(', ')
}

export function blockRulesOf(config: Pick<AppConfig, 'blockTags' | 'blockUsers'>): BlockRules {
  return {
    tags: splitBlockTerms(config?.blockTags || ''),
    users: splitBlockTerms(config?.blockUsers || '')
  }
}

export function hasBlockRules(rules: BlockRules): boolean {
  return rules.tags.length > 0 || rules.users.length > 0
}

/**
 * 命中该用户的屏蔽词条：用户 ID 全等，或作者名包含该词条。
 *
 * 取消屏蔽必须按「哪几条命中了」来删，不能只删 ID —— 用户可能是按昵称屏蔽的，
 * 也可能同时写了 ID 和昵称。
 */
export function blockedUserTerms(
  user: { userId?: string; userName?: string },
  rules: BlockRules
): string[] {
  if (!user || rules.users.length === 0) return []
  const userId = String(user.userId || '').trim()
  const userName = String(user.userName || '').toLowerCase()
  return rules.users.filter(
    (term) => term === userId || (userName !== '' && userName.includes(term))
  )
}

/**
 * 是否屏蔽某个作品。
 * 标签按全名不区分大小写匹配；用户支持「用户 ID」或「作者名包含」两种写法，
 * 这样用户即使只记得画师昵称也能屏蔽。
 */
export function isBlocked(work: Blockable, rules: BlockRules): boolean {
  if (!work) return false

  if (rules.tags.length > 0) {
    const tags = (work.tags || []).map((tag) =>
      (typeof tag === 'string' ? tag : String(tag?.tag || '')).toLowerCase()
    )
    if (tags.some((tag) => rules.tags.includes(tag))) return true
  }

  if (blockedUserTerms(work, rules).length > 0) return true

  return false
}

/** 过滤作品列表，返回保留下来的部分 */
export function filterBlocked<T extends Blockable>(works: T[], rules: BlockRules): T[] {
  if (!hasBlockRules(rules)) return works
  return works.filter((work) => !isBlocked(work, rules))
}
