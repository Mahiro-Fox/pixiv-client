import type { AppConfig } from '@shared/types'

/**
 * 下载任务携带的标签：只用于文件名模板里的 {tag} 与任务/历史里的分类，
 * 不再决定目录结构（目录固定为 `{作者ID}_{作者名}/{illustration|manga|novel}`）。
 * 收藏栏统一记为「收藏夹」，免得文件名里出现收藏夹标签。
 */
export function worksTag(config: Pick<AppConfig, 'contentKind' | 'tag'>): string {
  return config.contentKind === 'bookmarks' ? '收藏夹' : config.tag
}

/** 把本地绝对路径转成主进程注册的 pixivfile 协议地址，供渲染层直接加载图片 */
export function toLocalUrl(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  return `pixivfile://local/?path=${encodeURIComponent(normalized)}`
}

/** 取文件所在目录（兼容 Windows 与 POSIX 分隔符） */
export function dirOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  return index >= 0 ? filePath.slice(0, index) : ''
}

/** 字节数格式化：1.2 MB / 340 KB */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}
