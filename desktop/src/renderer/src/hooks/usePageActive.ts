import { useKeepAliveContext } from 'keepalive-for-react'

/**
 * 当前页面是否处于「激活」状态。
 *
 * keep-alive 缓存起来的页面在后台并没有卸载，`useSearchParams()` 等 hook 读到的仍是
 * **全局当前位置**。于是用户进详情页时，后台页面的 `word` / `page` 等参数会被算成空值，
 * effect 因此重新执行——返回时参数又变回来，于是又跑一遍，表现为「重新请求数据」。
 *
 * 页面用这个 hook 在 effect 里提前返回，忽略后台期间的参数抖动；
 * 不在 KeepAlive 内部时（context 默认 cacheKey 为空）一律视为激活，避免普通页面失效。
 */
export function usePageActive(): boolean {
  const context = useKeepAliveContext()
  return context.cacheKey ? context.active : true
}
