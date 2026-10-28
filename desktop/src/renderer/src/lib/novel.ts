import type { NovelDetail } from '@shared/types'

const PROGRESS_KEY = 'pixiv-novel-progress'
const SERIES_POSITION_KEY = 'pixiv-novel-series-position'
const READ_KEY = 'pixiv-novel-read'
const READER_KEY = 'pixiv-novel-reader'

/** 把 pixiv 正文按 [newpage] 切页；没有分页标记时整篇作为一页 */
export function splitNovelPages(content: string): string[] {
  const pages = String(content || '').split(/\[newpage\]/gi)
  return pages.length > 0 ? pages : ['']
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 正文渲染：
 * pixiv 的正文是带标记的纯文本，先把标记替换成占位符，
 * 再整体转义，最后把占位符换成本地生成的安全 HTML。
 * 这样用户写入的 HTML 不会被执行，ruby / 插图等标记又能正常显示。
 */
export function renderNovelPage(raw: string, embedded: Record<string, string>): string {
  const tokens: string[] = []
  const token = (html: string): string => {
    tokens.push(html)
    return `\u0000${tokens.length - 1}\u0000`
  }

  const imageHtml = (id: string): string => {
    const url = embedded[id] || embedded[id.split('-')[0]] || ''
    if (!url) return '<span class="novel-image-missing">［插图］</span>'
    return `<figure class="novel-image"><img src="${escapeHtml(
      url
    )}" alt="插图" loading="lazy" /></figure>`
  }

  let text = raw
  text = text.replace(
    /\[\[rb:([^\]>]+?)\s*>\s*([^\]]+?)\]\]/g,
    (_match, base: string, ruby: string) =>
      token(`<ruby>${escapeHtml(base)}<rt>${escapeHtml(ruby)}</rt></ruby>`)
  )
  text = text.replace(/\[chapter:([^\]]*)\]/gi, (_match, title: string) =>
    token(`<h3 class="novel-chapter">${escapeHtml(title)}</h3>`)
  )
  text = text.replace(/\[pixivimage:([^\]]+)\]/gi, (_match, id: string) =>
    token(imageHtml(id.trim()))
  )
  text = text.replace(/\[uploadedimage:([^\]]+)\]/gi, (_match, id: string) =>
    token(imageHtml(id.trim()))
  )
  text = text.replace(/\[jump:[^\]]+\]/gi, '')

  text = escapeHtml(text)
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] ?? '')
}

export interface ReaderSettings {
  fontSize: number
  /** 行高倍数 */
  lineHeight: number
  /** 正文最大宽度（px） */
  maxWidth: number
  theme: 'light' | 'sepia' | 'dark'
}

/** 阅读宽度的三档：窄 / 标准 / 宽 */
export const READER_WIDTHS = [640, 768, 896] as const

export const READER_DEFAULT: ReaderSettings = {
  fontSize: 18,
  lineHeight: 2,
  maxWidth: 768,
  theme: 'sepia'
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = window.localStorage.getItem(READER_KEY)
    if (!raw) return READER_DEFAULT
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>
    const theme =
      parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'sepia'
        ? parsed.theme
        : READER_DEFAULT.theme
    return {
      fontSize: Math.round(clamp(parsed.fontSize, 14, 26, READER_DEFAULT.fontSize)),
      // 行高按 0.1 取整，避免出现 1.9999999 这样的显示
      lineHeight: Math.round(clamp(parsed.lineHeight, 1.4, 2.6, READER_DEFAULT.lineHeight) * 10) / 10,
      maxWidth: READER_WIDTHS.includes(
        clamp(parsed.maxWidth, 640, 896, READER_DEFAULT.maxWidth) as (typeof READER_WIDTHS)[number]
      )
        ? clamp(parsed.maxWidth, 640, 896, READER_DEFAULT.maxWidth)
        : READER_DEFAULT.maxWidth,
      theme
    }
  } catch {
    return READER_DEFAULT
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    window.localStorage.setItem(READER_KEY, JSON.stringify(settings))
  } catch {
    // 本地存储不可用时静默降级
  }
}

export function loadReadingProgress(novelId: string): number {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY)
    if (!raw) return 0
    const map = JSON.parse(raw) as Record<string, number>
    const value = Number(map[novelId])
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  } catch {
    return 0
  }
}

export function saveReadingProgress(novelId: string, percent: number): void {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    map[novelId] = Math.max(0, Math.min(1, percent))
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
  } catch {
    // 忽略配额或解析失败
  }
}

/** 系列最近读到哪一话，用于「继续阅读」 */
export function saveSeriesPosition(seriesId: string, novelId: string): void {
  try {
    const raw = window.localStorage.getItem(SERIES_POSITION_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[seriesId] = novelId
    window.localStorage.setItem(SERIES_POSITION_KEY, JSON.stringify(map))
  } catch {
    // 忽略
  }
}

export function loadSeriesPosition(seriesId: string): string {
  try {
    const raw = window.localStorage.getItem(SERIES_POSITION_KEY)
    if (!raw) return ''
    const map = JSON.parse(raw) as Record<string, string>
    return map[seriesId] || ''
  } catch {
    return ''
  }
}

export function loadReadNovels(): Set<string> {
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    if (!raw) return new Set()
    const list = JSON.parse(raw) as string[]
    return new Set(Array.isArray(list) ? list : [])
  } catch {
    return new Set()
  }
}

export function markNovelRead(novelId: string): void {
  try {
    const list = Array.from(loadReadNovels())
    if (list.includes(novelId)) return
    list.push(novelId)
    // 只保留最近 2000 条，避免长期使用后无限增长
    window.localStorage.setItem(READ_KEY, JSON.stringify(list.slice(-2000)))
  } catch {
    // 忽略
  }
}

export function seriesIdOf(detail: NovelDetail | null): string {
  return detail?.series?.id || detail?.seriesId || ''
}

/** 阅读时间（秒）转「约 n 分钟」，不足一分钟按一分钟算 */
export function readingMinutes(seconds: number): number {
  return Math.max(1, Math.round(Number(seconds || 0) / 60))
}
