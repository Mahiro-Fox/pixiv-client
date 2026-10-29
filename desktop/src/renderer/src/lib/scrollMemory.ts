import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLayoutEffectOnActive } from 'keepalive-for-react'

/**
 * 滚动位置记忆。
 *
 * 注意：要把 `ref` 挂到**真正在滚动的那个容器**上。页面里常见的外层 `main`
 * 往往只是 flex 容器，实际滚动的是它内部带 `overflow-y-auto` 的元素，
 * 挂错位置读到的 `scrollTop` 永远是 0。
 *
 * 数据按 key 存在内存里（最多 60 条），重启应用即失效。
 */

const store = new Map<string, number>()

const MAX_ENTRIES = 60

export function readPageScroll(key: string): number {
  return store.get(key) ?? 0
}

function remember(key: string, top: number): void {
  if (!key || !Number.isFinite(top)) return
  store.set(key, Math.max(0, Math.round(top)))
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export interface ScrollMemory<T extends HTMLElement> {
  /** 挂到滚动容器上（用回调 ref，元素挂载 / 重新挂载时都能触发还原） */
  ref: (node: T | null) => void
  /** 整批数据重置时把位置归零（同时清掉记忆，避免下次挂载又跳回去） */
  reset: () => void
}

/**
 * 公共实现：用回调 ref 感知挂载。
 *
 * 之所以不用 `useRef` + `ref={ref}`：keep-alive 的缓存节点在离开时会脱离 DOM，
 * 回来时元素对象虽然复用了，但 React 不一定重新触发 layout effect，
 * 用回调 ref 才能拿到「节点又接上了」这个时机。
 *
 * 位置只在**滚动事件**里实时写入，不在 effect 清理 / 键切换时补写：
 * 切标签时 React 已经换上新的列表内容（旧列表更长时 `scrollTop` 会被 clamp），
 * 这时再读一次会把旧标签的真实位置覆盖掉，导致切回去总是回到顶部。
 */
function useScrollCore<T extends HTMLElement>(
  key: string
): ScrollMemory<T> & { nodeRef: React.RefObject<T | null>; attached: number } {
  const nodeRef = useRef<T | null>(null)
  const [attached, setAttached] = useState(0)
  /** 当前生效的键：滚动监听始终写到这里 */
  const keyRef = useRef(key)

  const ref = useCallback((node: T | null) => {
    nodeRef.current = node
    // 每次挂载 / 卸载都递增，驱动下面的 layout effect 重新执行
    setAttached((value) => value + 1)
  }, [])

  useLayoutEffect(() => {
    const node = nodeRef.current
    keyRef.current = key
    if (!node) return

    node.scrollTop = readPageScroll(key)

    const onScroll = (): void => remember(keyRef.current, node.scrollTop)
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [key, attached])

  const reset = useCallback(() => {
    remember(key, 0)
    const node = nodeRef.current
    if (node) node.scrollTop = 0
  }, [key])

  return { ref, reset, nodeRef, attached }
}

/** 普通页面（不进 keep-alive）用：挂载时还原，卸载时归档 */
export function useScrollMemory<T extends HTMLElement>(key: string): ScrollMemory<T> {
  const { ref, reset } = useScrollCore<T>(key)
  // 返回稳定对象，方便直接放进 effect 依赖
  return useMemo(() => ({ ref, reset }), [ref, reset])
}

/**
 * 被 keep-alive 缓存的页面用。
 *
 * 组件不会因路由离开而卸载，但缓存节点离开时会脱离 DOM，滚动位置随之丢失；
 * 所以除了挂载时还原，还要在「重新激活」时再拨一次（rAF 兜底，防止节点还没挂回）。
 */
export function useKeepAliveScroll<T extends HTMLElement>(key: string): ScrollMemory<T> {
  const { ref, reset, nodeRef, attached } = useScrollCore<T>(key)

  useLayoutEffectOnActive(
    () => {
      const apply = (): void => {
        const node = nodeRef.current
        if (node) node.scrollTop = readPageScroll(key)
      }
      apply()
      const id = requestAnimationFrame(apply)
      return () => cancelAnimationFrame(id)
    },
    [key, attached],
    true
  )

  // 返回稳定对象（ref / reset 都是 useCallback 常量），可直接放进 effect 依赖
  return useMemo(() => ({ ref, reset }), [ref, reset])
}
