import * as React from 'react'
import { cn } from '@renderer/utils/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

export interface DialogShellProps {
  title: string
  description?: string
  icon?: React.ReactNode
  onClose: () => void
  /** 底部操作区，可选 */
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  /**
   * 是否响应 Esc 关闭，默认响应。
   * 上层弹窗里又开了一层弹窗时，先关掉上层的那次 Esc 应该只关内层。
   */
  closeOnEscape?: boolean
}

/**
 * 项目通用的弹窗骨架：图标 + 标题 + 说明 + 可滚动内容 + 底部操作区。
 *
 * 底座是 shadcn 的 Dialog（Radix），焦点陷阱、Esc 关闭、遮罩点击关闭、
 * 滚动锁定都由 Radix 负责；这里只固定各页面的排版，免得每个弹窗重复写一遍
 * DialogHeader / DialogContent / 关闭按钮。
 */
export function DialogShell(props: DialogShellProps): React.JSX.Element {
  const { title, description, icon, onClose, footer, children, className, closeOnEscape = true } =
    props

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (!closeOnEscape) event.preventDefault()
        }}
        className={cn(
          'flex max-h-[86vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-xl bg-card p-0 shadow-2xl sm:rounded-xl',
          className
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {icon}
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-xs leading-5">{description}</DialogDescription>
          ) : (
            // Radix 要求始终有一个 description 供读屏关联，没有文案时给个空节点
            <DialogDescription className="sr-only">{''}</DialogDescription>
          )}
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
