import { useEffect, useState, useSyncExternalStore } from 'react'
import type * as React from 'react'
import { useLocation } from 'react-router-dom'
import type { ImageQuality, PixivWork, SearchWork, UserWorkThumb } from '@shared/types'
import { WorkDetailDialog } from '@renderer/components/shared/WorkDetailDialog'
import { toPixivWork } from '@renderer/utils/work'

/**
 * 全站共用的预览状态。
 * 用模块级单例而不是 Context：卡片在搜索、排行、推荐、关注等十来个地方复用，
 * 直接 import openPreview 就能打开，不必再一层层传 props；挂载点只在 App 根上有一份。
 */
let current: PixivWork | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((run) => run())
}

function subscribe(run: () => void): () => void {
  listeners.add(run)
  return () => {
    listeners.delete(run)
  }
}

function snapshot(): PixivWork | null {
  return current
}

/** 点击作品 / 用户卡缩略图时调用：先显示缩略图，必要时再补全详情 */
export function openPreview(work: SearchWork | UserWorkThumb): void {
  current = toPixivWork(work)
  emit()
  // 用户列表的四图只带 id 与缩略图：先显示缩略图，再按 id 补全标题 / 作者
  if ('thumbnail' in work) return
  void window.pixiv
    .getWorkDetail(work.id)
    .then((detail) => {
      if (!detail || !current || current.id !== detail.id) return
      current = toPixivWork(detail)
      emit()
    })
    .catch(() => undefined)
}

export function closePreview(): void {
  if (!current) return
  current = null
  emit()
}

/**
 * 全局唯一的预览弹窗，挂在 App 根上。
 * 路由变化时自动关闭：预览属于当前列表页的临时浮层，不该跟着用户切页。
 */
export function WorkPreviewHost(): React.JSX.Element | null {
  const work = useSyncExternalStore(subscribe, snapshot)
  const [quality, setQuality] = useState<ImageQuality>('regular')
  const location = useLocation()

  useEffect(() => {
    void window.pixiv
      .getConfig()
      .then((config) => setQuality(config.imageQuality))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    closePreview()
  }, [location.pathname])

  if (!work) return null
  return (
    <WorkDetailDialog
      work={work}
      quality={quality}
      selected={false}
      showSelection={false}
      onToggle={() => undefined}
      onClose={closePreview}
    />
  )
}
