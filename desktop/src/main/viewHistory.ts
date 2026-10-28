import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ViewHistoryEntry, ViewRecordInput } from '../shared/types'

/**
 * 浏览记录（与 history.ts 的「下载文件索引」是两回事）：
 * 打开作品详情就记一条，同一作品只保留最近一次，按时间倒序展示。
 */
interface ViewHistoryStore {
  version: number
  /** 已按浏览时间倒序排列 */
  entries: ViewHistoryEntry[]
}

const WRITE_DELAY = 800
/** 只保留最近 1000 条，避免文件无限增长 */
const MAX_ENTRIES = 1000

let cache: ViewHistoryStore | null = null
let loading: Promise<ViewHistoryStore> | null = null
let timer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

function viewHistoryFile(): string {
  return path.join(app.getPath('userData'), 'viewHistory.json')
}

/** 把原图/任意尺寸的 pximg 地址收敛成 250px 缩略图，历史页不必拉大图 */
function toThumb(url: string): string {
  const text = String(url || '').trim()
  const match = /^(https?:\/\/i\.pximg\.net)(?:\/c\/[^/]+)?(\/img-master\/.+)$/i.exec(text)
  return match ? `${match[1]}/c/250x250_80_a2${match[2]}` : text
}

function normalize(entry: ViewHistoryEntry): ViewHistoryEntry | null {
  const id = String(entry?.id || '').trim()
  if (!id) return null
  return {
    id,
    title: entry.title || `ID ${id}`,
    userId: String(entry.userId || ''),
    userName: String(entry.userName || ''),
    thumbnail: toThumb(entry.thumbnail),
    pageCount: Math.max(1, Math.round(Number(entry.pageCount) || 1)),
    xRestrict: Math.max(0, Math.round(Number(entry.xRestrict) || 0)),
    illustType: Math.max(0, Math.round(Number(entry.illustType) || 0)),
    at: Number(entry.at) || Date.now()
  }
}

/** 读盘时容错：跳过残缺条目，按作品 ID 去重并重新排序 */
function parseStore(raw: string): ViewHistoryStore {
  const parsed = JSON.parse(raw) as Partial<ViewHistoryStore>
  const list = Array.isArray(parsed.entries) ? parsed.entries : []
  const unique = new Map<string, ViewHistoryEntry>()
  list.forEach((item) => {
    const entry = normalize(item)
    if (!entry) return
    const previous = unique.get(entry.id)
    if (!previous || previous.at < entry.at) unique.set(entry.id, entry)
  })
  const entries = [...unique.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES)
  return { version: 1, entries }
}

async function loadStore(): Promise<ViewHistoryStore> {
  if (cache) return cache
  if (!loading) {
    loading = readFile(viewHistoryFile(), 'utf-8')
      .then((raw) => parseStore(raw))
      .catch(() => ({ version: 1, entries: [] }) as ViewHistoryStore)
      .then((store) => {
        cache = store
        return store
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

/** 按最近浏览时间倒序返回全部记录 */
export async function listViews(): Promise<ViewHistoryEntry[]> {
  const store = await loadStore()
  return [...store.entries]
}

/** 记录一次浏览：同一作品直接置顶，写盘按 800ms 防抖合并 */
export async function recordView(input: ViewRecordInput): Promise<void> {
  const id = String(input?.id || '').trim()
  const userId = String(input?.userId || '').trim()
  // 只有缩略图、没有作者信息时（用户列表的四格图）不记，避免历史里出现无名条目
  if (!id || !userId) return

  const store = await loadStore()
  const entry = normalize({
    id,
    title: input.title,
    userId,
    userName: String(input.userName || ''),
    thumbnail: input.url,
    pageCount: Number(input.pageCount) || 1,
    xRestrict: Number(input.xRestrict) || 0,
    illustType: Number(input.illustType) || 0,
    at: Date.now()
  })
  if (!entry) return

  store.entries = [entry, ...store.entries.filter((item) => item.id !== entry.id)].slice(
    0,
    MAX_ENTRIES
  )
  scheduleWrite()
}

/** 清空浏览记录，返回空列表 */
export async function clearViews(): Promise<ViewHistoryEntry[]> {
  const store = await loadStore()
  store.entries = []
  scheduleWrite()
  return []
}

function scheduleWrite(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushViews()
  }, WRITE_DELAY)
  timer.unref?.()
}

/** 原子写入：临时文件 + 重命名，避免退出时写坏 */
export async function flushViews(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const store = cache
  if (!store) return

  writeChain = writeChain
    .then(async () => {
      const file = viewHistoryFile()
      const dir = path.dirname(file)
      await mkdir(dir, { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, JSON.stringify(store, null, 2), 'utf-8')
      await rename(temp, file)
    })
    .catch(() => undefined)
  return writeChain
}
