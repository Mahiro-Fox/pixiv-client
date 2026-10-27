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

export interface DownloadJobOptions extends DownloadParams {
  cookie: string
  signal: AbortSignal
  /** 文件名模板，缺省用默认模板 */
  fileNameTemplate?: string
  /** 下载质量，缺省为常规图 */
  imageQuality?: ImageQuality
  /** 传入已有任务快照即表示断点续传 */
  job?: QueueJob
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

function emptyProgress(totalWorks: number, startedAt: number): DownloadProgress {
  return {
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
  if (phase === 'resolving') return 'resolving'
  if (phase === 'downloading') return 'downloading'
  if (phase === 'paused') return 'paused'
  return 'done'
}

function createJob(options: DownloadJobOptions, works: PixivWork[], startedAt: number): QueueJob {
  return {
    id: randomUUID(),
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
    progress: emptyProgress(works.length, startedAt)
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

  // 续传：上次失败的图片重新排队；已在本地且完整的图片在下面单独校验
  job.tasks.forEach((task) => {
    if (task.status === 'failed') {
      task.status = 'pending'
      task.error = undefined
    }
  })

  const progress = resumed
    ? rebuildProgress(job, startedAt)
    : emptyProgress(works.length, startedAt)

  const emit = (): void => options.onProgress({ ...progress })
  const persist = (): void => {
    job.status = statusOf(progress.phase)
    job.progress = { ...progress }
    dropJobIfDone(job)
  }
  emit()
  persist()

  const settledIds = new Set(job.tasks.map((task) => task.illustId))
  const pendingWorks = works.filter((work) => !settledIds.has(String(work.id || '').trim()))

  // 这些作品即将重新解析：先清掉它们上一次的解析失败记录，避免重复累积
  const retryIds = new Set(pendingWorks.map((work) => String(work.id || '').trim()))
  job.resolveFailures = (job.resolveFailures || []).filter(
    (item) => !retryIds.has(item.illustId)
  )

  if (pendingWorks.length > 0) {
    progress.phase = 'resolving'
    emit()

    await mapPool(
      pendingWorks,
      workers,
      async (work: PixivWork) => {
        if (options.signal.aborted) return
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
        } catch (error) {
          if (!options.signal.aborted) {
            progress.resolveFailed += 1
            job.resolveFailures = [
              ...(job.resolveFailures || []).filter((item) => item.illustId !== illustId),
              { illustId, title: work.title, error: String(error) }
            ]
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
        if (options.signal.aborted) return
        if (options.delay > 0) await sleep(options.delay * 1000)

        let replaced = false
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
              signal: options.signal
            })
            task.status = 'ok'
          }
          task.error = undefined
        } catch (error) {
          if (options.signal.aborted) return
          task.status = 'failed'
          task.bytes = 0
          task.error = String(error)
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

  const paused = options.signal.aborted
  const hasPending = job.tasks.some((task) => task.status === 'pending')
  const complete =
    !paused && !hasPending && progress.failed === 0 && progress.resolveFailed === 0
  progress.phase = complete ? 'done' : 'paused'
  // 记下结束时间，界面「用时」停止增长（否则切换标签页触发的重渲染会让数字继续变大）
  progress.finishedAt = Date.now()
  emit()
  job.status = statusOf(progress.phase)
  job.progress = { ...progress }
  dropJobIfDone(job)
  await flushQueue()
  await flushHistory()

  return {
    ...progress,
    jobId: job.id,
    outDir: rootDir,
    elapsedMs: Date.now() - startedAt,
    paused
  }
}
