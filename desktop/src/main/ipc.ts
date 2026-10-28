import { BrowserWindow, app, dialog, ipcMain, shell, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AppConfig,
  BatchArtistResult,
  BatchSyncParams,
  BatchSyncProgress,
  BatchSyncSummary,
  BookmarkInput,
  CollectParams,
  CollectProgress,
  DownloadParams,
  DownloadSummary,
  DownloadedParams,
  FailureItem,
  FollowingParams,
  FollowInput,
  LibraryResult,
  NovelDownloadParams,
  NovelSearchParams,
  OAuthCredentials,
  OAuthClientInput,
  PixivWork,
  ProxyConfig,
  QueueJob,
  RankingParams,
  RecommendUsersParams,
  RecommendWorksParams,
  UgoiraFormat,
  UserContentParams,
  UserSearchParams,
  ViewRecordInput,
  WorkExportParams,
  WorkSearchParams
} from '../shared/types'
import { clearCookie, getCookieStatus, loadConfig, resolveCookie, saveConfig, saveCookie } from './config'
import { applyProxy, getProxyState, saveProxyPassword, testProxy } from './proxy'
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
import {
  downloadNovel,
  fetchNovelDetail,
  fetchNovelSeries,
  searchNovels
} from './pixiv/novels'
import {
  readNovelText,
  scanNovelLibrary,
  searchNovelLibraryText
} from './pixiv/novelLibrary'
import { setAuthFailureHandler } from './pixiv/http'
import { fetchTrendingTags, fetchWorkDetail, searchWorks } from './pixiv/search'
import { fetchRanking } from './pixiv/ranking'
import { fetchRecommendedUsers, fetchRecommendedWorks } from './pixiv/recommend'
import { getBookmarkState, getFollowState, setBookmark, setFollow } from './pixiv/write'
import { fetchUserContent, fetchUserProfile, searchUsers } from './pixiv/user'
import { clearPixivLoginSession, openPixivLogin } from './pixiv/login'
import { clearOAuth, getOAuthStatus, saveOAuthCredentials } from './pixiv/oauth'
import { loginOAuthWithPKCE } from './pixiv/oauthLogin'
import { createQueuedJob, runDownloadJob } from './pixiv/jobs'
import { applyThrottleLimits, onThrottleChange, throttleStates } from './pixiv/throttle'
import { throttleLimitsFromConfig } from '../shared/throttle'
import { blockRulesOf, filterBlocked, isBlocked } from '../shared/block'
import {
  findJob,
  flushQueue,
  listActiveJobs,
  listFailures,
  listQueued,
  listSummaries,
  loadStore,
  removeJob,
  upsertJob
} from './queue'
import { scanLibrary } from './library'
import { forgetHistory } from './history'
import { clearViews, listViews, recordView } from './viewHistory'
import { checkForUpdates, getUpdateStatus, initUpdater, installUpdate } from './updater'

interface ActiveRun {
  controller: AbortController
  /** 单任务与批量同步共用同一套并发额度，二者的返回类型不同 */
  promise: Promise<unknown>
}

/**
 * 正在运行的下载任务。并行上限来自配置 `parallelJobs`；
 * 键为队列任务 ID（新任务与批量同步用生成的临时键）。
 */
const activeRuns = new Map<string, ActiveRun>()
let runSeq = 0

/** 并行下载时队列面板需要实时计数：合并成一次广播，避免每个文件都推一次 */
let queuePushTimer: NodeJS.Timeout | null = null
function scheduleQueuePush(): void {
  if (queuePushTimer) return
  queuePushTimer = setTimeout(() => {
    queuePushTimer = null
    void pushQueue()
  }, 800)
}

function runningSlots(config: AppConfig): number {
  return Math.max(1, Math.min(4, toInt(config.parallelJobs, 2, 1, 4)))
}

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

/**
 * 全局屏蔽：所有作品来源在返回前统一过一遍规则，
 * 保证「能在界面上看到的」和「能被下载的」是同一批作品。
 */
function withoutBlocked<T extends { userId?: string; userName?: string; tags?: Array<string | { tag?: string }> }>(
  works: T[],
  config: AppConfig
): T[] {
  return filterBlocked(works, blockRulesOf(config))
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
  sender?: WebContents,
  jobId?: string,
  retry?: { taskUrls?: string[]; illustIds?: string[] }
): Promise<DownloadSummary> {
  const config = await loadConfig()
  const limit = runningSlots(config)
  if (jobId && activeRuns.has(jobId)) throw new Error('该任务正在下载中')
  // 调度器会先把自己登记进 launching，这里要把它自己排除掉，否则串行模式下会误判为已满
  const self = jobId && launching.has(jobId) ? 1 : 0
  if (activeRuns.size + launching.size - self >= limit) {
    throw new Error(`并行任务已达上限（${limit} 个），请等待其中一个完成`)
  }

  const { cookie } = await resolveCookie()
  if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤')

  const outDir = (params.outDir || config.outDir).trim()
  if (!outDir) throw new Error('未设置保存目录')
  if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

  const existing = jobId ? findJob(jobId) : undefined
  if (jobId && !existing) throw new Error('任务不存在或已完成')

  const controller = new AbortController()
  const send = (channel: string, payload: unknown): void => {
    // 调度器自动启动的任务没有发起窗口，改为广播给所有窗口
    if (!sender || sender.isDestroyed()) broadcast(channel, payload)
    else sender.send(channel, payload)
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
    retry,
    fileNameTemplate: config.fileNameTemplate,
    onProgress: (progress) => {
      send('download:progress', progress)
      // 队列面板显示每个任务的实时计数，与主进度面板互不干扰
      scheduleQueuePush()
    },
    onItem: (item) => send('download:item', item)
  })

  const key = jobId || `run-${++runSeq}`
  activeRuns.set(key, { controller, promise })
  // 登记进运行表后立刻退出「待启动」集合，否则运行期间会被两处重复计数，
  // 并行额度会被虚占一半，导致同时只能跑一个任务
  if (jobId) launching.delete(jobId)

  try {
    const summary = await promise
    send('download:done', summary)
    await pushQueue()
    libraryCache = null
    return summary
  } finally {
    activeRuns.delete(key)
    await pushQueue()
    // 任务结束腾出额度后，自动把队首任务拉起来
    void pumpQueue()
  }
}

/**
 * 已交给调度器、但还没登记到 activeRuns 的任务，
 * 防止同一轮调度里把同一个任务启动两次、或超出并行额度。
 */
const launching = new Set<string>()
let pumping = false

function paramsOfJob(job: QueueJob, config: AppConfig): DownloadParams {
  return {
    works: job.works,
    tag: job.tag,
    outDir: job.outDir,
    // 入队时记下的并发与间隔优先：用户中途改设置不影响已排队的任务
    workers: job.workers ?? config.workers,
    delay: job.delay ?? config.delay,
    imageQuality: job.imageQuality,
    ugoiraFormat: job.ugoiraFormat
  }
}

async function launchQueuedJob(job: QueueJob, config: AppConfig): Promise<void> {
  launching.add(job.id)
  // 先落盘为 resolving，调度下一轮就不会再取到它；一次性重试范围同时清空
  upsertJob({ ...job, status: 'resolving', retry: undefined })
  try {
    await executeJob(paramsOfJob(job, config), undefined, job.id, job.retry)
  } catch (error) {
    const current = findJob(job.id)
    if (current && !activeRuns.has(job.id)) {
      upsertJob({
        ...current,
        status: 'paused',
        progress: { ...current.progress, phase: 'paused' }
      })
    }
    broadcast('queue:error', error instanceof Error ? error.message : String(error))
  } finally {
    launching.delete(job.id)
    await pushQueue()
    void pumpQueue()
  }
}

/** 队列调度：只要有并行额度空出来，就自动启动队首任务 */
async function pumpQueue(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    const config = await loadConfig()
    const limit = runningSlots(config)
    while (activeRuns.size + launching.size < limit) {
      const next = listQueued().find((job) => !launching.has(job.id))
      if (!next) break
      // launchQueuedJob 在第一个 await 之前就会标记 launching 并改写状态
      void launchQueuedJob(next, config)
    }
  } finally {
    pumping = false
  }
}

/**
 * 批量同步：逐位画师「抓取 → 下载」。
 *
 * 串行执行：多位画师同时翻页最容易把接口打到 429。
 * 每位画师只取最新的一页（数量上限沿用「每页数量」），
 * 批量场景下全量拉取既慢又会拖很久。单条画师失败不中断整体。
 */
async function executeBatch(
  params: BatchSyncParams,
  sender: WebContents
): Promise<BatchSyncSummary> {
  const artists = (params.artists || []).filter((item) => item && item.id)
  if (!artists.length) throw new Error('未选择画师')

  const config = await loadConfig()
  // 批量同步自身串行处理画师，但同样占用一个并行额度
  const limit = runningSlots(config)
  // 调度器刚取出、还没登记到 activeRuns 的任务也要算进额度
  if (activeRuns.size + launching.size >= limit) {
    throw new Error(`并行任务已达上限（${limit} 个），请等待其中一个完成`)
  }
  const { cookie } = await resolveCookie()
  if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤')

  const outDir = (params.outDir || config.outDir).trim()
  if (!outDir) throw new Error('未设置保存目录')
  if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

  const controller = new AbortController()
  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }
  const tag = (params.tag || config.tag).trim() || config.tag
  const perArtist = toInt(config.limit, 48, 1, 100)
  const key = `batch-${++runSeq}`

  const promise = (async (): Promise<BatchSyncSummary> => {
    const results: BatchArtistResult[] = []
    let lastSummary: DownloadSummary | null = null

    for (const [index, artist] of artists.entries()) {
      if (controller.signal.aborted) break
      const progress: BatchSyncProgress = {
        index: index + 1,
        total: artists.length,
        artist,
        phase: 'collecting',
        works: 0,
        files: 0,
        failed: 0
      }
      send('batch:progress', progress)

      try {
        const collected = await collectWorks({
          userId: artist.id,
          tag,
          tagExtra: config.tagExtra,
          tagExclude: config.tagExclude,
          tagMode: config.tagMode,
          offset: 0,
          limit: perArtist,
          workers: 1,
          maxWorks: perArtist,
          cookie,
          signal: controller.signal,
          onProgress: (item) => send('batch:progress', { ...progress, works: item.loaded })
        })
        const works = withoutBlocked(collected.works, config).slice(0, perArtist)
        progress.works = works.length
        send('batch:progress', { ...progress })

        if (works.length === 0) {
          results.push({ artist, works: 0, files: 0, failed: 0 })
          send('batch:progress', { ...progress, phase: 'done' })
          continue
        }

        const summary = await runDownloadJob({
          works,
          tag,
          outDir,
          workers: toInt(params.workers, config.workers, 1, 32),
          delay: Math.max(0, Math.min(5, Number(params.delay) || 0)),
          imageQuality:
            (params.imageQuality ?? config.imageQuality) === 'original'
              ? 'original'
              : 'regular',
          ugoiraFormat: toUgoiraFormat(params.ugoiraFormat ?? config.ugoiraFormat),
          cookie,
          signal: controller.signal,
          fileNameTemplate: config.fileNameTemplate,
          onProgress: (item) => {
            progress.phase = 'downloading'
            progress.files = item.done
            progress.failed = item.failed
            send('download:progress', item)
            send('batch:progress', { ...progress })
          },
          onItem: (item) => send('download:item', item)
        })
        lastSummary = summary
        results.push({
          artist,
          works: works.length,
          files: summary.done,
          failed: summary.failed + summary.resolveFailed
        })
        send('batch:progress', { ...progress, phase: 'done' })
      } catch (error) {
        // 用户取消属于正常收尾，不再记成失败
        if (controller.signal.aborted) break
        results.push({
          artist,
          works: progress.works,
          files: progress.files,
          failed: progress.failed,
          error: error instanceof Error ? error.message : String(error)
        })
        send('batch:progress', { ...progress, phase: 'failed' })
      }
    }

    if (lastSummary && !controller.signal.aborted) send('download:done', lastSummary)
    await pushQueue()
    libraryCache = null

    const ok = results.filter((item) => !item.error).length
    return {
      artists: results,
      total: artists.length,
      ok,
      failed: results.length - ok,
      aborted: controller.signal.aborted
    }
  })()

  activeRuns.set(key, { controller, promise })
  try {
    return await promise
  } finally {
    activeRuns.delete(key)
    await pushQueue()
    // 批量结束后同样释放额度，让排队任务补位
    void pumpQueue()
  }
}

/** 退出前调用：中止正在运行的任务并等待其把「已暂停」状态落盘 */
export async function shutdownActiveJob(): Promise<void> {
  const runs = [...activeRuns.values()]
  runs.forEach((run) => run.controller.abort())
  await Promise.allSettled(runs.map((run) => run.promise))
}

export function registerIpcHandlers(): void {
  void loadStore()

  // 自动更新：状态统一走广播，界面订阅 update:status 即可
  initUpdater((status) => broadcast('update:status', status))

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
    // 代理走独立的 proxy:set 通道：这里忽略 proxy 字段，
    // 否则关闭设置弹窗时的整份配置可能覆盖刚保存的代理值
    const rest = { ...patch }
    delete rest.proxy
    const config = await saveConfig(rest)
    libraryCache = null
    // 限流参数改完立即生效，不必等下一次下载；保存目录变化时重建监听
    applyThrottleLimits(throttleLimitsFromConfig(config))
    watchLibraryDir(config.outDir)
    // 并行任务数调大时，排队中的任务可以立刻补位
    void pumpQueue()
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

  // App API（OAuth）凭据：写操作（收藏、关注）走 app-api.pixiv.net + Bearer
  ipcMain.handle('oauth:status', () => getOAuthStatus())
  ipcMain.handle('oauth:save', async (_event, credentials: unknown) => {
    const value = (credentials ?? {}) as Partial<OAuthCredentials>
    return saveOAuthCredentials({
      clientId: String(value.clientId ?? ''),
      clientSecret: String(value.clientSecret ?? ''),
      refreshToken: String(value.refreshToken ?? '')
    })
  })
  ipcMain.handle('oauth:clear', () => clearOAuth())
  ipcMain.handle('oauth:login', async (event, client: unknown) => {
    const value = (client ?? {}) as Partial<OAuthClientInput>
    const parent = BrowserWindow.fromWebContents(event.sender)
    return loginOAuthWithPKCE(parent, {
      clientId: String(value.clientId ?? '').slice(0, 200),
      clientSecret: String(value.clientSecret ?? '').slice(0, 200)
    })
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
      const collected = await collectBookmarks({
        ...common,
        userId,
        tag: (params.bookmarkTag ?? config.bookmarkTag).trim(),
        rest: params.bookmarkRest === 'hide' ? 'hide' : 'show'
      })
      return { ...collected, works: withoutBlocked(collected.works, config) }
    }

    const collected = await collectWorks({
      ...common,
      userId: params.userId || config.userId,
      tag: common.tag || config.tag
    })
    return { ...collected, works: withoutBlocked(collected.works, config) }
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

  // 插画 / 漫画搜索：只做参数清洗，排序与分级由 API 层再白名单校验
  ipcMain.handle('search:works', async (_event, params: WorkSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) {
      return {
        works: [],
        total: 0,
        lastPage: 1,
        relatedTags: [],
        tagTranslation: {},
        chips: [],
        bookmarkRanges: []
      }
    }
    const { cookie } = await resolveCookie()
    const result = await searchWorks(
      {
        kind: params?.kind === 'manga' ? 'manga' : 'illust',
        word,
        order: params?.order ?? 'date_d',
        mode:
          params?.mode === 'safe' || params?.mode === 'r18' ? params.mode : 'all',
        page: toInt(params?.page, 1, 1, 1000),
        csw: Boolean(params?.csw),
        blt: toInt(params?.blt, 0, 0, 100000),
        scope: params?.scope === 'tag_tc' ? 'tag_tc' : 'tag',
        includeManga: Boolean(params?.includeManga)
      },
      cookie
    )
    const config = await loadConfig()
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  ipcMain.handle('search:users', async (_event, params: UserSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) return { users: [], total: 0 }
    const { cookie } = await resolveCookie()
    return searchUsers(
      {
        word,
        page: toInt(params?.page, 1, 1, 1000),
        postedOnly: params?.postedOnly !== false
      },
      cookie
    )
  })

  ipcMain.handle('user:profile', async (_event, userId: string) => {
    const id = String(userId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('用户 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchUserProfile(id, cookie)
  })

  ipcMain.handle('user:content', async (_event, params: UserContentParams) => {
    const id = String(params?.userId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('用户 ID 无效')
    const tab = params?.tab
    if (!['illust', 'manga', 'novel', 'bookmarks'].includes(tab)) throw new Error('栏目无效')
    const { cookie } = await resolveCookie()
    const config = await loadConfig()
    const result = await fetchUserContent(
      {
        userId: id,
        tab,
        page: toInt(params?.page, 1, 1, 1000),
        limit: toInt(params?.limit, 48, 1, 100),
        bookmarkRest: params?.bookmarkRest === 'hide' ? 'hide' : 'show',
        bookmarkTag: params?.bookmarkTag
      },
      cookie
    )
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 官方排行榜：网页端接口，未登录也能取到全年龄榜单
  ipcMain.handle('ranking:list', async (_event, params: RankingParams) => {
    const { cookie } = await resolveCookie()
    const config = await loadConfig()
    const result = await fetchRanking(
      {
        kind: params?.kind === 'manga' ? 'manga' : 'illust',
        mode: params?.mode ?? 'daily',
        page: toInt(params?.page, 1, 1, 10),
        date: String(params?.date || '').trim()
      },
      cookie
    )
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 推荐作品：已连接 App API 时个性化推荐，否则网页发现兜底
  ipcMain.handle('recommend:works', async (_event, params: RecommendWorksParams) => {
    const config = await loadConfig()
    const result = await fetchRecommendedWorks({
      kind: params?.kind === 'manga' ? 'manga' : 'illust',
      nextUrl: typeof params?.nextUrl === 'string' ? params.nextUrl.slice(0, 2000) : '',
      mode: params?.mode === 'safe' || params?.mode === 'r18' ? params.mode : 'all'
    })
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 推荐画师：只走 App API；未连接时前端会提前提示，不会走到这里
  ipcMain.handle('recommend:users', async (_event, params: RecommendUsersParams) => {
    const config = await loadConfig()
    const result = await fetchRecommendedUsers({
      nextUrl: typeof params?.nextUrl === 'string' ? params.nextUrl.slice(0, 2000) : ''
    })
    const rules = blockRulesOf(config)
    return {
      ...result,
      users: result.users.filter(
        (user) => !isBlocked({ userId: user.id, userName: user.name }, rules)
      )
    }
  })

  // 写操作：收藏 / 关注都走 App API，凭据缺失时在 write.ts 里统一报错
  ipcMain.handle('write:bookmarkState', async (_event, workId: string) =>
    getBookmarkState(workId)
  )
  ipcMain.handle('write:setBookmark', async (_event, workId: string, input: BookmarkInput) =>
    setBookmark(workId, input)
  )
  ipcMain.handle('write:followState', async (_event, userId: string) =>
    getFollowState(userId)
  )
  ipcMain.handle('write:setFollow', async (_event, userId: string, input: FollowInput) =>
    setFollow(userId, input)
  )

  // 加入队列：校验后立即返回，任务由调度器按并行额度自动启动
  ipcMain.handle('download:enqueue', async (event, params: DownloadParams) => {
    const config = await loadConfig()
    const { cookie } = await resolveCookie()
    if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤')

    const outDir = (params?.outDir || config.outDir).trim()
    if (!outDir) throw new Error('未设置保存目录')
    if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

    const works = params?.works || []
    if (works.length === 0) throw new Error('没有选择作品')
    const tag = (params?.tag || config.tag).trim() || config.tag

    const queued = createQueuedJob({
      works,
      tag,
      outDir,
      imageQuality:
        (params.imageQuality ?? config.imageQuality) === 'original' ? 'original' : 'regular',
      ugoiraFormat: toUgoiraFormat(params.ugoiraFormat ?? config.ugoiraFormat),
      workers: toInt(params.workers, config.workers, 1, 32),
      delay: Math.max(0, Math.min(5, Number(params.delay) || 0))
    })

    // 同一位作者在队列里只允许存在一个任务（含已暂停的），避免重复抓取同一批作品
    if (queued.artistId) {
      const sameArtist = listSummaries().find(
        (job) => job.artistId && job.artistId === queued.artistId
      )
      if (sameArtist) {
        throw new Error(`已存在 ${sameArtist.artistLabel || sameArtist.tag} 用户的任务`)
      }
    }

    upsertJob(queued)

    await pushQueue()
    void pumpQueue()
    return listSummaries()
  })

  ipcMain.handle('batch:sync', (event, params: BatchSyncParams) =>
    executeBatch(params, event.sender)
  )

  ipcMain.handle('work:pages', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('作品 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchWorkPages(id, cookie)
  })

  // 只带 id 的缩略图（用户列表四图）按 id 补全详情
  ipcMain.handle('work:detail', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) return null
    const { cookie } = await resolveCookie()
    return fetchWorkDetail(id, cookie)
  })

  // 搜索框下拉里的热门标签（首页推荐作品聚合）
  ipcMain.handle('search:trendingTags', async () => {
    const { cookie } = await resolveCookie()
    return fetchTrendingTags(cookie)
  })

  // 小说搜索：只做入口参数清洗，排序/分级/匹配方式由 API 层再白名单校验一次
  ipcMain.handle('novel:search', async (_event, params: NovelSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) return { novels: [], total: 0, lastPage: 1, relatedTags: [] }
    const { cookie } = await resolveCookie()
    return searchNovels(
      {
        word,
        order: params?.order ?? 'date_d',
        mode: params?.mode ?? 'all',
        target: params?.target ?? 's_tag_full',
        page: toInt(params?.page, 1, 1, 10)
      },
      cookie
    )
  })

  ipcMain.handle('novel:detail', async (_event, novelId: string) => {
    const id = String(novelId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('小说 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchNovelDetail(id, cookie)
  })

  ipcMain.handle('novel:series', async (_event, seriesId: string) => {
    const id = String(seriesId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('系列 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchNovelSeries(id, cookie)
  })

  // 保存 TXT：整部系列由主进程逐话拉取，进度实时推给发起窗口
  ipcMain.handle('novel:download', async (event, params: NovelDownloadParams) => {
    const config = await loadConfig()
    const outDir = (params?.outDir || config.outDir || '').trim()
    if (!outDir) throw new Error('未设置保存目录')
    if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

    const novelId = String(params?.novelId || '').trim()
    const seriesId = String(params?.seriesId || '').trim()
    if (!novelId && !seriesId) throw new Error('缺少小说 ID')
    if (novelId && !/^\d+$/.test(novelId)) throw new Error('小说 ID 无效')
    if (seriesId && !/^\d+$/.test(seriesId)) throw new Error('系列 ID 无效')

    const { cookie } = await resolveCookie()
    const sender = event.sender
    return downloadNovel({
      novelId: novelId || undefined,
      seriesId: seriesId || undefined,
      outDir,
      cookie,
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('novel:download-progress', progress)
      }
    })
  })

  // 本地小说书库：扫描保存目录，支持正文检索与应用内阅读
  ipcMain.handle('novel:library', async (_event, force?: boolean) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效')
    return scanNovelLibrary(outDir, Boolean(force))
  })

  ipcMain.handle('novel:library-search', async (_event, keyword: string) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效')
    const word = String(keyword || '').trim().slice(0, 100)
    if (!word) return { hits: [], scanned: 0 }
    return searchNovelLibraryText(outDir, word)
  })

  ipcMain.handle('novel:library-read', async (_event, filePath: string) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效')
    return readNovelText(outDir, String(filePath || ''))
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

  ipcMain.handle('download:cancel', async () => {
    // 并行时「取消」中止所有运行中的任务，逐个落盘为「已暂停」
    activeRuns.forEach((run) => run.controller.abort())
    // 排队中的任务一并撤回，否则调度器会立刻把下一个拉起来
    for (const job of listQueued()) {
      upsertJob({
        ...job,
        status: 'paused',
        progress: { ...job.progress, phase: 'paused' }
      })
    }
    await pushQueue()
    return true
  })

  ipcMain.handle('queue:list', async () => {
    await loadStore()
    return listSummaries()
  })

  // 继续任务：重新放回队列，由调度器在额度允许时自动启动
  ipcMain.handle('queue:resume', async (event, id: string) => {
    const job = findJob(id)
    if (!job) throw new Error('任务不存在或已完成')
    if (activeRuns.has(id)) throw new Error('该任务正在下载中')
    // 整体继续时应重新尝试全部失败项，不能沿用之前「只重试一条」的范围
    upsertJob({ ...job, status: 'queued', retry: undefined })
    await pushQueue()
    void pumpQueue()
    return listSummaries()
  })

  // 暂停单个任务：运行中只中止它自己的 controller，排队中直接转为未完成
  ipcMain.handle('queue:pause', async (_event, id: string) => {
    const job = findJob(id)
    if (!job) throw new Error('任务不存在或已完成')

    const run = activeRuns.get(id)
    if (run) {
      run.controller.abort()
    } else {
      // 还没启动的排队任务没有 controller，直接把快照落成未完成
      upsertJob({
        ...job,
        status: 'paused',
        progress: { ...job.progress, phase: 'paused' }
      })
    }

    await pushQueue()
    return listSummaries()
  })

  // 失败清单里逐条重试：只放行被点的那一项，其余失败记录保持不变
  ipcMain.handle('queue:retry-item', async (event, id: string, item: FailureItem) => {
    const job = findJob(id)
    if (!job) throw new Error('任务不存在或已完成')
    if (activeRuns.has(id)) throw new Error('该任务正在下载中')
    if (!item || !item.illustId) throw new Error('失败项无效')

    const retry =
      item.kind === 'work'
        ? { illustIds: [item.illustId] }
        : item.url
          ? { taskUrls: [item.url] }
          : { illustIds: [item.illustId] }

    upsertJob({ ...job, status: 'queued', retry })
    await pushQueue()
    void pumpQueue()
    return listSummaries()
  })

  ipcMain.handle('queue:remove', async (_event, id: string) => {
    if (activeRuns.has(id)) throw new Error('该任务正在下载中')
    removeJob(id)
    await flushQueue()
    await pushQueue()
    return listSummaries()
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

  // 浏览记录：打开作品详情时写一条，页面按时间倒序读取
  ipcMain.handle('viewHistory:list', async () => listViews())
  ipcMain.handle('viewHistory:record', async (_event, entry: ViewRecordInput) => {
    await recordView(entry)
  })
  ipcMain.handle('viewHistory:clear', async () => clearViews())

  ipcMain.handle('app:version', () => app.getVersion())

  // 自动更新：check 会在后台继续下载，install 仅在已下载完成时生效
  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())

  ipcMain.handle('proxy:get', () => getProxyState())

  // 保存并立即应用：密码 undefined 表示沿用已保存的密码，空串表示清除
  ipcMain.handle(
    'proxy:set',
    async (_event, patch: Partial<ProxyConfig>, password?: string) => {
      const current = await loadConfig()
      await saveConfig({ proxy: { ...current.proxy, ...(patch || {}) } })
      await saveProxyPassword(password)
      return applyProxy()
    }
  )

  ipcMain.handle('proxy:test', () => testProxy())
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
