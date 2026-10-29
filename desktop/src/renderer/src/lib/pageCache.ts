import { useMemo } from 'react'
import { useNavigationType } from 'react-router-dom'

/**
 * 页面数据快照缓存。
 *
 * 用途：从作品 / 作者详情返回列表页时，用浏览器「后退」(POP) 命中这里存的快照，
 * 不再重新请求接口，用户能接着看原来那批数据。
 * 手动点导航切换栏目是 PUSH 导航，不会命中缓存，仍然按原需求重新请求。
 */

interface CacheEntry {
  value: unknown
  /**
   * 写入时的 `location.key`（react-router 给每一次历史条目的唯一标记）。
   * 后退（POP）会复用原来的 key，重新导航（PUSH）会生成新 key，
   * 所以用它判断「这次是不是回到了当初那个历史条目」，比 `useNavigationType` 可靠。
   */
  tag?: string
}

const store = new Map<string, CacheEntry>()

/** 只保留最近若干页，避免长期浏览把内存撑大 */
const MAX_ENTRIES = 24

export function writePageCache(key: string, value: unknown, tag?: string): void {
  if (!key) return
  store.delete(key)
  store.set(key, { value, tag })
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/**
 * 读取快照。给了 tag 时只有 tag 相同才返回值：
 * 同一个 URL 被重新导航（新历史条目）时视为没命中，仍然重新请求。
 */
export function readPageCache<T>(key: string, tag?: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (tag !== undefined && entry.tag !== tag) return null
  return entry.value as T
}

/**
 * 组件级快照读取：按 key / tag 记忆，StrictMode 下 effect 跑两次也拿到同一个结果。
 *
 * 不要用「本次渲染是否已读取过」的 ref 做守卫——StrictMode 的二次执行会命中那个守卫，
 * 从而跳过快照、白白重新请求一次。
 */
export function useCachedPage<T>(key: string, tag?: string): T | null {
  const navType = useNavigationType()
  return useMemo(() => {
    const hit = readPageCache<T>(key, tag)
    if (hit) return hit
    // 后退时放宽 tag 校验：个别环境下 location.key 没复用也不至于白刷一次
    return navType === 'POP' ? readPageCache<T>(key) : null
  }, [key, tag, navType])
}

/** 滚动位置单独存，不参与上面的 LRU 重排（滚动事件很频繁，重排没有意义） */
const scrollStore = new Map<string, number>()

const MAX_SCROLL_ENTRIES = 60

export function writePageScroll(key: string, top: number): void {
  if (!key || !Number.isFinite(top)) return
  scrollStore.set(key, Math.max(0, Math.round(top)))
  while (scrollStore.size > MAX_SCROLL_ENTRIES) {
    const oldest = scrollStore.keys().next().value
    if (oldest === undefined) break
    scrollStore.delete(oldest)
  }
}

export function readPageScroll(key: string): number {
  return scrollStore.get(key) ?? 0
}
