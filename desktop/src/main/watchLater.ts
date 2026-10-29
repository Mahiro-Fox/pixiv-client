import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ViewRecordInput, WatchLaterEntry } from '../shared/types'

/**
 * 稍后看：用户在作品详情里手动加入的待看列表，只存本地。
 * 结构和 viewHistory 基本一致，但语义不同 —— 这里不做自动记录，
 * 也不与 pixiv 收藏同步（收藏会进公开/私密收藏夹，稍后看只是本地书签）。
 */
interface WatchLaterStore {
  version: number
  /** 已按加入时间倒序排列 */
  entries: WatchLaterEntry[]
}

const WRITE_DELAY = 800
/** 只保留最近 2000 条，避免文件无限增长 */
const MAX_ENTRIES = 2000

let cache: WatchLaterStore | null = null
let loading: Promise<WatchLaterStore> | null = null
let timer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

function watchLaterFile(): string {
  return path.join(app.getPath('userData'), 'watchLater.json')
}

/** 把任意尺寸的 pximg 地址收敛成 250px 缩略图 */
function toThumb(url: string): string {
  const text = String(url || '').trim()
  const match = /^(https?:\/\/i\.pximg\.net)(?:\/c\/[^/]+)?(\/img-master\/.+)$/i.exec(text)
  return match ? `${match[1]}/c/250x250_80_a2${match[2]}` : text
}

function normalize(entry: Partial<WatchLaterEntry>): WatchLaterEntry | null {
  const id = String(entry?.id || '').trim()
  if (!id) return null
  return {
    id,
    title: entry.title || `ID ${id}`,
    userId: String(entry.userId || ''),
    userName: String(entry.userName || ''),
    thumbnail: toThumb(entry.thumbnail || ''),
    pageCount: Math.max(1, Math.round(Number(entry.pageCount) || 1)),
    xRestrict: Math.max(0, Math.round(Number(entry.xRestrict) || 0)),
    illustType: Math.max(0, Math.round(Number(entry.illustType) || 0)),
    at: Number(entry.at) || Date.now()
  }
}

/** 读盘容错：跳过残缺条目，按作品 ID 去重并重新排序 */
function parseStore(raw: string): WatchLaterStore {
  const parsed = JSON.parse(raw) as Partial<WatchLaterStore>
  const list = Array.isArray(parsed.entries) ? parsed.entries : []
  const unique = new Map<string, WatchLaterEntry>()
  list.forEach((item) => {
    const entry = normalize(item)
    if (!entry) return
    const previous = unique.get(entry.id)
    if (!previous || previous.at < entry.at) unique.set(entry.id, entry)
  })
  const entries = [...unique.values()].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES)
  return { version: 1, entries }
}

async function loadStore(): Promise<WatchLaterStore> {
  if (cache) return cache
  if (!loading) {
    loading = readFile(watchLaterFile(), 'utf-8')
      .then((raw) => parseStore(raw))
      .catch(() => ({ version: 1, entries: [] }) as WatchLaterStore)
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

function snapshot(): WatchLaterEntry[] {
  return cache ? [...cache.entries] : []
}

export async function listWatchLater(): Promise<WatchLaterEntry[]> {
  const store = await loadStore()
  return [...store.entries]
}

export async function isWatchLater(id: string): Promise<boolean> {
  const key = String(id || '').trim()
  if (!key) return false
  const store = await loadStore()
  return store.entries.some((entry) => entry.id === key)
}

/** 加入稍后看：已存在时只更新时间并置顶，返回最新列表 */
export async function addWatchLater(input: ViewRecordInput): Promise<WatchLaterEntry[]> {
  const entry = normalize({
    id: input?.id,
    title: input?.title,
    userId: input?.userId,
    userName: input?.userName,
    thumbnail: input?.url,
    pageCount: input?.pageCount,
    xRestrict: input?.xRestrict,
    illustType: input?.illustType,
    at: Date.now()
  })
  if (!entry) return listWatchLater()

  const store = await loadStore()
  store.entries = [entry, ...store.entries.filter((item) => item.id !== entry.id)].slice(
    0,
    MAX_ENTRIES
  )
  scheduleWrite()
  return snapshot()
}

export async function removeWatchLater(id: string): Promise<WatchLaterEntry[]> {
  const key = String(id || '').trim()
  const store = await loadStore()
  const next = store.entries.filter((entry) => entry.id !== key)
  if (next.length !== store.entries.length) {
    store.entries = next
    scheduleWrite()
  }
  return [...store.entries]
}

export async function clearWatchLater(): Promise<WatchLaterEntry[]> {
  const store = await loadStore()
  store.entries = []
  scheduleWrite()
  return []
}

function scheduleWrite(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushWatchLater()
  }, WRITE_DELAY)
  timer.unref?.()
}

/** 原子写入：临时文件 + 重命名，避免退出时写坏 */
export async function flushWatchLater(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const store = cache
  if (!store) return

  writeChain = writeChain
    .then(async () => {
      const file = watchLaterFile()
      await mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, JSON.stringify(store, null, 2), 'utf-8')
      await rename(temp, file)
    })
    .catch(() => undefined)
  return writeChain
}
