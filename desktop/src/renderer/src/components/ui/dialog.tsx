import { X } from 'lucide-react'
import { useEffect } from 'react'
import type * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'

interface DialogProps {
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

/** 通用弹窗外壳：遮罩 + 卡片 + 标题栏，支持 Esc 与点击遮罩关闭 */
export function Dialog(props: DialogProps): React.JSX.Element {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const { closeOnEscape = true } = props
  useEffect(() => {
    if (!closeOnEscape) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props, closeOnEscape])

  // 弹窗由调用方条件渲染（关掉就是直接卸载），所以只能做入场；退场没有宿主可等
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={props.onClose}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.15, ease: 'easeOut' }}
    >
      <motion.div
        className={cn(
          'flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
          props.className
        )}
        onClick={(event) => event.stopPropagation()}
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.18, ease: 'easeOut' }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {props.icon}
              {props.title}
            </h2>
            {props.description ? (
              <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={props.onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{props.children}</div>

        {props.footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
            {props.footer}
          </footer>
        ) : null}
      </motion.div>
    </motion.div>
  )
}
