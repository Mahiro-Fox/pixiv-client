import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { blockRulesOf, filterBlocked, isBlocked } from '../../shared/block';
import type {
  AppConfig,
  AuthorContent,
  BatchArtistResult,
  BatchSyncParams,
  BatchSyncProgress,
  BatchSyncSummary,
  DownloadParams,
  DownloadSummary,
  LibraryResult,
  QueueJob,
  UgoiraFormat,
  UgoiraFrames,
  WorkContent,
} from '../../shared/types';
import { loadConfig, resolveCookie } from '../config';
import { collectWorks, contentKindOf } from '../pixiv/api';
import { runDownloadJob } from '../pixiv/jobs';
import { throttledProgress } from '../progressThrottle';
import {
  findJob,
  listQueued,
  listSummaries,
  loadStore,
  upsertJob,
} from '../queue';
import { notifyDownloadDone, refreshTray } from '../tray';

interface ActiveRun {
  controller: AbortController;
  /** 单任务与批量同步共用同一套并发额度，二者的返回类型不同 */
  promise: Promise<unknown>;
}

/**
 * 正在运行的下载任务。并行上限来自配置 `parallelJobs`；
 * 键为队列任务 ID（新任务与批量同步用生成的临时键）。
 */
export const activeRuns = new Map<string, ActiveRun>();
let runSeq = 0;

/** 并行下载时队列面板需要实时计数：合并成一次广播，避免每个文件都推一次 */
let queuePushTimer: NodeJS.Timeout | null = null;
function scheduleQueuePush(): void {
  if (queuePushTimer) return;
  queuePushTimer = setTimeout(() => {
    queuePushTimer = null;
    void pushQueue();
  }, 800);
}

function runningSlots(config: AppConfig): number {
  return Math.max(1, Math.min(4, toInt(config.parallelJobs, 2, 1, 4)));
}

/** 图库扫描结果短暂缓存，避免切换标签页时重复扫描磁盘 */
type LibraryCacheEntry = { at: number; result: LibraryResult };
let libraryCache: LibraryCacheEntry | null = null;
export const LIBRARY_CACHE_MS = 15_000;

/** 读取图库扫描缓存；无缓存时返回 null */
export function readLibraryCache(): LibraryCacheEntry | null {
  return libraryCache;
}

/** 写入图库扫描缓存 */
export function writeLibraryCache(value: LibraryCacheEntry): void {
  libraryCache = value;
}

/** 让图库缓存失效，下一次读取重新扫描磁盘 */
export function clearLibraryCache(): void {
  libraryCache = null;
}

/** 保存目录监听：外部增删文件后让缓存失效并通知界面刷新 */
let libraryWatcher: FSWatcher | null = null;
let watchedDir = '';
let libraryWatchTimer: NodeJS.Timeout | null = null;

function stopLibraryWatcher(): void {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer);
    libraryWatchTimer = null;
  }
  libraryWatcher?.close();
  libraryWatcher = null;
  watchedDir = '';
}

/**
 * 递归监听保存目录。Windows 原生支持 recursive；
 * 监听失败（目录不存在、权限不足）时静默降级，仍可手动「重新扫描」。
 */
export function watchLibraryDir(outDir: string): void {
  const value = (outDir || '').trim();
  if (!value || !path.isAbsolute(value)) {
    stopLibraryWatcher();
    return;
  }
  const target = path.resolve(value);
  if (libraryWatcher && watchedDir === target) return;
  stopLibraryWatcher();
  try {
    const watcher = watch(
      target,
      { recursive: true, persistent: false },
      () => {
        // 下载与批量删除会连续触发大量事件，合并成一次刷新
        if (libraryWatchTimer) clearTimeout(libraryWatchTimer);
        libraryWatchTimer = setTimeout(() => {
          libraryWatchTimer = null;
          libraryCache = null;
          broadcast('library:changed', { at: Date.now() });
        }, 800);
      }
    );
    watcher.on('error', () => stopLibraryWatcher());
    libraryWatcher = watcher;
    watchedDir = target;
  } catch {
    libraryWatcher = null;
    watchedDir = '';
  }
}

export function toInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * 全局屏蔽：所有作品来源在返回前统一过一遍规则，
 * 保证「能在界面上看到的」和「能被下载的」是同一批作品。
 */
export function withoutBlocked<
  T extends {
    userId?: string;
    userName?: string;
    tags?: Array<string | { tag?: string }>;
  },
>(works: T[], config: AppConfig): T[] {
  return filterBlocked(works, blockRulesOf(config));
}

/**
 * 用户列表按屏蔽规则过滤。
 * 用户卡不是作品，走不到作品那道过滤器，必须单独过一遍——
 * 否则被屏蔽的画师还会出现在用户搜索、关注列表和推荐画师里。
 */
export function filterBlockedUsers<T extends { id: string; name: string }>(
  users: T[],
  config: AppConfig
): T[] {
  const rules = blockRulesOf(config);
  return users.filter(
    (user) => !isBlocked({ userId: user.id, userName: user.name }, rules)
  );
}

/** 动图格式只接受三个合法值，其它输入回退到 mp4 */
export function toUgoiraFormat(value: unknown): UgoiraFormat {
  return value === 'zip' || value === 'gif' ? value : 'mp4';
}

/** 媒体文件 MIME：渲染层据此决定用 <img> 还是 <video> 解 */
export const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * 动图帧内存缓存。
 *
 * 一帧就是一张完整插画，几十帧能到几十 MB，所以只留最近两份：
 * 够覆盖「来回点几个动图」的用法，也不会把内存顶起来。
 */
export const ugoiraFrameCache = new Map<string, UgoiraFrames>();

export function rememberUgoiraFrames(
  id: string,
  value: UgoiraFrames
): UgoiraFrames {
  // 重新插入一次，让它变成「最近使用」
  ugoiraFrameCache.delete(id);
  ugoiraFrameCache.set(id, value);
  while (ugoiraFrameCache.size > 2) {
    const oldest = ugoiraFrameCache.keys().next().value;
    if (!oldest) break;
    ugoiraFrameCache.delete(oldest);
  }
  return value;
}

/**
 * 渲染层传来的本地路径一律按「保存目录内」校验，与 pixivfile:// 协议同一套规则。
 * 预览接口能读文件字节，不设这个边界就等于把任意读盘能力开给了页面。
 */
export async function resolveInsideOutDir(raw: string): Promise<string> {
  const config = await loadConfig();
  const root = path.resolve(config.outDir);
  const target = path.resolve(String(raw || ''));
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('只能预览保存目录内的文件');
  }
  return target;
}

/** 作品栏目白名单：旧配置没有这个字段、或被手改成别的值时按「全部」处理 */
export function toContentKind(value: unknown): WorkContent {
  return contentKindOf(value);
}

/**
 * 关注画师批量同步抓的是「作者的作品」，收藏栏目对它没有意义：
 * 停在这一栏时按「全部」处理，避免把每位画师的收藏夹当成作品同步下来。
 */
export function toAuthorContent(value: unknown): AuthorContent {
  const content = toContentKind(value);
  return content === 'bookmarks' ? 'all' : content;
}

export function broadcast(
  channel: string,
  payload: unknown,
  sender?: WebContents
): void {
  const targets =
    sender && !sender.isDestroyed()
      ? [sender]
      : BrowserWindow.getAllWindows().map((win) => win.webContents);
  targets.forEach((contents) => {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  });
}

export async function pushQueue(sender?: WebContents): Promise<void> {
  broadcast('queue:changed', listSummaries(), sender);
  // 托盘菜单的进度与「全部暂停 / 继续」跟着队列走；窗口关进托盘后这是唯一的进度来源
  refreshTray();
}

/** 下载结束时同时做两件事：通知界面刷新，以及在窗口不在前台时发托盘提醒 */
function announceDone(
  send: (channel: string, payload: unknown) => void,
  summary: DownloadSummary
): void {
  send('download:done', summary);
  notifyDownloadDone(summary);
}

/** 暂停单个任务：运行中只中止它自己的 controller，排队中直接记为未完成 */
export async function pauseJobById(id: string): Promise<boolean> {
  const job = findJob(id);
  if (!job) return false;

  const run = activeRuns.get(id);
  if (run) {
    run.controller.abort('pause');
  } else {
    // 还没启动的排队任务没有 controller，直接把快照落成未完成
    upsertJob({
      ...job,
      status: 'paused',
      progress: { ...job.progress, phase: 'paused', finishedAt: Date.now() },
    });
  }
  return true;
}

/** 继续单个任务：放回队列，由调度器在额度允许时自动启动 */
export async function resumeJobById(
  id: string
): Promise<'ok' | 'missing' | 'running'> {
  const job = findJob(id);
  if (!job) return 'missing';
  if (activeRuns.has(id)) return 'running';
  // 整体继续时应重新尝试全部失败项，不能沿用之前「只重试一条」的范围
  upsertJob({
    ...job,
    status: 'queued',
    retry: undefined,
    error: undefined,
    progress: { ...job.progress, phase: 'idle', finishedAt: undefined },
  });
  return 'ok';
}

/** 托盘「全部暂停」：运行中与排队中的任务一起停下 */
export async function pauseAllJobs(): Promise<void> {
  await loadStore();
  const targets = listSummaries().filter(
    (job) =>
      job.status === 'queued' ||
      job.status === 'resolving' ||
      job.status === 'downloading'
  );
  for (const job of targets) await pauseJobById(job.id);
  await pushQueue();
}

/** 托盘「全部继续」：暂停 / 失败 / 取消过的任务一起重新入队 */
export async function resumeAllJobs(): Promise<void> {
  await loadStore();
  const targets = listSummaries().filter(
    (job) =>
      job.status === 'paused' ||
      job.status === 'error' ||
      job.status === 'cancelled'
  );
  for (const job of targets) await resumeJobById(job.id);
  await pushQueue();
  void pumpQueue();
}

async function executeJob(
  params: DownloadParams,
  sender?: WebContents,
  jobId?: string,
  retry?: { taskUrls?: string[]; illustIds?: string[] }
): Promise<DownloadSummary> {
  const config = await loadConfig();
  const limit = runningSlots(config);
  if (jobId && activeRuns.has(jobId)) throw new Error('该任务正在下载中');
  // 调度器会先把自己登记进 launching，这里要把它自己排除掉，否则串行模式下会误判为已满
  const self = jobId && launching.has(jobId) ? 1 : 0;
  if (activeRuns.size + launching.size - self >= limit) {
    // 额度被占满是「等一会儿再试」，不是任务失败：带上标记让调度器把它放回队列，
    // 否则一次并行竞态就会把整个任务标成 error，用户看到凭空出现的失败
    throw Object.assign(
      new Error(`并行任务已达上限（${limit} 个），请等待其中一个完成`),
      { retryLater: true }
    );
  }

  const { cookie } = await resolveCookie();
  if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤');

  const outDir = (params.outDir || config.outDir).trim();
  if (!outDir) throw new Error('未设置保存目录');
  if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径');

  const existing = jobId ? findJob(jobId) : undefined;
  if (jobId && !existing) throw new Error('任务不存在或已完成');

  const controller = new AbortController();
  const send = (channel: string, payload: unknown): void => {
    // 调度器自动启动的任务没有发起窗口，改为广播给所有窗口
    if (!sender || sender.isDestroyed()) broadcast(channel, payload);
    else sender.send(channel, payload);
  };
  const sendProgress = throttledProgress(send);

  const promise = runDownloadJob({
    works: params.works,
    tag: (params.tag || config.tag).trim() || config.tag,
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
    job: existing,
    retry,
    fileNameTemplate: config.fileNameTemplate,
    onProgress: (progress) => {
      sendProgress(progress);
      // 队列面板显示每个任务的实时计数，与主进度面板互不干扰
      scheduleQueuePush();
    },
    onItem: (item) => send('download:item', item),
  });

  const key = jobId || `run-${++runSeq}`;
  activeRuns.set(key, { controller, promise });
  // 登记进运行表后立刻退出「待启动」集合，否则运行期间会被两处重复计数，
  // 并行额度会被虚占一半，导致同时只能跑一个任务
  if (jobId) launching.delete(jobId);

  try {
    const summary = await promise;
    announceDone(send, summary);
    await pushQueue();
    libraryCache = null;
    return summary;
  } finally {
    activeRuns.delete(key);
    await pushQueue();
    // 任务结束腾出额度后，自动把队首任务拉起来
    void pumpQueue();
  }
}

/**
 * 已交给调度器、但还没登记到 activeRuns 的任务，
 * 防止同一轮调度里把同一个任务启动两次、或超出并行额度。
 */
const launching = new Set<string>();
let pumping = false;

function paramsOfJob(job: QueueJob, config: AppConfig): DownloadParams {
  return {
    works: job.works,
    tag: job.tag,
    outDir: job.outDir,
    // 入队时记下的并发与间隔优先：用户中途改设置不影响已排队的任务
    workers: job.workers ?? config.workers,
    delay: job.delay ?? config.delay,
    imageQuality: job.imageQuality,
    ugoiraFormat: job.ugoiraFormat,
  };
}

async function launchQueuedJob(
  job: QueueJob,
  config: AppConfig
): Promise<void> {
  launching.add(job.id);
  // 先落盘为 resolving，调度下一轮就不会再取到它；一次性重试范围同时清空
  upsertJob({ ...job, status: 'resolving', retry: undefined });
  let retryLater = false;
  try {
    await executeJob(paramsOfJob(job, config), undefined, job.id, job.retry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    retryLater = Boolean(
      (error as { retryLater?: boolean } | null)?.retryLater
    );
    const current = findJob(job.id);
    if (current && !activeRuns.has(job.id)) {
      if (retryLater) {
        // 只是没抢到并行额度：放回队列等下一轮，不能算任务失败
        upsertJob({
          ...current,
          status: 'queued',
          error: undefined,
          progress: { ...current.progress, phase: 'idle' },
        });
      } else {
        // 启动前就失败（模板非法、没配 Cookie、目录非法）：明确记成失败。
        // 以前这里写的是 paused，界面上和「用户暂停」完全一样，点继续也还是原地失败
        upsertJob({
          ...current,
          status: 'error',
          error: message,
          progress: {
            ...current.progress,
            phase: 'error',
            finishedAt: Date.now(),
          },
        });
      }
    }
    if (!retryLater) broadcast('queue:error', message);
  } finally {
    launching.delete(job.id);
    await pushQueue();
    // 没抢到额度时不要立刻重排：额度没变，重排只会空转
    if (!retryLater) void pumpQueue();
  }
}

/** 队列调度：只要有并行额度空出来，就自动启动队首任务 */
export async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const config = await loadConfig();
    const limit = runningSlots(config);
    while (activeRuns.size + launching.size < limit) {
      const next = listQueued().find((job) => !launching.has(job.id));
      if (!next) break;
      // launchQueuedJob 在第一个 await 之前就会标记 launching 并改写状态
      void launchQueuedJob(next, config);
    }
  } finally {
    pumping = false;
  }
}

/**
 * 批量同步：逐位画师「抓取 → 下载」。
 *
 * 串行执行：多位画师同时翻页最容易把接口打到 429。
 * 每位画师只取最新的一页（数量上限沿用「每页数量」），
 * 批量场景下全量拉取既慢又会拖很久。单条画师失败不中断整体。
 */
export async function executeBatch(
  params: BatchSyncParams,
  sender: WebContents
): Promise<BatchSyncSummary> {
  const artists = (params.artists || []).filter((item) => item && item.id);
  if (!artists.length) throw new Error('未选择画师');

  const config = await loadConfig();
  // 批量同步自身串行处理画师，但同样占用一个并行额度
  const limit = runningSlots(config);
  // 调度器刚取出、还没登记到 activeRuns 的任务也要算进额度
  if (activeRuns.size + launching.size >= limit) {
    throw new Error(`并行任务已达上限（${limit} 个），请等待其中一个完成`);
  }
  const { cookie } = await resolveCookie();
  if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤');

  const outDir = (params.outDir || config.outDir).trim();
  if (!outDir) throw new Error('未设置保存目录');
  if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径');

  const controller = new AbortController();
  const send = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  };
  const tag = (params.tag || config.tag).trim() || config.tag;
  const perArtist = toInt(config.limit, 48, 1, 100);
  const key = `batch-${++runSeq}`;

  const promise = (async (): Promise<BatchSyncSummary> => {
    const results: BatchArtistResult[] = [];
    let lastSummary: DownloadSummary | null = null;

    for (const [index, artist] of artists.entries()) {
      if (controller.signal.aborted) break;
      const progress: BatchSyncProgress = {
        index: index + 1,
        total: artists.length,
        artist,
        phase: 'collecting',
        works: 0,
        files: 0,
        failed: 0,
      };
      send('batch:progress', progress);

      try {
        const collected = await collectWorks({
          userId: artist.id,
          tag,
          contentKind: toAuthorContent(config.contentKind),
          tagExtra: config.tagExtra,
          tagExclude: config.tagExclude,
          tagMode: config.tagMode,
          offset: 0,
          limit: perArtist,
          workers: 1,
          maxWorks: perArtist,
          cookie,
          signal: controller.signal,
          onProgress: (item) =>
            send('batch:progress', { ...progress, works: item.loaded }),
        });
        const works = withoutBlocked(collected.works, config).slice(
          0,
          perArtist
        );
        progress.works = works.length;
        send('batch:progress', { ...progress });

        if (works.length === 0) {
          results.push({ artist, works: 0, files: 0, failed: 0 });
          send('batch:progress', { ...progress, phase: 'done' });
          continue;
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
          ugoiraFormat: toUgoiraFormat(
            params.ugoiraFormat ?? config.ugoiraFormat
          ),
          cookie,
          signal: controller.signal,
          fileNameTemplate: config.fileNameTemplate,
          onProgress: (item) => {
            progress.phase = 'downloading';
            progress.files = item.done;
            progress.failed = item.failed;
            send('download:progress', item);
            send('batch:progress', { ...progress });
          },
          onItem: (item) => send('download:item', item),
        });
        lastSummary = summary;
        results.push({
          artist,
          works: works.length,
          files: summary.done,
          failed: summary.failed + summary.resolveFailed,
        });
        send('batch:progress', { ...progress, phase: 'done' });
      } catch (error) {
        // 用户取消属于正常收尾，不再记成失败
        if (controller.signal.aborted) break;
        results.push({
          artist,
          works: progress.works,
          files: progress.files,
          failed: progress.failed,
          error: error instanceof Error ? error.message : String(error),
        });
        send('batch:progress', { ...progress, phase: 'failed' });
      }
    }

    if (lastSummary && !controller.signal.aborted)
      announceDone(send, lastSummary);
    await pushQueue();
    libraryCache = null;

    const ok = results.filter((item) => !item.error).length;
    return {
      artists: results,
      total: artists.length,
      ok,
      failed: results.length - ok,
      aborted: controller.signal.aborted,
    };
  })();

  activeRuns.set(key, { controller, promise });
  try {
    return await promise;
  } finally {
    activeRuns.delete(key);
    await pushQueue();
    // 批量结束后同样释放额度，让排队任务补位
    void pumpQueue();
  }
}

/**
 * 退出前调用：中止正在运行的任务并等待其把状态落盘。
 * 带上 shutdown 原因，任务会落成「未完成」而不是「已取消」——
 * 关软件不是用户取消，下次启动应该能直接继续。
 */
export async function shutdownActiveJob(): Promise<void> {
  const runs = [...activeRuns.values()];
  runs.forEach((run) => run.controller.abort('shutdown'));
  await Promise.allSettled(runs.map((run) => run.promise));
}
