import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@renderer/i18n'
import { useViewportSize } from '@renderer/lib/tour/useAnchorRect'
import type { TourStep } from '@renderer/lib/tour/steps'
import { Button } from '../ui/button'

/** 高亮框在锚点外扩的像素：让描边不贴着元素边缘，也不切断阴影 */
const PAD = 6
/** 气泡与锚点之间的间距 */
const GAP = 14
/** 气泡与视口边缘的最小留白 */
const EDGE = 12
const BUBBLE_MAX = 320

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function expand(rect: DOMRect): Box {
  return {
    left: rect.left - PAD,
    top: rect.top - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * 气泡落点。
 *
 * 优先级：锚点很高（左栏面板）时优先放左右两侧，否则按下方 / 上方空间选一边，
 * 水平居中于锚点。所有分支最后都夹进视口，小窗口下也不会跑到屏幕外。
 */
function placeBubble(
  rect: DOMRect | null,
  view: { width: number; height: number },
  bubble: { width: number; height: number }
): { left: number; top: number } {
  if (!rect) {
    return {
      left: Math.max(EDGE, (view.width - bubble.width) / 2),
      top: Math.max(EDGE, (view.height - bubble.height) / 2)
    }
  }

  const spaceRight = view.width - rect.right
  const spaceLeft = rect.left
  const tall = rect.height > 220

  // 又高又宽的锚点（整块作品区，第 6 步的降级目标就是它）：
  // 放左右都会贴到屏幕边缘，看着像「没动」，改放它自己的右上角内侧
  if (tall && rect.width >= view.width * 0.45) {
    return {
      left: clamp(
        rect.left + rect.width - bubble.width - GAP,
        EDGE,
        view.width - bubble.width - EDGE
      ),
      top: clamp(rect.top + GAP, EDGE, view.height - bubble.height - EDGE)
    }
  }

  if (tall && spaceRight >= bubble.width + GAP) {
    return {
      left: rect.right + GAP,
      top: clamp(rect.top, EDGE, view.height - bubble.height - EDGE)
    }
  }
  if (tall && spaceLeft >= bubble.width + GAP) {
    return {
      left: rect.left - GAP - bubble.width,
      top: clamp(rect.top, EDGE, view.height - bubble.height - EDGE)
    }
  }

  const spaceBelow = view.height - rect.bottom
  const below = spaceBelow >= bubble.height + GAP || spaceBelow >= rect.top
  const top = below ? rect.bottom + GAP : rect.top - GAP - bubble.height
  const left = rect.left + rect.width / 2 - bubble.width / 2

  return {
    left: clamp(left, EDGE, view.width - bubble.width - EDGE),
    top: clamp(top, EDGE, view.height - bubble.height - EDGE)
  }
}

interface TourOverlayProps {
  step: TourStep
  index: number
  total: number
  /** 当前步骤的锚点位置；为 null 时气泡居中 */
  rect: DOMRect | null
  /** 交互步骤里右键菜单的位置，一起挖洞，菜单才不会被压暗 */
  menuRect: DOMRect | null
  armed: boolean
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * 引导遮罩 + 气泡。
 *
 * 遮罩用一张铺满视口的 SVG：白色矩形铺满、黑色圆角矩形挖洞，
 * 再拿它当 mask 盖在暗色蒙层上——比「四块遮罩拼一个洞」简单，
 * 而且天然支持同时挖两个洞（卡片 + 右键菜单）。
 *
 * 整层 `pointer-events-none`：引导期间界面照常可点。这既是「真交互」那一步
 * （要用户自己去右键卡片）的前提，也避免了把用户锁在遮罩里出不来。
 */
export function TourOverlay(props: TourOverlayProps): React.JSX.Element {
  const { t } = useI18n()
  const view = useViewportSize()
  const { step, rect, menuRect, armed } = props

  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [bubbleHeight, setBubbleHeight] = useState(200)

  // 文案换行数量不固定，量到真实高度再夹位置，避免长文案顶出视口
  useEffect(() => {
    const node = bubbleRef.current
    if (!node) return
    const update = (): void => setBubbleHeight(node.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [props.index, armed])

  const bubbleWidth = Math.min(BUBBLE_MAX, view.width - EDGE * 2)
  const pos = placeBubble(rect, view, { width: bubbleWidth, height: bubbleHeight })

  const holes: Box[] = []
  if (rect) holes.push(expand(rect))
  if (armed && menuRect) holes.push(expand(menuRect))

  const last = props.index >= props.total - 1

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75]">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask
            id="pixiv-tour-mask"
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={view.width}
            height={view.height}
          >
            <rect x={0} y={0} width={view.width} height={view.height} fill="white" />
            {holes.map((hole, index) => (
              <rect
                key={index}
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx={12}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={view.width}
          height={view.height}
          fill="rgba(6, 8, 12, 0.6)"
          mask="url(#pixiv-tour-mask)"
        />
      </svg>

      {holes.map((hole, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            left: hole.left,
            top: hole.top,
            width: hole.width,
            height: hole.height,
            transition: 'left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease'
          }}
          className="absolute rounded-xl ring-2 ring-primary"
        />
      ))}

      <div
        ref={bubbleRef}
        role="dialog"
        aria-labelledby="pixiv-tour-title"
        aria-live="polite"
        style={{ left: pos.left, top: pos.top, width: bubbleWidth }}
        className="pointer-events-auto absolute rounded-xl border border-border/70 bg-popover p-4 text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium tabular-nums text-primary">
            {t('tour.progress', { current: props.index + 1, total: props.total })}
          </span>
          <button
            type="button"
            onClick={props.onClose}
            title={t('tour.close')}
            aria-label={t('tour.close')}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <h3 id="pixiv-tour-title" className="mt-1 text-sm font-semibold">
          {t(step.titleKey)}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(step.bodyKey)}</p>

        {armed && step.doneKey ? (
          <p className="mt-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px] leading-5 text-foreground">
            {t(step.doneKey)}
          </p>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('tour.skip')}
          </button>
          <div className="flex items-center gap-1.5">
            {props.index > 0 ? (
              <Button variant="ghost" size="sm" onClick={props.onPrev}>
                {t('tour.prev')}
              </Button>
            ) : null}
            <Button size="sm" onClick={props.onNext}>
              {last ? t('tour.done') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
