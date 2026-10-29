import type { AppConfig } from '@shared/types'

/** 收藏夹来源统一存到「收藏夹」目录，避免标签过滤条件改变目录结构 */
export function worksTag(config: Pick<AppConfig, 'source' | 'tag'>): string {
  return config.source === 'bookmarks' ? '收藏夹' : config.tag
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
