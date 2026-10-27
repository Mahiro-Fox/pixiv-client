import path from 'node:path'
import { open, readdir, stat } from 'node:fs/promises'
import type { ImageQuality } from '../../shared/types'
import {
  DEFAULT_FILE_TEMPLATE,
  compileDownloadMatcher,
  renderFileName,
  type TemplateVars
} from '../../shared/template'

/** 常规图（master1200）会把长边限制在 1200px */
const REGULAR_LONG_SIDE = 1200

const INVALID_CHARS = /[\\/:*?"<>|\r\n\t]+/g

export function safeName(text: unknown, fallback = 'untitled'): string {
  const cleaned = String(text ?? '')
    .replace(INVALID_CHARS, '_')
    .replace(/^[.\s_]+/, '')
    .replace(/[.\s_]+$/, '')
  return cleaned.slice(0, 80) || fallback
}

export function extOf(url: string): string {
  try {
    return path.extname(new URL(url).pathname) || '.jpg'
  } catch {
    return '.jpg'
  }
}

export function buildAuthorDir(baseDir: string, userId: string, userName: string): string {
  const folder = `${(userId || '').trim() || 'unknown'}_${safeName(userName, 'artist')}`
  return path.join(baseDir, folder)
}

export interface DestContext {
  illustId: string
  title: string
  userId: string
  userName: string
  tag: string
  createDate?: string
  pageIndex: number
  url: string
  /** 指定扩展名（含点），动图转码时用于覆盖 URL 推断出的扩展名 */
  ext?: string
  /** 下载质量，模板里写了 {quality} 时据此区分常规图与原图 */
  quality?: ImageQuality
  /** 文件名模板，缺省用默认模板 */
  template?: string
}

/** 按配置的文件名模板生成落盘路径；非法字符与超长已由模板模块处理 */
export function buildDest(authorDir: string, context: DestContext): string {
  const vars: TemplateVars = {
    id: String(context.illustId || '').trim(),
    title: context.title,
    author: context.userName,
    userid: String(context.userId || '').trim(),
    tag: context.tag,
    page: context.pageIndex,
    date: context.createDate,
    quality: context.quality,
    ext: context.ext || extOf(context.url)
  }
  return path.join(authorDir, renderFileName(context.template || DEFAULT_FILE_TEMPLATE, vars))
}

export async function isComplete(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

export interface ImageSize {
  width: number
  height: number
}

/**
 * 按下载质量推算应有的像素尺寸。
 * 原图直接用接口返回的原始尺寸；常规图长边超过 1200 时按比例缩到 1200。
 * 尺寸未知（如旧快照、动图）返回 null，此时不做校验。
 */
export function expectedImageSize(
  width: number,
  height: number,
  quality: ImageQuality
): ImageSize | null {
  const w = Math.round(Number(width) || 0)
  const h = Math.round(Number(height) || 0)
  if (w <= 0 || h <= 0) return null
  if (quality === 'original') return { width: w, height: h }

  const longSide = Math.max(w, h)
  if (longSide <= REGULAR_LONG_SIDE) return { width: w, height: h }
  const ratio = REGULAR_LONG_SIDE / longSide
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) }
}

/** 只读取文件头，足够覆盖 JPEG 的 SOF 段 */
const HEADER_BYTES = 64 * 1024

/** 从文件头解析像素尺寸：支持 PNG / GIF / JPEG，其它格式返回 null */
function parseImageSize(buffer: Buffer): ImageSize | null {
  // PNG：IHDR 固定在第 16~24 字节
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  // GIF：逻辑屏幕宽高为小端序
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  // JPEG：逐段扫描，找到 SOFn 后读宽高
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      // 无长度字段的标记
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = buffer.readUInt16BE(offset + 2)
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      if (length < 2) return null
      offset += 2 + length
    }
  }
  return null
}

/** 读取本地图片的实际像素尺寸；无法解析（例如 zip）返回 null */
export async function probeImageSize(filePath: string): Promise<ImageSize | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size <= 0) return null
    handle = await open(filePath, 'r')
    const size = Math.min(HEADER_BYTES, info.size)
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, 0)
    return parseImageSize(buffer)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** 允许 1~2px 的缩放取整误差 */
export function sizeMatches(actual: ImageSize, expected: ImageSize): boolean {
  return Math.abs(actual.width - expected.width) <= 2 && Math.abs(actual.height - expected.height) <= 2
}

/**
 * 本地文件是否满足指定下载质量。
 * 只对「高清原图」做尺寸校验：已有常规图（长边 1200）需要重新下载覆盖。
 * 请求常规图时任何成品都算满足，避免把已有的原图降级覆盖成小图。
 */
export async function satisfiesQuality(
  filePath: string,
  width: number,
  height: number,
  quality: ImageQuality
): Promise<boolean> {
  if (quality !== 'original') return true
  const expected = expectedImageSize(width, height, quality)
  if (!expected) return true
  const actual = await probeImageSize(filePath)
  if (!actual) return true
  return sizeMatches(actual, expected)
}

/**
 * 严格判断哪些作品已经完整下载。
 * 按当前模板（外加默认模板，兼容历史文件）解析文件名里的作品 ID 与页码，
 * 只有覆盖了 pageCount 的每一页（0 ~ pageCount-1）才算已下载。
 * 选择高清原图时还会校验首张图片的像素尺寸，避免把常规图误判为原图。
 */
export async function findDownloadedIds(
  rootDir: string,
  works: { id: string; pageCount?: number; width?: number; height?: number }[],
  template = DEFAULT_FILE_TEMPLATE,
  quality: ImageQuality = 'regular'
): Promise<string[]> {
  const wanted = new Map<string, { pageCount: number; width: number; height: number }>()
  works.forEach((work) => {
    const id = String(work.id || '').trim()
    if (!id) return
    wanted.set(id, {
      pageCount: Math.max(0, Number(work.pageCount || 0)),
      width: Number(work.width || 0),
      height: Number(work.height || 0)
    })
  })
  if (wanted.size === 0) return []

  const matchers = [compileDownloadMatcher(template), compileDownloadMatcher(DEFAULT_FILE_TEMPLATE)]
    .filter((matcher): matcher is NonNullable<typeof matcher> => Boolean(matcher))
    .filter((matcher, index, list) => list.findIndex((it) => it.re.source === matcher.re.source) === index)

  let authors
  try {
    authors = await readdir(rootDir, { withFileTypes: true })
  } catch {
    return []
  }

  // id -> 已下载的分页序号集合
  const pagesById = new Map<string, Set<number>>()
  // 首页文件路径（模板带 {quality} 时会有多份：常规图与原图各自一份）
  const coversById = new Map<string, string[]>()
  for (const author of authors) {
    if (!author.isDirectory()) continue
    let files: string[]
    try {
      files = await readdir(path.join(rootDir, author.name))
    } catch {
      continue
    }
    for (const file of files) {
      // .part 是尚未完成的临时文件，不算已下载
      if (file.endsWith('.part')) continue

      for (const matcher of matchers) {
        const match = matcher.re.exec(file)
        if (!match) continue
        const id = match[matcher.idGroup]
        if (!id || !wanted.has(id)) break
        const page = Number(match[matcher.pageGroup]) - matcher.pageOffset
        if (!Number.isFinite(page) || page < 0) break
        const pages = pagesById.get(id) ?? new Set<number>()
        pages.add(page)
        pagesById.set(id, pages)
        if (page === 0) {
          const covers = coversById.get(id) ?? []
          covers.push(path.join(rootDir, author.name, file))
          coversById.set(id, covers)
        }
        break
      }
    }
  }

  const candidates: string[] = []
  pagesById.forEach((pages, id) => {
    const expected = wanted.get(id)?.pageCount ?? 0
    // 页数未知时退化为「存在任意一张成品图」
    if (expected <= 0) {
      candidates.push(id)
      return
    }
    for (let index = 0; index < expected; index += 1) {
      if (!pages.has(index)) return
    }
    candidates.push(id)
  })

  if (quality !== 'original') return candidates

  // 选择原图时逐作品校验首页文件尺寸：常规图（长边 1200）按未下载处理。
  // 模板里写了 {quality} 时同一页会同时有常规图与原图，任意一份达标即可。
  const verified = await Promise.all(
    candidates.map(async (id) => {
      const covers = coversById.get(id)
      const meta = wanted.get(id)
      if (!covers || covers.length === 0 || !meta) return id
      const checks = await Promise.all(
        covers.map((cover) => satisfiesQuality(cover, meta.width, meta.height, quality))
      )
      return checks.some(Boolean) ? id : ''
    })
  )
  return verified.filter(Boolean)
}
