import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { HistoryEntry, LibraryFile, LibraryResult, LibraryWork } from '../shared/types'
import {
  DEFAULT_FILE_TEMPLATE,
  compileDownloadMatcher,
  type DownloadMatcher
} from '../shared/template'
import { listHistoryEntries } from './history'

function normalizeKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 可直接作为封面/预览的图片扩展名 */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
/** 动图成品可能出现的扩展名：保留压缩包、转码后的视频与 gif */
const UGOIRA_EXTS = new Set(['.zip', '.mp4', '.gif', '.webm'])

/** 作者目录形如「114638697_画师名」，ID 与作者名都从中还原 */
function authorOf(dirName: string): { userId: string; userName: string } {
  const match = /^(\d+)_(.+)$/.exec(dirName)
  if (!match) return { userId: '', userName: dirName }
  return { userId: match[1], userName: match[2] }
}

function matchersFor(template: string): DownloadMatcher[] {
  const list = [compileDownloadMatcher(template), compileDownloadMatcher(DEFAULT_FILE_TEMPLATE)]
  return list
    .filter((matcher): matcher is DownloadMatcher => Boolean(matcher))
    .filter(
      (matcher, index, all) => all.findIndex((item) => item.re.source === matcher.re.source) === index
    )
}

interface Accumulator {
  id: string
  tag: string
  authorDir: string
  /** 同一页可能同时有常规图与原图（模板含 {quality}），因此按文件而不是按页收集 */
  files: LibraryFile[]
  history: HistoryEntry | null
  updatedAt: number
}

/**
 * 扫描保存目录，生成按「标签目录 + 作品 ID」聚合的本地图库。
 * 文件名通过当前模板与默认模板解析出作品 ID 与页码；标题等元数据优先取下载历史索引。
 */
export async function scanLibrary(outDir: string, template: string): Promise<LibraryResult> {
  const rootDir = path.resolve(outDir)
  const scannedAt = Date.now()
  const matchers = matchersFor(template || DEFAULT_FILE_TEMPLATE)
  if (matchers.length === 0) {
    return { outDir: rootDir, scannedAt, works: [], totalFiles: 0, totalBytes: 0, tags: [] }
  }

  const history = new Map<string, HistoryEntry>()
  ;(await listHistoryEntries()).forEach((entry) => {
    history.set(normalizeKey(entry.path), entry)
  })

  const works = new Map<string, Accumulator>()
  let totalFiles = 0
  let totalBytes = 0

  let tagDirs
  try {
    tagDirs = await readdir(rootDir, { withFileTypes: true })
  } catch {
    return { outDir: rootDir, scannedAt, works: [], totalFiles: 0, totalBytes: 0, tags: [] }
  }

  for (const tagDir of tagDirs) {
    if (!tagDir.isDirectory()) continue
    const tagPath = path.join(rootDir, tagDir.name)
    let authorDirs
    try {
      authorDirs = await readdir(tagPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const authorDir of authorDirs) {
      if (!authorDir.isDirectory()) continue
      const authorPath = path.join(tagPath, authorDir.name)
      let files
      try {
        files = await readdir(authorPath, { withFileTypes: true })
      } catch {
        continue
      }

      for (const fileDir of files) {
        if (!fileDir.isFile()) continue
        const name = fileDir.name
        if (name.endsWith('.part') || name.startsWith('.')) continue

        const matched = matchers
          .map((matcher) => {
            const result = matcher.re.exec(name)
            if (!result) return null
            const id = result[matcher.idGroup]
            const page = Number(result[matcher.pageGroup]) - matcher.pageOffset
            if (!id || !Number.isFinite(page) || page < 0) return null
            return { id, page }
          })
          .find(Boolean)
        if (!matched) continue

        const filePath = path.join(authorPath, name)
        let info
        try {
          info = await stat(filePath)
        } catch {
          continue
        }

        const key = `${tagDir.name}\u0000${matched.id}`
        const acc =
          works.get(key) ??
          ({
            id: matched.id,
            tag: tagDir.name,
            authorDir: authorDir.name,
            files: [],
            history: null,
            updatedAt: 0
          } as Accumulator)

        acc.files.push({
          page: matched.page,
          path: filePath,
          name,
          bytes: info.size,
          ext: path.extname(name).toLowerCase()
        })

        const entry = history.get(normalizeKey(filePath))
        if (entry && (!acc.history || (entry.page === 0 && acc.history.page !== 0))) {
          acc.history = entry
        }
        acc.updatedAt = Math.max(acc.updatedAt, info.mtimeMs || 0, entry?.at || 0)
        works.set(key, acc)

        totalFiles += 1
        totalBytes += info.size
      }
    }
  }

  const list: LibraryWork[] = []
  works.forEach((acc) => {
    // 同页多份文件时把体积更大的排在前面，原图通常更大
    const files = acc.files
      .slice()
      .sort((a, b) => a.page - b.page || b.bytes - a.bytes)
    if (files.length === 0) return
    const coverFile = files
      .filter((file) => IMAGE_EXTS.has(file.ext))
      .sort((a, b) => a.page - b.page || b.bytes - a.bytes)[0]
    const author = authorOf(acc.authorDir)
    const historyMeta = acc.history
    const ugoira = files.some((file) => UGOIRA_EXTS.has(file.ext)) || Boolean(historyMeta?.ugoira)
    const pageCount = new Set(files.map((file) => file.page)).size

    list.push({
      id: acc.id,
      title: historyMeta?.title || `作品 ${acc.id}`,
      userId: historyMeta?.userId || author.userId,
      userName: historyMeta?.userName || author.userName,
      tag: acc.tag,
      pageCount,
      files,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      updatedAt: acc.updatedAt || scannedAt,
      cover: coverFile ? coverFile.path : '',
      ugoira,
      hasHistory: Boolean(historyMeta)
    })
  })

  list.sort((a, b) => b.updatedAt - a.updatedAt)
  const tags = [...new Set(list.map((work) => work.tag))].sort((a, b) => a.localeCompare(b, 'zh'))

  return { outDir: rootDir, scannedAt, works: list, totalFiles, totalBytes, tags }
}
