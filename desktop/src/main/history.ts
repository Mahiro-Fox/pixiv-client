import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { HistoryEntry } from '../shared/types'

interface HistoryStore {
  version: number
  /** 以小写绝对路径为键，避免 Windows 大小写差异导致重复记录 */
  entries: Record<string, HistoryEntry>
}

const WRITE_DELAY = 800

let cache: HistoryStore | null = null
let loading: Promise<HistoryStore> | null = null
let timer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

function historyFile(): string {
  return path.join(app.getPath('userData'), 'history.json')
}

function entryKey(filePath: string): string {
  const resolved = path.resolve(String(filePath || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function parseStore(raw: string): HistoryStore {
  const parsed = JSON.parse(raw) as Partial<HistoryStore>
  const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
  return { version: 1, entries }
}

export async function loadHistory(): Promise<HistoryStore> {
  if (cache) return cache
  if (!loading) {
    loading = readFile(historyFile(), 'utf-8')
      .then((raw) => parseStore(raw))
      .catch(() => ({ version: 1, entries: {} }) as HistoryStore)
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

/** 读取全部历史条目（扫描图库时按路径查元数据） */
export async function listHistoryEntries(): Promise<HistoryEntry[]> {
  const store = await loadHistory()
  return Object.values(store.entries)
}

/** 记录一个已完成（或已存在）的文件；写盘按 800ms 防抖合并 */
export function recordHistory(entry: HistoryEntry): void {
  void loadHistory().then((store) => {
    store.entries[entryKey(entry.path)] = {
      ...entry,
      path: path.resolve(entry.path),
      at: entry.at || Date.now()
    }
    scheduleWrite()
  })
}

/** 删除文件后同步移除历史条目，避免索引里残留已不存在的路径 */
export function forgetHistory(paths: string[]): void {
  if (paths.length === 0) return
  void loadHistory().then((store) => {
    let changed = false
    paths.forEach((item) => {
      const key = entryKey(item)
      if (store.entries[key]) {
        delete store.entries[key]
        changed = true
      }
    })
    if (changed) scheduleWrite()
  })
}

function scheduleWrite(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushHistory()
  }, WRITE_DELAY)
  timer.unref?.()
}

/** 原子写入历史索引：临时文件 + 重命名，避免退出时写坏 */
export async function flushHistory(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const store = cache
  if (!store) return

  writeChain = writeChain
    .then(async () => {
      const file = historyFile()
      const dir = path.dirname(file)
      await mkdir(dir, { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, JSON.stringify(store, null, 2), 'utf-8')
      await rename(temp, file)
    })
    .catch(() => undefined)
  return writeChain
}
