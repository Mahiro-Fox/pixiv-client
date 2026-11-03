import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { createElement } from 'react'
import { toast as sonner } from 'sonner'

/**
 * 全局轻提示：对 sonner（`components/ui/sonner.tsx` 的 `<Toaster />`）的一层薄封装。
 *
 * 项目里的调用点大多是「右键菜单点完给个反馈」这类一句话提示，
 * 直接用 `toast.success(message)` 比 `toast({ title, description })` 更省事，
 * 所以这里保留动词式 API，再映射到 sonner 的等级上，调用方不必关心底层实现。
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** 追加一个操作按钮，例如保存成功后的「打开目录」 */
  action?: ToastAction
}

/** 图标与语气沿用旧实现，统一提示条后仍保留颜色区分 */
const ICON = {
  info: { icon: Info, className: 'h-4 w-4' },
  success: { icon: CheckCircle2, className: 'h-4 w-4 text-emerald-500' },
  error: { icon: AlertCircle, className: 'h-4 w-4 text-destructive' }
} as const

/** 错误多留一会儿，方便看清原因；带操作按钮的多给一点反应时间 */
const DURATION: Record<ToastKind, number> = { info: 2200, success: 2200, error: 4200 }

function show(message: string, kind: ToastKind, options?: ToastOptions): string | number {
  const text = String(message ?? '').trim()
  if (!text) return 0
  const { icon, className } = ICON[kind]
  const action = options?.action
  return sonner(text, {
    icon: createElement(icon, { className }),
    duration: action ? Math.max(DURATION[kind], 5000) : DURATION[kind],
    action: action ? { label: action.label, onClick: action.onClick } : undefined
  })
}

export const toast = {
  info: (message: string, options?: ToastOptions): string | number => show(message, 'info', options),
  success: (message: string, options?: ToastOptions): string | number =>
    show(message, 'success', options),
  error: (message: string, options?: ToastOptions): string | number =>
    show(message, 'error', options)
}
