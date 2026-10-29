import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  /** 右侧灰色说明（如作品 ID / 作者名） */
  hint?: string
  disabled?: boolean
  /** 危险操作（屏蔽作者等），文字用警示色 */
  danger?: boolean
  /** 在本项上方画一条分隔线，用于分组 */
  divider?: boolean
  onSelect: () => void
}

export interface ContextMenuProps {
  /** 鼠标位置（clientX / clientY） */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** 与视口边缘留出的间距，避免菜单贴边被裁 */
const EDGE = 8

/**
 * 右键菜单。
 *
 * 渲染到 body 的 portal 里：卡片本身带 `overflow-hidden`（缩略图圆角），
 * 就地渲染会被裁掉一半；固定定位也让它不受滚动容器影响。
 *
 * 打开后立刻测量真实尺寸再收敛进视口，右下角右击时不会跑出屏幕。
 * 关闭时机覆盖「点了别处 / Esc / 滚动 / 窗口失焦 / 缩放」，与系统菜单一致。
 */
export function ContextMenu(props: ContextMenuProps): React.JSX.Element {
  const { x, y, items, onClose } = props
  const box = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [ready, setReady] = useState(false)

  // 先按点击位置渲染（不可见），量到高度后再夹进视口，避免看到「先出现在外面再跳回来」
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    const { width, height } = node.getBoundingClientRect()
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE))
    })
    setReady(true)
  }, [x, y])

  useEffect(() => {
    // pointerdown 用捕获阶段：卡片 / 弹窗里可能有 stopPropagation 的处理
    const onPointerDown = (event: PointerEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    // 滚动与缩放会让菜单位置与内容错位，直接关掉比跟着飘更符合直觉
    const onViewportChange = (): void => onClose()

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('blur', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('blur', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [onClose])

  // 打开后把焦点放到第一项，方向键才有的可选
  useEffect(() => {
    const first = box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus({ preventScroll: true })
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const index = buttons.findIndex((button) => button === document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = index < 0 ? 0 : (index + step + buttons.length) % buttons.length
    buttons[next]?.focus({ preventScroll: true })
  }

  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-orientation="vertical"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      style={{ left: pos.left, top: pos.top, visibility: ready ? 'visible' : 'hidden' }}
      className="fixed z-[70] min-w-48 max-w-64 overflow-hidden rounded-lg border border-border/70 bg-popover p-1 text-xs shadow-xl"
    >
      {items.map((item) => (
        <div key={item.key}>
          {item.divider ? <div aria-hidden className="my-1 h-px bg-border/60" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              // 先关菜单再执行：动作里可能弹窗 / 跳转，菜单留着会盖住新内容
              onClose()
              item.onSelect()
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-foreground/85 hover:bg-secondary/60'
            }`}
          >
            {item.icon ? (
              <span
                className={`shrink-0 ${item.danger ? '' : 'text-muted-foreground'}`}
                aria-hidden
              >
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/80">{item.hint}</span>
            ) : null}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
