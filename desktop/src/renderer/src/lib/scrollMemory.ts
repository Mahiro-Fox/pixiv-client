import { useLayoutEffect, useRef } from 'react'
import type * as React from 'react'
import { readPageScroll, writePageScroll } from './pageCache'

/**
 * 滚动位置记忆。
 *
 * `restore` 为 true 表示这一次渲染是从后退快照还原的，挂载后把滚动条拨回原位；
 * 为 false（新请求 / 改筛选 / 翻页）则回到顶部，避免沿用上一批内容的偏移。
 * 滚动过程中持续把当前位置写回缓存，键与页面数据快照共用同一个 key。
 */
export function useScrollMemory<T extends HTMLElement>(
  key: string,
  restore: boolean
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    if (restore) {
      const top = readPageScroll(key)
      if (top > 0) node.scrollTop = top
    } else {
      node.scrollTop = 0
    }

    const onScroll = (): void => writePageScroll(key, node.scrollTop)
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [key, restore])

  return ref
}
