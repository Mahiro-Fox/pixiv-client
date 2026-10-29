import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { ImageQuality, PixivWork, SearchWork, UserWorkThumb } from '@shared/types'
import { WorkDetailDialog } from '@renderer/components/WorkDetailDialog'

/** 预览弹窗的默认质量只取一次全局设置，多个页面共用 */
let qualityCache: ImageQuality | null = null

/** SearchWork / 用户列表的缩略图都能转成详情弹窗需要的 PixivWork */
export function toPixivWork(work: SearchWork | UserWorkThumb): PixivWork {
  if ('thumbnail' in work) {
    return {
      id: work.id,
      title: work.title,
      userId: work.userId,
      userName: work.userName,
      url: work.thumbnail,
      pageCount: work.pageCount,
      width: work.width,
      height: work.height,
      xRestrict: work.xRestrict,
      illustType: work.illustType,
      tags: work.tags,
      createDate: work.createDate,
      aiType: work.aiType,
      series: work.series
    }
  }
  return {
    id: work.id,
    title: `ID ${work.id}`,
    userId: '',
    userName: '',
    url: work.url,
    pageCount: 1,
    width: 0,
    height: 0
  }
}

/**
 * 搜索结果 / 用户列表的图片预览：点击缩略图打开应用内作品详情弹窗，
 * 与下载工作台里点作品卡的行为保持一致。
 */
export function useWorkPreview(): {
  openPreview: (work: SearchWork | UserWorkThumb) => void
  previewNode: React.JSX.Element | null
} {
  const [preview, setPreview] = useState<PixivWork | null>(null)
  const [quality, setQuality] = useState<ImageQuality>(qualityCache || 'regular')

  useEffect(() => {
    if (qualityCache) return
    let alive = true
    void window.pixiv
      .getConfig()
      .then((config) => {
        qualityCache = config.imageQuality
        if (alive) setQuality(config.imageQuality)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const openPreview = (work: SearchWork | UserWorkThumb): void => {
    setPreview(toPixivWork(work))
    // 用户列表的四图只带 id 与缩略图：先显示缩略图，再按 id 补全标题 / 作者
    if ('thumbnail' in work) return
    void window.pixiv
      .getWorkDetail(work.id)
      .then((detail) => {
        if (!detail) return
        setPreview((current) =>
          current && current.id === detail.id ? toPixivWork(detail) : current
        )
      })
      .catch(() => undefined)
  }

  const previewNode = preview ? (
    <WorkDetailDialog
      work={preview}
      quality={quality}
      selected={false}
      showSelection={false}
      onToggle={() => undefined}
      onClose={() => setPreview(null)}
    />
  ) : null

  return { openPreview, previewNode }
}
