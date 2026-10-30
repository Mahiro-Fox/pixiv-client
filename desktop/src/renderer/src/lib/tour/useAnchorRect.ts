import { useEffect, useState } from 'react'

/**
 * 跟踪某个 `data-tour` 锚点在视口里的位置。
 *
 * 只做三件事，够用就好：命中元素就取 `getBoundingClientRect`，
 * 滚动 / 缩放 / 布局变化后重算，取不到就返回 null（调用方降级为居中气泡）。
 *
 * 为什么还要 300ms 轮询：锚点可能随路由切换、数据加载、弹窗关闭才出现，
 * 这些时机没有统一的事件可监听；一次 `querySelector + getBoundingClientRect`
 * 的开销极小，且只在引导运行期间存在。
 */
export function useAnchorRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }

    let frame = 0
    let last = ''
    let alive = true

    const measure = (): void => {
      frame = 0
      if (!alive) return
      const node = document.querySelector(selector)
      const next = node ? node.getBoundingClientRect() : null
      // 仅位置/尺寸变了才 setState，否则每帧都会触发一次重渲染
      const key = next
        ? `${Math.round(next.left)}|${Math.round(next.top)}|${Math.round(next.width)}|${Math.round(next.height)}`
        : ''
      if (key === last) return
      last = key
      setRect(next)
    }

    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const timer = window.setInterval(measure, 300)

    return () => {
      alive = false
      if (frame) window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [selector])

  return rect
}

/** 视口尺寸：遮罩按它铺满，气泡也按它夹在安全区内 */
export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))

  useEffect(() => {
    const onResize = (): void =>
      setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}
