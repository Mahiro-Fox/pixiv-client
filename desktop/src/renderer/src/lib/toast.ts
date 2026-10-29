import { useSyncExternalStore } from 'react'

/**
 * 极简全局轻提示。
 *
 * 右键菜单里的动作（复制、加入下载、屏蔽作者）都是「点完就结束」的，
 * 没有页面级状态可以承载反馈；又因为菜单组件在卡片内部、拿不到 App 的
 * 错误条，所以用一个模块级的订阅式 store，由根部的 `<Toaster />` 统一渲染。
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

function show(message: string, kind: ToastKind): number {
  const text = String(message || '').trim()
  if (!text) return 0
  const id = nextId
  nextId += 1
  items = [...items, { id, message: text, kind }]
  notify()
  // 错误多留一会儿，方便看清原因
  window.setTimeout(() => dismissToast(id), kind === 'error' ? 4200 : 2200)
  return id
}

export function dismissToast(id: number): void {
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return
  items = next
  notify()
}

export const toast = {
  info: (message: string): number => show(message, 'info'),
  success: (message: string): number => show(message, 'success'),
  error: (message: string): number => show(message, 'error')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 供 `<Toaster />` 订阅当前提示栈；items 只在变化时换引用，可安全用于 useSyncExternalStore */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => items
  )
}
