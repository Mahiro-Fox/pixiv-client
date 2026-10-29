import { useSyncExternalStore } from 'react'

/**
 * 关键词提交序号。
 *
 * 顶栏搜索框只在回车（提交）时触发搜索，但同一个关键词重复提交时 URL 不会变化，
 * 页面无法感知「用户要我刷新」，所以用这个全局序号显式通知：
 * 序号变化 → 快照失效 → 页面重新请求。
 */

let version = 0

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): number {
  return version
}

/** 顶栏提交搜索时调用 */
export function bumpSearchSubmit(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

/** 页码 / 页面用它把序号放进依赖与缓存键 */
export function useSearchSubmitVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
