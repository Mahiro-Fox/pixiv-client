import { BrowserWindow, app, dialog, ipcMain, shell, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AppConfig,
  CollectParams,
  CollectProgress,
  DownloadParams,
  DownloadSummary,
  DownloadedParams,
  FailureItem,
  FollowingParams,
  LibraryResult,
  PixivWork,
  UgoiraFormat,
  WorkExportParams
} from '../shared/types'
import { clearCookie, getCookieStatus, loadConfig, resolveCookie, saveConfig, saveCookie } from './config'
import {
  collectBookmarks,
  collectWorks,
  fetchFollowing,
  fetchSelfUser,
  fetchWorkPages,
  probeCookieHealth,
  suggestTags
} from './pixiv/api'
import { findDownloadedIds, safeName } from './pixiv/files'
import { setAuthFailureHandler } from './pixiv/http'
import { clearPixivLoginSession, openPixivLogin } from './pixiv/login'
import { runDownloadJob } from './pixiv/jobs'
import { applyThrottleLimits, onThrottleChange, throttleStates } from './pixiv/throttle'
import { throttleLimitsFromConfig } from '../shared/throttle'
import { findJob, flushQueue, listFailures, listSummaries, loadStore, removeJob } from './queue'
import { scanLibrary } from './library'
import { forgetHistory } from './history'

interface ActiveRun {
  controller: AbortController
  promise: Promise<DownloadSummary>
}

let activeRun: ActiveRun | null = null

/** 图库扫描结果短暂缓存，避免切换标签页时重复扫描磁盘 */
let libraryCache: { at: number; result: LibraryResult } | null = null
const LIBRARY_CACHE_MS = 15_000

/** 保存目录监听：外部增删文件后让缓存失效并通知界面刷新 */
let libraryWatcher: FSWatcher | null = null
let watchedDir = ''
let libraryWatchTimer: NodeJS.Timeout | null = null

function stopLibraryWatcher(): void {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer)
    libraryWatchTimer = null
  }
  libraryWatcher?.close()
  libraryWatcher = null
  watchedDir = ''
}

/**
 * 递归监听保存目录。Windows 原生支持 recursive；
 * 监听失败（目录不存在、权限不足）时静默降级，仍可手动「重新扫描」。
 */
function watchLibraryDir(outDir: string): void {
  const value = (outDir || '').trim()
  if (!value || !path.isAbsolute(value)) {
    stopLibraryWatcher()
    return
  }
  const target = path.resolve(value)
  if (libraryWatcher && watchedDir === target) return
  stopLibraryWatcher()
  try {
    const watcher = watch(target, { recursive: true, persistent: false }, () => {
      // 下载与批量删除会连续触发大量事件，合并成一次刷新
      if (libraryWatchTimer) clearTimeout(libraryWatchTimer)
      libraryWatchTimer = setTimeout(() => {
        libraryWatchTimer = null
        libraryCache = null
        broadcast('library:changed', { at: Date.now() })
      }, 800)
    })
    watcher.on('error', () => stopLibraryWatcher())
    libraryWatcher = watcher
    watchedDir = target
  } catch {
    libraryWatcher = null
    watchedDir = ''
  }
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

/** 动图格式只接受三个合法值，其它输入回退到 mp4 */
function toUgoiraFormat(value: unknown): UgoiraFormat {
  return value === 'zip' || value === 'gif' ? value : 'mp4'
}

function broadcast(channel: string, payload: unknown, sender?: WebContents): void {
  const targets = sender && !sender.isDestroyed() ? [sender] : BrowserWindow.getAllWindows().map((win) => win.webContents)
  targets.forEach((contents) => {
    if (!contents.isDestroyed()) contents.send(channel, payload)
  })
}

async function pushQueue(sender?: WebContents): Promise<void> {
  broadcast('queue:changed', listSummaries(), sender)
}

async function executeJob(
  params: DownloadParams,
  sender: WebContents,
  jobId?: string
): Promise<DownloadSummary> {
  if (activeRun) throw new Error('已有下载任务在运行')

  const config = await loadConfig()
  const { cookie } = await resolveCookie()
  if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤')

  const outDir = (params.outDir || config.outDir).trim()
  if (!outDir) throw new Error('未设置保存目录')
  if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

  const existing = jobId ? findJob(jobId) : undefined
  if (jobId && !existing) throw new Error('任务不存在或已完成')

  const controller = new AbortController()
  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  const promise = runDownloadJob({
    works: params.works,
    tag: (params.tag || config.tag).trim() || config.tag,
    outDir,
    workers: toInt(params.workers, config.workers, 1, 32),
    delay: Math.max(0, Math.min(5, Number(params.delay) || 0)),
    imageQuality:
      (params.imageQuality ?? config.imageQuality) === 'original' ? 'original' : 'regular',
    ugoiraFormat: toUgoiraFormat(params.ugoiraFormat ?? config.ugoiraFormat),
    cookie,
    signal: controller.signal,
    job: existing,
    fileNameTemplate: config.fileNameTemplate,
    onProgress: (progress) => send('download:progress', progress),
    onItem: (item) => send('download:item', item)
  })

  activeRun = { controller, promise }

  try {
    const summary = await promise
    send('download:done', summary)
    await pushQueue()
    libraryCache = null
    return summary
  } finally {
    activeRun = null
  }
}

/** 退出前调用：中止正在运行的任务并等待其把「已暂停」状态落盘 */
export async function shutdownActiveJob(): Promise<void> {
  const run = activeRun
  if (!run) return
  run.controller.abort()
  await run.promise.catch(() => undefined)
}

export function registerIpcHandlers(): void {
  void loadStore()

  onThrottleChange((state) => broadcast('throttle:state', state))

  // 任何接口回 401/403 都说明 Cookie 已失效，推给界面提醒用户重新登录
  setAuthFailureHandler(() => broadcast('cookie:invalid', null))

  // 启动时应用已保存的限流参数，并监听保存目录变化
  void loadConfig().then((config) => {
    applyThrottleLimits(throttleLimitsFromConfig(config))
    watchLibraryDir(config.outDir)
  })

  ipcMain.handle('config:get', () => loadConfig())

  ipcMain.handle('config:set', async (_event, patch: Partial<AppConfig>) => {
    const config = await saveConfig(patch)
    libraryCache = null
    // 限流参数改完立即生效，不必等下一次下载；保存目录变化时重建监听
    applyThrottleLimits(throttleLimitsFromConfig(config))
    watchLibraryDir(config.outDir)
    return config
  })

  ipcMain.handle('cookie:get', () => getCookieStatus())

  ipcMain.handle('cookie:set', (_event, raw: string) => saveCookie(raw))

  // 应用内登录：开一个独立窗口走 pixiv 登录页，成功后直接读取自己的会话 Cookie
  ipcMain.handle('cookie:login', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const cookie = await openPixivLogin(parent)
    if (!cookie) return null
    return saveCookie(cookie)
  })

  // 清除 Cookie：同时清空登录窗口分区的旧会话，
  // 否则下次点登录会被残留会话直接跳过，窗口来不及显示就关掉了
  ipcMain.handle('cookie:clear', async () => {
    await clearPixivLoginSession()
    return clearCookie()
  })

  // Cookie 体检：界面启动时和用户手动触发时调用
  ipcMain.handle('cookie:health', async () => {
    const { cookie } = await resolveCookie()
    return probeCookieHealth(cookie)
  })

  ipcMain.handle('dialog:pick-dir', async () => {
    const config = await loadConfig()
    const result = await dialog.showOpenDialog({
      defaultPath: config.outDir,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('shell:open-dir', async (_event, dir: string) => {
    await shell.openPath(dir)
  })

  ipcMain.handle('works:collect', async (event, params: CollectParams) => {
    const config = await loadConfig()
    const { cookie } = await resolveCookie()
    const sender = event.sender
    const source = params.source === 'bookmarks' ? 'bookmarks' : 'tag'
    const common = {
      tag: (params.tag ?? config.tag).trim(),
      tagExtra: params.extraTag ?? config.tagExtra,
      tagExclude: params.excludeTag ?? config.tagExclude,
      tagMode: params.tagMode ?? config.tagMode,
      offset: toInt(params.offset, config.offset, 0, 1_000_000),
      limit: toInt(params.limit, config.limit, 1, 100),
      workers: toInt(params.workers, config.workers, 1, 4),
      cookie,
      onProgress: (progress: CollectProgress) => {
        if (!sender.isDestroyed()) sender.send('collect:progress', progress)
      }
    }

    if (source === 'bookmarks') {
      // 收藏夹必须知道「谁的收藏」：优先用用户填写的 ID，留空则读取当前登录账号
      let userId = (params.bookmarkUserId || config.bookmarkUserId || '').trim()
      if (!userId) {
        const self = await fetchSelfUser(cookie)
        if (!self) {
          throw new Error('无法识别当前登录账号：请配置 Cookie，或手动填写收藏用户 ID')
        }
        userId = self.id
      }
      return collectBookmarks({
        ...common,
        userId,
        tag: (params.bookmarkTag ?? config.bookmarkTag).trim(),
        rest: params.bookmarkRest === 'hide' ? 'hide' : 'show'
      })
    }

    return collectWorks({
      ...common,
      userId: params.userId || config.userId,
      tag: common.tag || config.tag
    })
  })

  ipcMain.handle('user:self', async () => {
    const { cookie } = await resolveCookie()
    if (!cookie) return null
    try {
      return await fetchSelfUser(cookie)
    } catch {
      return null
    }
  })

  ipcMain.handle('user:following', async (_event, params: FollowingParams) => {
    const config = await loadConfig()
    const { cookie } = await resolveCookie()
    return fetchFollowing(
      (params?.userId ?? config.bookmarkUserId ?? '').trim(),
      toInt(params?.offset, 0, 0, 100_000),
      toInt(params?.limit, 48, 1, 100),
      cookie
    )
  })

  ipcMain.handle('download:start', (event, params: DownloadParams) =>
    executeJob(params, event.sender)
  )

  ipcMain.handle('work:pages', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('作品 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchWorkPages(id, cookie)
  })

  ipcMain.handle('tags:suggest', async (_event, word: string) => {
    const keyword = String(word || '').slice(0, 50)
    if (keyword.trim().length < 2) return []
    const { cookie } = await resolveCookie()
    return suggestTags(keyword, cookie)
  })

  ipcMain.handle('works:downloaded', async (_event, params: DownloadedParams) => {
    const config = await loadConfig()
    const outDir = (params?.outDir || config.outDir).trim()
    if (!outDir || !path.isAbsolute(outDir)) return []
    const tag = (params?.tag || config.tag).trim() || config.tag
    return findDownloadedIds(
      path.join(outDir, safeName(tag, 'tag')),
      params?.works || [],
      config.fileNameTemplate,
      config.imageQuality
    )
  })

  ipcMain.handle('download:cancel', () => {
    activeRun?.controller.abort()
    return true
  })

  ipcMain.handle('queue:list', async () => {
    await loadStore()
    return listSummaries()
  })

  ipcMain.handle('queue:resume', async (event, id: string) => {
    const job = findJob(id)
    if (!job) throw new Error('任务不存在或已完成')
    const config = await loadConfig()
    return executeJob(
      {
        works: job.works,
        tag: job.tag,
        outDir: job.outDir,
        workers: config.workers,
        delay: config.delay,
        imageQuality: job.imageQuality || config.imageQuality,
        ugoiraFormat: job.ugoiraFormat || config.ugoiraFormat
      },
      event.sender,
      id
    )
  })

  ipcMain.handle('queue:remove', async (event, id: string) => {
    removeJob(id)
    await flushQueue()
    const jobs = listSummaries()
    broadcast('queue:changed', jobs, event.sender)
    return jobs
  })

  ipcMain.handle('queue:failures', async (_event, id: string) => {
    await loadStore()
    return listFailures(id)
  })

  ipcMain.handle('queue:export-failures', async (_event, id: string) => {
    await loadStore()
    const job = findJob(id)
    if (!job) throw new Error('任务不存在或已完成')
    const failures = listFailures(id)
    if (failures.length === 0) throw new Error('该任务没有失败项')

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), `pixiv-failures-${stamp}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, toFailureCsv(failures), 'utf-8')
    return result.filePath
  })

  ipcMain.handle('works:export', async (_event, params: WorkExportParams) => {
    const works = Array.isArray(params?.works) ? params.works : []
    if (works.length === 0) throw new Error('没有可导出的作品')

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const safeTag = safeName(params.tag || 'pixiv', 'pixiv')
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), `pixiv-works-${safeTag}-${stamp}.csv`),
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    if (result.canceled || !result.filePath) return null

    const downloaded = new Set(params.downloaded || [])
    const isJson = result.filePath.toLowerCase().endsWith('.json')
    const content = isJson
      ? toWorksJson(works, downloaded)
      : toWorksCsv(works, downloaded)

    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  ipcMain.handle('library:list', async (_event, force?: boolean) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效，请先在设置中选择目录')
    const resolved = path.resolve(outDir)
    // 保存目录可能在 config:set 之外被改动，这里兜底对齐监听目标
    watchLibraryDir(resolved)
    if (
      !force &&
      libraryCache &&
      libraryCache.result.outDir === resolved &&
      Date.now() - libraryCache.at < LIBRARY_CACHE_MS
    ) {
      return libraryCache.result
    }
    const result = await scanLibrary(resolved, config.fileNameTemplate)
    libraryCache = { at: Date.now(), result }
    return result
  })

  ipcMain.handle('library:open-dir', async (_event, dir: string) => {
    const config = await loadConfig()
    const root = path.resolve(config.outDir)
    const target = path.resolve(String(dir || root))
    const relative = path.relative(root, target)
    // relative 为空表示就是保存目录本身；以 .. 开头或跨盘符说明越界
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('目录不在保存目录内')
    }
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  ipcMain.handle('library:delete', async (_event, paths: string[]) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效，请先在设置中选择目录')
    const root = path.resolve(outDir)

    const removed: string[] = []
    const dirs = new Set<string>()
    for (const item of Array.isArray(paths) ? paths : []) {
      const target = path.resolve(String(item || ''))
      const relative = path.relative(root, target)
      // 只允许删除保存目录内、且不是目录本身的文件
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue
      try {
        await rm(target, { force: true })
        removed.push(target)
        dirs.add(path.dirname(target))
      } catch {
        // 单个文件删除失败不影响其它文件
      }
    }
    if (removed.length === 0) throw new Error('没有可删除的文件')

    forgetHistory(removed)
    // 顺带清理变空的作者目录与标签目录
    for (const dir of dirs) {
      try {
        await rmdir(dir)
        await rmdir(path.dirname(dir))
      } catch {
        // 目录非空或已不存在，忽略
      }
    }

    libraryCache = null
    const result = await scanLibrary(root, config.fileNameTemplate)
    libraryCache = { at: Date.now(), result }
    return result
  })

  ipcMain.handle('throttle:get', () => throttleStates())
}

function workRow(work: PixivWork, downloaded: Set<string>): (string | number)[] {
  return [
    work.id,
    work.title,
    work.userId,
    work.userName,
    work.pageCount,
    work.width,
    work.height,
    Number(work.xRestrict || 0) >= 1 ? 'R-18' : '',
    Number(work.aiType || 0) === 2 ? 'AI' : '',
    work.createDate || '',
    (work.tags || []).join(' '),
    downloaded.has(work.id) ? '是' : '否',
    `https://www.pixiv.net/artworks/${work.id}`,
    work.url
  ]
}

const WORK_HEADER = [
  '作品ID',
  '标题',
  '作者ID',
  '作者',
  '页数',
  '宽',
  '高',
  '分级',
  'AI',
  '发布时间',
  '标签',
  '已下载',
  '作品链接',
  '封面地址'
]

function toWorksCsv(works: PixivWork[], downloaded: Set<string>): string {
  const rows = works.map((work) => workRow(work, downloaded).map(csvCell).join(','))
  return `\ufeff${[WORK_HEADER.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`
}

function toWorksJson(works: PixivWork[], downloaded: Set<string>): string {
  const rows = works.map((work) => {
    const row = workRow(work, downloaded)
    return Object.fromEntries(WORK_HEADER.map((key, index) => [key, row[index]]))
  })
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** CSV 单元格转义：引号加倍并整体包裹，避免逗号/换行破坏列结构 */
function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** 导出失败清单；开头加 BOM 以便 Excel 正确识别中文 */
function toFailureCsv(items: FailureItem[]): string {
  const rows = items.map((item) =>
    [
      item.kind === 'work' ? '作品解析' : '图片下载',
      item.illustId,
      item.label,
      item.url || '',
      item.error
    ]
      .map(csvCell)
      .join(',')
  )
  return `\ufeff${['类型,作品ID,文件/作品,图片地址,错误原因', ...rows].join('\r\n')}\r\n`
}
