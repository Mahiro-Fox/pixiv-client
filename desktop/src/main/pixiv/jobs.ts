import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  DownloadItemEvent,
  DownloadParams,
  DownloadPhase,
  DownloadProgress,
  DownloadSummary,
  ImageQuality,
  PixivWork,
  QueueJob,
  QueueStatus,
  QueueTask,
  UgoiraFormat
} from '../../shared/types'
import { flushQueue, dropJobIfDone } from '../queue'
import { flushHistory, recordHistory } from '../history'
import { DEFAULT_FILE_TEMPLATE, validateTemplate } from '../../shared/template'
import { fetchPages, fetchUgoiraMeta } from './api'
import {
  buildAuthorDir,
  buildDest,
  isComplete,
  safeName,
  satisfiesQuality
} from './files'
import { convertUgoira, isFfmpegAvailable, type UgoiraTarget } from './ugoira'
import { downloadFile, sleep } from './http'
import { mapPool } from './pool'
import {
  CONSECUTIVE_FAILURE_LIMIT,
  TASK_MAX_ATTEMPTS,
  abortReasonOf,
  classifyError,
  shouldRetryTask,
  taskBackoffMs
} from './retry'

export interface DownloadJobOptions extends DownloadParams {
  cookie: string
  signal: AbortSignal
  /** 文件名模板，缺省用默认模板 */
  fileNameTemplate?: string
  /** 下载质量，缺省为常规图 */
  imageQuality?: ImageQuality
  /** 传入已有任务快照即表示断点续传 */
  job?: QueueJob
  /**
   * 只重试指定的失败项（不传则重试该任务的全部失败项）：
   * `taskUrls` 匹配图片任务，`illustIds` 匹配解析失败的作品。
   */
  retry?: { taskUrls?: string[]; illustIds?: string[] }
  onProgress: (progress: DownloadProgress) => void
  onItem: (item: DownloadItemEvent) => void
}

/** 按质量挑图片地址：高清原图缺失时回退常规图，常规图缺失时回退原图 */
function pickImageUrl(
  urls: Record<string, string> | undefined,
  quality: ImageQuality
): string {
  if (!urls) return ''
  if (quality === 'original') return urls.original || urls.regular || ''
  return urls.regular || urls.original || ''
}

/**
 * 已存在文件是否不满足当前下载质量。
 * 常规图与高清原图共用同一文件名，只能按像素尺寸区分；
 * 尺寸未知（旧快照/动图 zip）或无法解析时不做覆盖。
 */
async function needsReplacement(task: QueueTask, quality: ImageQuality): Promise<boolean> {
  const ok = await satisfiesQuality(
    task.dest,
    task.width || 0,
    task.height || 0,
    quality
  )
  return !ok
}

/** 动图最终落盘扩展名：保留压缩包时为 .zip，否则与目标格式一致 */
function ugoiraExt(format: UgoiraFormat): string {
  return format === 'zip' ? '.zip' : `.${format}`
}

/**
 * 动图任务：先把帧压缩包下载到同目录临时文件，再用 ffmpeg 转码成 mp4 / gif。
 * 转码成功后才写入最终路径，临时 zip 无论成败都会被清理。
 */
async function downloadUgoiraTask(
  task: QueueTask,
  format: UgoiraTarget,
  cookie: string,
  signal: AbortSignal
): Promise<number> {
  const zipPath = path.join(path.dirname(task.dest), `.ugoira-${task.illustId}.zip`)
  try {
    await downloadFile(task.url, zipPath, cookie, { signal })
    await convertUgoira({
      zipPath,
      destPath: task.dest,
      frames: task.frames || [],
      format,
      signal
    })
    const info = await stat(task.dest)
    return info.size
  } finally {
    await rm(zipPath, { force: true }).catch(() => undefined)
    await rm(`${zipPath}.part`, { force: true }).catch(() => undefined)
  }
}

function emptyProgress(totalWorks: number, startedAt: number, jobId?: string): DownloadProgress {
  return {
    jobId,
    phase: 'resolving',
    total: 0,
    done: 0,
    ok: 0,
    exists: 0,
    failed: 0,
    resolveFailed: 0,
    bytes: 0,
    resolvedWorks: 0,
    totalWorks,
    startedAt
  }
}

/** 从任务快照重建计数，用于续传时接着显示进度 */
function rebuildProgress(job: QueueJob, startedAt: number): DownloadProgress {
  const counted = job.tasks.filter((task) => task.status !== 'pending')
  const resolvedIds = new Set(job.tasks.map((task) => task.illustId))
  return {
    jobId: job.id,
    phase: 'downloading',
    total: job.tasks.length,
    done: counted.length,
    ok: counted.filter((task) => task.status === 'ok').length,
    exists: counted.filter((task) => task.status === 'exists').length,
    failed: counted.filter((task) => task.status === 'failed').length,
    resolveFailed: 0,
    bytes: counted.reduce((sum, task) => sum + (task.bytes || 0), 0),
    resolvedWorks: resolvedIds.size,
    totalWorks: job.works.length,
    startedAt
  }
}

function statusOf(phase: DownloadPhase): QueueStatus {
  if (phase === 'idle') return 'queued'
  if (phase === 'resolving') return 'resolving'
  if (phase === 'downloading') return 'downloading'
  if (phase === 'paused') return 'paused'
  if (phase === 'cancelled') return 'cancelled'
  if (phase === 'error') return 'error'
  return 'done'
}

/**
 * 传输层单次尝试次数。
 * 任务级重试还会再给 2 次机会，两层叠加最多 6 次请求；
 * 压到 2 次是为了让失败更快冒到任务层，用更长的退避替换密集的短重试。
 */
const TRANSPORT_ATTEMPTS = 2

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.replace(/\s+/g, ' ').slice(0, 200)
}

/**
 * 连续失败熔断。
 *
 * 零星的失败是网络抖动，重试就好；但连续 8 项都失败说明是系统性问题
 * （Cookie 失效、代理挂了、磁盘写不进去），继续跑只会把剩余作品全部标成失败、
 * 还要多花几分钟。命中后停止启动新任务，已下载的文件全部保留。
 *
 * 只统计「本该成功却失败」的类别：作品被删除（missing）、没有权限（forbidden）
 * 属于单条数据的确定性结果，收藏夹里本来就常见，不该因为几十个失效作品就中止整批。
 */
const SYSTEMIC_KINDS = new Set(['auth', 'network', 'server', 'rate-limit', 'unknown'])

interface Breaker {
  consecutive: number
  /** 命中后写入中止原因，作为任务级 error 展示 */
  tripped: string | null
}

function markSuccess(breaker: Breaker): void {
  breaker.consecutive = 0
}

function markFailure(breaker: Breaker, error: unknown): void {
  if (breaker.tripped) return
  const hint = classifyError(error)
  if (!SYSTEMIC_KINDS.has(hint.kind)) return
  breaker.consecutive += 1
  if (breaker.consecutive >= CONSECUTIVE_FAILURE_LIMIT) {
    breaker.tripped = `连续 ${breaker.consecutive} 项失败，已中止剩余任务（最后一次：${messageOf(error)}）`
  }
}

/** status 为 error 时的原因摘要：熔断说明优先，否则按失败类型统计 */
function errorSummary(breaker: Breaker, progress: DownloadProgress): string {
  if (breaker.tripped) return breaker.tripped
  const parts: string[] = []
  if (progress.failed > 0) parts.push(`${progress.failed} 个文件下载失败`)
  if (progress.resolveFailed > 0) parts.push(`${progress.resolveFailed} 个作品解析失败`)
  return parts.length ? `${parts.join('，')}，可展开任务查看清单` : '任务未完成'
}

/**
 * 从作品集合推导任务归属：
 * 全部来自同一作者时给出「{userId}-{userName}」，否则退化为「N 位作者」。
 * 作品列表来自收藏夹或多标签时会命中后者。
 */
export function artistOf(works: PixivWork[]): { artistId?: string; artistLabel: string } {
  const authors = new Map<string, string>()
  for (const work of works) {
    const id = String(work.userId || '').trim()
    if (!id) continue
    if (!authors.has(id)) authors.set(id, work.userName || id)
  }
  if (authors.size === 1) {
    const [id, name] = [...authors.entries()][0]
    return { artistId: id, artistLabel: `${id}-${name}` }
  }
  return { artistLabel: `${authors.size} 位作者` }
}

/** 排队任务的构造参数：只保存启动所需的最小信息，其余在启动时读当前配置 */
export interface QueuedJobOptions {
  works: PixivWork[]
  tag: string
  outDir: string
  imageQuality: ImageQuality
  ugoiraFormat: UgoiraFormat
  workers: number
  delay: number
  retry?: { taskUrls?: string[]; illustIds?: string[] }
}

/** 新建一个「排队中」的任务快照，不立即开始下载 */
export function createQueuedJob(options: QueuedJobOptions): QueueJob {
  const id = randomUUID()
  const startedAt = Date.now()
  const artist = artistOf(options.works)
  return {
    id,
    tag: options.tag,
    outDir: options.outDir,
    rootDir: path.join(options.outDir, safeName(options.tag, 'tag')),
    imageQuality: options.imageQuality,
    ugoiraFormat: options.ugoiraFormat,
    status: 'queued',
    createdAt: startedAt,
    updatedAt: startedAt,
    works: options.works,
    tasks: [],
    resolveFailures: [],
    progress: { ...emptyProgress(options.works.length, startedAt, id), phase: 'idle' },
    workers: options.workers,
    delay: options.delay,
    retry: options.retry,
    artistId: artist.artistId,
    artistLabel: artist.artistLabel
  }
}

function createJob(options: DownloadJobOptions, works: PixivWork[], startedAt: number): QueueJob {
  const id = randomUUID()
  const artist = artistOf(works)
  return {
    id,
    tag: options.tag,
    outDir: options.outDir,
    rootDir: path.join(options.outDir, safeName(options.tag, 'tag')),
    imageQuality: options.imageQuality || 'regular',
    ugoiraFormat: options.ugoiraFormat || 'mp4',
    status: 'resolving',
    createdAt: startedAt,
    updatedAt: startedAt,
    works,
    tasks: [],
    resolveFailures: [],
    progress: emptyProgress(works.length, startedAt, id),
    artistId: artist.artistId,
    artistLabel: artist.artistLabel
  }
}

export async function runDownloadJob(options: DownloadJobOptions): Promise<DownloadSummary> {
  const templateError = validateTemplate(options.fileNameTemplate || DEFAULT_FILE_TEMPLATE)
  if (templateError) throw new Error(`文件名模板无效：${templateError}`)

  const startedAt = Date.now()
  const workers = Math.max(1, Math.min(32, options.workers))
  const works = options.works?.length ? options.works : (options.job?.works ?? [])

  const resumed = Boolean(options.job)
  const job = options.job ? { ...options.job, works } : createJob(options, works, startedAt)
  const rootDir = job.rootDir
  const quality: ImageQuality = job.imageQuality || options.imageQuality || 'regular'
  const requestedUgoira: UgoiraFormat = job.ugoiraFormat || options.ugoiraFormat || 'mp4'
  // 缺少 ffmpeg 时退回保留压缩包，避免动图作品整体下载失败
  const ugoiraFormat: UgoiraFormat =
    requestedUgoira !== 'zip' && !isFfmpegAvailable() ? 'zip' : requestedUgoira
  job.ugoiraFormat = ugoiraFormat
  // 重新开始的任务先清掉上一次的原因摘要，跑完时按当前结果重写
  job.error = undefined

  // 续传：上次失败的图片重新排队；已在本地且完整的图片在下面单独校验。
  // 指定了 retry 时只放行命中的那一项，其余失败保持原状，避免「重试一条」变成「重试全部」
  const retryUrls = new Set(options.retry?.taskUrls || [])
  const retryIllustIds = new Set(options.retry?.illustIds || [])
  job.tasks.forEach((task) => {
    if (task.status !== 'failed') return
    const targeted = options.retry
      ? retryUrls.has(task.url) ||
        (!retryUrls.size && retryIllustIds.has(task.illustId))
      : true
    if (!targeted) return
    task.status = 'pending'
    task.error = undefined
    task.attempts = undefined
  })

  const progress = resumed
    ? rebuildProgress(job, startedAt)
    : emptyProgress(works.length, startedAt, job.id)

  const emit = (): void => options.onProgress({ ...progress })
  const persist = (): void => {
    job.status = statusOf(progress.phase)
    job.progress = { ...progress }
    dropJobIfDone(job)
  }
  emit()
  persist()

  const settledIds = new Set(job.tasks.map((task) => task.illustId))
  let pendingWorks = works.filter((work) => !settledIds.has(String(work.id || '').trim()))
  // 单条重试时只重新解析被指定的作品，其余解析失败项留到「全部重试」时再处理
  if (options.retry) {
    pendingWorks = pendingWorks.filter((work) =>
      retryIllustIds.has(String(work.id || '').trim())
    )
  }

  // 这些作品即将重新解析：先清掉它们上一次的解析失败记录，避免重复累积
  const retryIds = new Set(pendingWorks.map((work) => String(work.id || '').trim()))
  job.resolveFailures = (job.resolveFailures || []).filter(
    (item) => !retryIds.has(item.illustId)
  )

  /** 连续性失败计数器：解析与下载共用，成功一项就清零 */
  const breaker: Breaker = { consecutive: 0, tripped: null }

  if (pendingWorks.length > 0) {
    progress.phase = 'resolving'
    emit()

    await mapPool(
      pendingWorks,
      workers,
      async (work: PixivWork) => {
        if (options.signal.aborted || breaker.tripped) return
        if (options.delay > 0) await sleep(options.delay * 1000)

        const illustId = String(work.id || '').trim()
        try {
          if (!illustId) throw new Error('缺少 id')
          const authorDir = buildAuthorDir(rootDir, work.userId, work.userName)
          let added = 0

          // 动图（ugoira）：pixiv 只提供帧压缩包。
          // 保留 zip 时直接落盘；mp4 / gif 先把 zip 下载到临时文件再转码。
          if (Number(work.illustType) === 2) {
            const meta = await fetchUgoiraMeta(illustId, options.cookie, options.signal)
            const dest = buildDest(authorDir, {
              illustId,
              title: work.title,
              userId: work.userId,
              userName: work.userName,
              tag: options.job?.tag || options.tag,
              createDate: work.createDate,
              pageIndex: 0,
              url: meta.zipUrl,
              ext: ugoiraExt(ugoiraFormat),
              quality,
              template: options.fileNameTemplate
            })
            job.tasks.push({
              illustId,
              url: meta.zipUrl,
              dest,
              label: path.relative(rootDir, dest),
              page: 0,
              frames: meta.frames,
              ugoira: true,
              status: 'pending',
              bytes: 0
            })
            added = 1
          } else {
            const pages = await fetchPages(illustId, options.cookie, options.signal)

            pages.forEach((page, index) => {
              const url = pickImageUrl(page.urls, quality)
              if (!url) return
              const dest = buildDest(authorDir, {
                illustId,
                title: work.title,
                userId: work.userId,
                userName: work.userName,
                tag: options.job?.tag || options.tag,
                createDate: work.createDate,
                pageIndex: index,
                url,
                quality,
                template: options.fileNameTemplate
              })
              job.tasks.push({
                illustId,
                url,
                dest,
                label: path.relative(rootDir, dest),
                page: index,
                width: Number(page.width || 0),
                height: Number(page.height || 0),
                status: 'pending',
                bytes: 0
              })
              added += 1
            })
          }

          if (!added) throw new Error('无可用图片地址')
          markSuccess(breaker)
        } catch (error) {
          if (!options.signal.aborted) {
            const hint = classifyError(error)
            progress.resolveFailed += 1
            job.resolveFailures = [
              ...(job.resolveFailures || []).filter((item) => item.illustId !== illustId),
              {
                illustId,
                title: work.title,
                error: messageOf(error),
                retryable: hint.retryable
              }
            ]
            markFailure(breaker, error)
            options.onItem({
              status: 'failed',
              label: `${illustId || '未知作品'} 解析失败`,
              bytes: 0,
              error: String(error)
            })
          }
        } finally {
          progress.resolvedWorks += 1
          emit()
          persist()
        }
      },
      options.signal
    )
  }

  // 续传时校验已完成的任务，文件被删掉或尺寸与当前质量不符的重新排队
  if (resumed && !options.signal.aborted) {
    await mapPool(
      job.tasks,
      workers,
      async (task: QueueTask) => {
        if (task.status !== 'ok' && task.status !== 'exists') return
        const complete = await isComplete(task.dest)
        if (complete && !(await needsReplacement(task, quality))) return
        const wasOk = task.status === 'ok'
        task.status = 'pending'
        progress.done = Math.max(0, progress.done - 1)
        progress.bytes = Math.max(0, progress.bytes - (task.bytes || 0))
        if (wasOk) progress.ok = Math.max(0, progress.ok - 1)
        else progress.exists = Math.max(0, progress.exists - 1)
        task.bytes = 0
      },
      options.signal
    )
    emit()
  }

  if (!options.signal.aborted) {
    progress.phase = 'downloading'
    progress.total = job.tasks.length
    emit()
    persist()

    const workById = new Map(works.map((work) => [String(work.id || '').trim(), work]))

    await mapPool(
      job.tasks.filter((task) => task.status === 'pending'),
      workers,
      async (task: QueueTask) => {
        // 熔断后不再启动新任务：剩下的保持 pending，继续任务时可以接着下
        if (options.signal.aborted || breaker.tripped) return
        if (options.delay > 0) await sleep(options.delay * 1000)

        let replaced = false
        let attempts = 0
        let lastError: unknown

        while (attempts < TASK_MAX_ATTEMPTS) {
          attempts += 1
          replaced = false
          try {
            const complete = await isComplete(task.dest)
            if (complete && !(await needsReplacement(task, quality))) {
              task.status = 'exists'
              task.bytes = 0
            } else if (task.ugoira && ugoiraFormat !== 'zip') {
              replaced = complete
              task.bytes = await downloadUgoiraTask(
                task,
                ugoiraFormat,
                options.cookie,
                options.signal
              )
              task.status = 'ok'
            } else {
              replaced = complete
              task.bytes = await downloadFile(task.url, task.dest, options.cookie, {
                signal: options.signal,
                attempts: TRANSPORT_ATTEMPTS
              })
              task.status = 'ok'
            }
            task.error = undefined
            lastError = undefined
            break
          } catch (error) {
            if (options.signal.aborted) return
            lastError = error
            const hint = classifyError(error)
            // 确定性错误（404 / 403 / 401）一次就放弃；网络与服务端错误退避后再来
            if (!shouldRetryTask(hint, attempts)) break
            await sleep(taskBackoffMs(attempts, hint))
            if (options.signal.aborted) return
          }
        }

        task.attempts = attempts
        if (lastError !== undefined) {
          task.status = 'failed'
          task.bytes = 0
          task.error = messageOf(lastError)
          markFailure(breaker, lastError)
        } else {
          markSuccess(breaker)
        }

        progress.done += 1
        if (task.status === 'ok') {
          progress.ok += 1
          progress.bytes += task.bytes
        } else if (task.status === 'exists') {
          progress.exists += 1
        } else {
          progress.failed += 1
        }
        emit()
        persist()

        options.onItem({
          jobId: job.id,
          status:
            task.status === 'ok' && replaced
              ? 'replaced'
              : (task.status as DownloadItemEvent['status']),
          label: task.label,
          bytes: task.bytes,
          error: task.error
        })

        // 已成功的文件写入下载历史索引，供本地图库展示标题、作者等信息
        if (task.status === 'ok' || task.status === 'exists') {
          const work = workById.get(task.illustId)
          if (work) {
            recordHistory({
              illustId: task.illustId,
              title: work.title || `作品 ${task.illustId}`,
              userId: work.userId || '',
              userName: work.userName || '',
              tag: job.tag,
              page: task.page ?? 0,
              path: task.dest,
              bytes: task.bytes,
              ugoira: Number(work.illustType) === 2,
              at: Date.now()
            })
          }
        }
      },
      options.signal
    )
  }

  // 结束态四选一：完成 / 暂停 / 取消 / 失败。
  // 之前只看「有没有被 abort」，取消和暂停、以及「跑完但有失败项」全都落到 paused，
  // 界面上三种完全不同的处境长得一模一样，用户没法判断该点「继续」还是该看失败清单。
  const aborted = options.signal.aborted
  const abortReason = aborted ? abortReasonOf(options.signal) : undefined
  // 单条重试时会出现「本次没处理的解析失败」，进度需以任务里实际残留的失败为准，
  // 否则会误判为全部完成而把任务从队列移除
  progress.resolveFailed = (job.resolveFailures || []).length
  const hasPending = job.tasks.some((task) => task.status === 'pending')
  const complete =
    !aborted && !hasPending && progress.failed === 0 && progress.resolveFailed === 0

  let phase: DownloadPhase
  if (complete) phase = 'done'
  else if (aborted) phase = abortReason === 'cancel' ? 'cancelled' : 'paused'
  else phase = 'error'

  progress.phase = phase
  // 记下结束时间，界面「用时」停止增长（否则切换标签页触发的重渲染会让数字继续变大）
  progress.finishedAt = Date.now()
  emit()
  job.status = statusOf(phase)
  job.progress = { ...progress }
  job.error = phase === 'error' ? errorSummary(breaker, progress) : undefined
  dropJobIfDone(job)
  await flushQueue()
  await flushHistory()

  return {
    ...progress,
    jobId: job.id,
    outDir: rootDir,
    elapsedMs: Date.now() - startedAt,
    paused: aborted,
    abortReason
  }
}
