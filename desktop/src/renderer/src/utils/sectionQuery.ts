/**
 * 各栏目最后一次的查询串（`?word=...&page=...`）。
 *
 * 顶栏的「插画 / 漫画 / 小说 / 用户」是跨栏目导航，但「推荐 / 排行榜」这类页面上
 * URL 里没有 `word`，于是从它们返回栏目时只能拼出裸路径 —— 已经搜过的关键词、
 * 页码、筛选全部丢掉，回到插画页表现为「搜索框被清空、列表也没了」。
 *
 * 这里按栏目记一份查询串，导航跳转时优先还原它。
 * 只放内存，重启即失效，与 keep-alive 缓存、滚动位置的策略保持一致。
 */
const remembered = new Map<string, string>()

/** 栏目名与路由 pathname 去掉前导斜杠后一致 */
export type SearchSection = 'illust' | 'manga' | 'novel' | 'users'

/** 取该栏目上次的查询串；没有记录时返回空串（含前导 `?`） */
export function getSectionSearch(section: SearchSection): string {
  return remembered.get(section) || ''
}

/** 记录该栏目的查询串；空查询串表示用户主动清空了搜索，需要一并忘掉 */
export function rememberSectionSearch(section: SearchSection, search: string): void {
  if (search) remembered.set(section, search)
  else remembered.delete(section)
}
