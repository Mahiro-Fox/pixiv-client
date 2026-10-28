import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  NovelLibraryItem,
  NovelLibraryResult,
  NovelTextHit,
  NovelTextSearchResult
} from '../../shared/types'

/** 小说统一放在保存目录下的这个子目录，和插画分开管理 */
export const NOVEL_DIR_NAME = '小说'

const META_SUFFIX = '.meta.json'
const MAX_SCAN_DEPTH = 3
const MAX_READ_BYTES = 40 * 1024 * 1024
const MAX_HITS = 80
const SNIPPETS_PER_FILE = 3
const SNIPPET_RADIUS = 40

interface NovelMeta {
  title?: string
  author?: string
  kind?: 'novel' | 'series'
  novelId?: string
  seriesId?: string
  episodes?: number
  characters?: number
  cover?: string
  tags?: string[]
}

interface CacheEntry {
  mtimeMs: number
  size: number
  text: string
}

/** 已读取的正文缓存：按 mtime + size 失效，避免重复检索时反复读盘 */
const textCache = new Map<string, CacheEntry>()

export function novelLibraryRoot(outDir: string): string {
  return path.join(outDir, NOVEL_DIR_NAME)
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** 目录名与文件名统一按 Windows 规则清洗，防止拼接出越界路径 */
export function assertNovelFile(root: string, filePath: string): string {
  const resolved = path.resolve(filePath)
  if (!isInside(root, resolved)) throw new Error('非法的小说文件路径')
  if (!resolved.toLowerCase().endsWith('.txt')) throw new Error('只能读取 TXT 文件')
  return resolved
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, depth + 1, out)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
      out.push(full)
    }
  }
}

async function readMeta(txtPath: string): Promise<NovelMeta | null> {
  try {
    const raw = await readFile(`${txtPath}${META_SUFFIX}`, 'utf-8')
    const parsed = JSON.parse(raw) as NovelMeta
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 文件名形如「标题_12345.txt」，去掉末尾 ID 作为回退标题 */
function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.txt$/i, '')
  const stripped = base.replace(/_\d+$/, '')
  return stripped || base
}

export async function scanNovelLibrary(
  outDir: string,
  force = false
): Promise<NovelLibraryResult> {
  const root = novelLibraryRoot(outDir)
  const files: string[] = []
  await walk(root, 1, files)

  const items = await Promise.all(
    files.map(async (file): Promise<NovelLibraryItem | null> => {
      try {
        const info = await stat(file)
        if (info.size > MAX_READ_BYTES) return null
        const meta = await readMeta(file)
        const fileName = path.basename(file)
        const authorFolder = path.basename(path.dirname(file))
        if (force) textCache.delete(file)
        return {
          path: file,
          fileName,
          title: meta?.title || titleFromFileName(fileName),
          author: meta?.author || authorFolder || '未知作者',
          size: info.size,
          updatedAt: info.mtime.toISOString(),
          characters: Number(meta?.characters || 0),
          episodes: Number(meta?.episodes || 1),
          kind: meta?.kind === 'series' ? 'series' : 'novel',
          novelId: meta?.novelId,
          seriesId: meta?.seriesId,
          cover: meta?.cover || '',
          tags: Array.isArray(meta?.tags) ? meta.tags : []
        }
      } catch {
        return null
      }
    })
  )

  return {
    root,
    items: items
      .filter((item): item is NovelLibraryItem => Boolean(item))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }
}

async function loadText(file: string): Promise<string | null> {
  try {
    const info = await stat(file)
    if (info.size > MAX_READ_BYTES) return null
    const cached = textCache.get(file)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.text
    }
    const raw = await readFile(file, 'utf-8')
    const text = raw.replace(/^\ufeff/, '')
    textCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, text })
    return text
  } catch {
    return null
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function snippetsOf(text: string, keyword: string): { matches: number; snippets: string[] } {
  const pattern = new RegExp(escapeRegExp(keyword), 'gi')
  const snippets: string[] = []
  let matches = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // 空匹配会导致 lastIndex 不前进，手动跳过
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }
    matches += 1
    if (snippets.length < SNIPPETS_PER_FILE) {
      const start = Math.max(0, match.index - SNIPPET_RADIUS)
      const end = Math.min(text.length, match.index + keyword.length + SNIPPET_RADIUS)
      snippets.push(
        `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${
          end < text.length ? '…' : ''
        }`
      )
    }
  }

  return { matches, snippets }
}

export async function searchNovelLibraryText(
  outDir: string,
  keyword: string
): Promise<NovelTextSearchResult> {
  const word = keyword.trim()
  if (!word) return { hits: [], scanned: 0 }

  const library = await scanNovelLibrary(outDir)
  const hits: NovelTextHit[] = []
  let scanned = 0

  for (const item of library.items) {
    const text = await loadText(item.path)
    scanned += 1
    if (!text) continue
    const { matches, snippets } = snippetsOf(text, word)
    if (matches === 0) continue
    hits.push({
      path: item.path,
      title: item.title,
      author: item.author,
      matches,
      snippets
    })
    if (hits.length >= MAX_HITS) break
  }

  return { hits, scanned }
}

export async function readNovelText(outDir: string, filePath: string): Promise<string> {
  const root = novelLibraryRoot(outDir)
  const safe = assertNovelFile(root, filePath)
  const text = await loadText(safe)
  if (text === null) throw new Error('无法读取该小说文件')
  return text
}
