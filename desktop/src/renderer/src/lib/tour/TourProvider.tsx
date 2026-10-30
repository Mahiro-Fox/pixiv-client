import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TourOverlay } from '@renderer/components/tour/TourOverlay'
import { hasSeenTour, markTourSeen, TOUR_STEPS, type TourAction } from './steps'
import { useAnchorRect } from './useAnchorRect'

/**
 * 顶栏「重新观看」按钮的入口。
 *
 * 用模块级回调而不是 Context：引导的挂载点在 App 的最外层，
 * 而按钮在顶栏深处，为了一个 `start()` 把整棵树再包一层 Provider 不划算。
 * 组件卸载后回调置空，调用变成空操作。
 */
let requestStart: (() => void) | null = null

export function startTour(): void {
  requestStart?.()
}

/** 首次启动后等这么久再弹：给首屏数据与卡片留出渲染时间，否则高亮会落在骨架上 */
const AUTO_START_DELAY = 1200

/**
 * 产品漫游引导。
 *
 * 启动时就读 localStorage 标记：没看过就自动开始，看过就什么都不做。
 * 完成 / 跳过 / Esc 都会写入标记——只认「看过没有」，不区分是怎么结束的，
 * 否则用户按 Esc 关掉后每次启动都会再被弹一次。
 */
export function TourProvider(props: {
  blocked: boolean
  /**
   * 步骤附带的动作（目前只有「填示例作者并抓一页」）。
   * App 每次渲染都会传一个新的箭头函数，所以存进 ref，不让 effect 跟着重跑。
   */
  onAction?: (action: TourAction) => void
}): React.JSX.Element | null {
  const navigate = useNavigate()
  const location = useLocation()

  const [running, setRunning] = useState(false)
  const [index, setIndex] = useState(0)
  /** 交互步骤：用户确实右键了卡片 */
  const [armed, setArmed] = useState(false)
  /** 本次进程内是否已经启动过一次，防止结束之后又被自动拉起 */
  const started = useRef(false)
  const [autoStart] = useState(() => !hasSeenTour())

  const onAction = useRef(props.onAction)
  onAction.current = props.onAction
  /** 上一次已经执行过动作的步骤序号：弹窗开关会让 active 翻转，避免同一动作重复跑 */
  const actedFor = useRef(-1)

  const step = TOUR_STEPS[index]
  /**
   * 「正在显示」= 引导在跑且没有别的弹窗占着屏幕。
   * 弹窗打开时遮罩要让位（z-75 会盖住 z-50 的弹窗），键盘与右键监听也一并停掉，
   * 否则用户在设置里按 Esc 会把引导一起关掉。
   */
  const active = running && !props.blocked
  const primary = active && step?.anchor ? `[data-tour="${step.anchor}"]` : null
  const primaryRect = useAnchorRect(primary)
  // 主锚点不存在时的替补（工作台没抓过作品时没有工具栏，就高亮整个作品区）
  const spare =
    active && !primaryRect && step?.fallback ? `[data-tour="${step.fallback}"]` : null
  const spareRect = useAnchorRect(spare)
  const rect = primaryRect ?? spareRect
  // 右键菜单是 portal 到 body 的独立节点，只能等它出现后再量
  const menuRect = useAnchorRect(active && armed ? '[data-tour-menu]' : null)

  const start = useRef((): void => undefined)
  start.current = () => {
    started.current = true
    actedFor.current = -1
    setIndex(0)
    setArmed(false)
    setRunning(true)
  }

  useEffect(() => {
    requestStart = () => start.current()
    return () => {
      requestStart = null
    }
  }, [])

  // 首轮自动开始：有别的弹窗开着（设置 / 过滤 / 更新）时先等一等，
  // 两个都是「一进应用就出现」的东西，叠在一起谁都看不清。
  useEffect(() => {
    if (!autoStart || started.current || running || props.blocked) return
    const timer = window.setTimeout(() => start.current(), AUTO_START_DELAY)
    return () => window.clearTimeout(timer)
  }, [autoStart, running, props.blocked])

  const finish = (): void => {
    markTourSeen()
    actedFor.current = -1
    setRunning(false)
    setArmed(false)
    setIndex(0)
  }

  const next = (): void => {
    setArmed(false)
    if (index >= TOUR_STEPS.length - 1) finish()
    else setIndex(index + 1)
  }

  const prev = (): void => {
    if (index === 0) return
    setArmed(false)
    setIndex(index - 1)
  }

  // 步骤自带路由就切过去。往前翻、往后翻都走这条：
  // 从第 5 步（工作台）退回第 4 步（推荐页的作品卡）时，不切回去锚点就找不到
  useEffect(() => {
    if (!active) return
    const current = TOUR_STEPS[index]
    if (current?.route && location.pathname !== current.route) navigate(current.route)
  }, [active, index, location.pathname, navigate])

  // 进入新的一步：清掉上一步的「已右键」，并执行步骤附带的动作。
  // 只挂在 index 上——挂在 pathname 上会在路由刚切完时重复执行一遍动作。
  useEffect(() => {
    if (!active) return
    setArmed(false)
    const current = TOUR_STEPS[index]
    if (current?.action && actedFor.current !== index) {
      actedFor.current = index
      onAction.current?.(current.action)
    }
  }, [active, index])

  // 锚点出现后滚动到可见区域。
  // 路由刚切完元素还没挂载，数据也可能还在路上，所以找不到就短轮询几次，
  // 不能只试一次——推荐页的卡片、工作台的工具栏都是异步出现的。
  useEffect(() => {
    if (!active) return
    const current = TOUR_STEPS[index]
    if (!current?.anchor) return

    let tries = 0
    let timer = 0
    const poke = (): void => {
      const node = document.querySelector(`[data-tour="${current.anchor}"]`)
      if (node) {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        return
      }
      if (++tries >= 12) return
      timer = window.setTimeout(poke, 200)
    }
    timer = window.setTimeout(poke, 160)
    return () => window.clearTimeout(timer)
  }, [active, index])

  // 交互步骤：真等用户右键。只认作品卡上的右键，点别处不算。
  // 必须用捕获阶段：卡片的 onContextMenu 里做了 stopPropagation，
  // 冒泡阶段的监听永远收不到这个事件。
  useEffect(() => {
    if (!active || !step?.interactive) return
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target as Element | null
      if (!target || typeof target.closest !== 'function') return
      if (target.closest('[data-tour="work-card"]')) setArmed(true)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [active, step?.interactive])

  // 键盘：Esc 退出、←/→ 翻页、Enter 下一步。
  // 挂在冒泡阶段（不是捕获）：右键菜单的 Esc 在 document 捕获阶段 stopPropagation，
  // 这样按 Esc 只会关菜单，不会把引导一起关掉。
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        Boolean(target) &&
        (target!.tagName === 'INPUT' ||
          target!.tagName === 'TEXTAREA' ||
          target!.isContentEditable)

      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
        return
      }
      // 正在搜索框里打字时，方向键 / 回车归输入框
      if (typing) return
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!active || !step) return null

  return (
    <TourOverlay
      step={step}
      index={index}
      total={TOUR_STEPS.length}
      rect={rect}
      menuRect={menuRect}
      armed={armed}
      onNext={next}
      onPrev={prev}
      onClose={finish}
    />
  )
}
