import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FailureItem, QueueJob, QueueSummary, QueueTask } from '../shared/types'

/**
 * 下载队列持久化：把任务快照写到 userData/queue.json。
 *
 * - 原子写：先写 .tmp 再 rename，避免进程被杀时留下半个 JSON
 * - 防抖 500ms：下载过程中每个文件都会更新状态，不能每次都落盘
 * - 退出前调用 flushQueue() 强制落盘
 */

const SAVE_DEBOUNCE = 500

interface QueueStore {
  jobs: QueueJob[]
}

/** 上次运行中被中断的任务，重启后一律视为「已暂停」 */
const RUNNING_STATUS: QueueJob['status'][] = ['resolving', 'downloading']

let store: QueueStore = { jobs: [] }
let loaded = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> = Promise.resolve()

function queueFile(): string {
  return path.join(app.getPath('userData'), 'queue.json')
}

function normalizeJob(job: QueueJob): QueueJob {
  // 上次运行中被中断、或仍在排队没来得及启动的任务，重启后一律视为「已暂停」
  const interrupted = RUNNING_STATUS.includes(job.status) || job.status === 'queued'
  const status: QueueJob['status'] = interrupted ? 'paused' : job.status
  return {
    ...job,
    status,
    tasks: Array.isArray(job.tasks) ? job.tasks.map(normalizeTask) : [],
    works: Array.isArray(job.works) ? job.works : [],
    resolveFailures: Array.isArray(job.resolveFailures) ? job.resolveFailures : [],
    progress: { ...job.progress, phase: status === 'paused' ? 'paused' : job.progress.phase }
  }
}

function normalizeTask(task: QueueTask): QueueTask {
  // 上次没跑完的：失败与进行中的都重置为等待，交给恢复流程决定是否重下
  if (task.status === 'failed') return { ...task, status: 'pending', error: undefined }
  return task
}

export async function loadStore(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await readFile(queueFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<QueueStore>
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : []
    store = {
      jobs: jobs
        .filter((job) => job && typeof job.id === 'string')
        .map(normalizeJob)
        .filter((job) => job.status !== 'done')
    }
  } catch {
    store = { jobs: [] }
  }
}

export function findJob(id: string): QueueJob | undefined {
  return store.jobs.find((job) => job.id === id)
}

export function upsertJob(job: QueueJob): void {
  const next: QueueJob = { ...job, updatedAt: Date.now() }
  const index = store.jobs.findIndex((item) => item.id === job.id)
  if (index >= 0) store.jobs[index] = next
  else store.jobs.push(next)
  scheduleSave()
}

export function removeJob(id: string): void {
  store.jobs = store.jobs.filter((job) => job.id !== id)
  scheduleSave()
}

/** 任务全部完成、没有失败项时，从队列里移除，避免队列文件无限增长 */
export function dropJobIfDone(job: QueueJob): void {
  if (job.status === 'done') removeJob(job.id)
  else upsertJob(job)
}

function toSummary(job: QueueJob): QueueSummary {
  const tasks = job.tasks
  return {
    id: job.id,
    tag: job.tag,
    rootDir: job.rootDir,
    status: job.status,
    phase: job.progress?.phase ?? 'idle',
    artistId: job.artistId,
    artistLabel: job.artistLabel,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    totalWorks: job.works.length,
    total: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    ok: tasks.filter((task) => task.status === 'ok').length,
    exists: tasks.filter((task) => task.status === 'exists').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    resolveFailed: (job.resolveFailures || []).length,
    bytes: tasks.reduce((sum, task) => sum + (task.bytes || 0), 0)
  }
}

/**
 * 汇总某个任务的失败清单：图片下载失败 + 作品解析失败。
 * 图片失败按作品 ID 归组，便于用户按作品重试或定位。
 */
export function listFailures(jobId: string): FailureItem[] {
  const job = findJob(jobId)
  if (!job) return []

  const images: FailureItem[] = job.tasks
    .filter((task) => task.status === 'failed')
    .map((task) => ({
      kind: 'image',
      illustId: task.illustId,
      label: task.label,
      error: task.error || '未知错误',
      url: task.url
    }))

  const works: FailureItem[] = (job.resolveFailures || []).map((item) => ({
    kind: 'work',
    illustId: item.illustId,
    label: `${item.illustId || '未知作品'} ${item.title || ''}`.trim(),
    error: item.error
  }))

  return [...works, ...images]
}

/** 排队等待启动的任务，按入队顺序返回 */
export function listQueued(): QueueJob[] {
  return store.jobs
    .filter((job) => job.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 仍在流程中的任务（排队 / 解析 / 下载），用于入队去重与运行态判断 */
export function listActiveJobs(): QueueJob[] {
  return store.jobs.filter(
    (job) => job.status === 'queued' || RUNNING_STATUS.includes(job.status)
  )
}

export function listSummaries(): QueueSummary[] {
  return store.jobs
    .filter((job) => job.status !== 'done')
    .map(toSummary)
    // 按入队顺序固定排列：若按 updatedAt 排序，并行任务每次进度更新都会互换位置
    .sort((a, b) => a.createdAt - b.createdAt)
}

function scheduleSave(): void {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void persist()
  }, SAVE_DEBOUNCE)
}

async function persist(): Promise<void> {
  if (!dirty) return
  dirty = false
  const payload = JSON.stringify({ jobs: store.jobs }, null, 2)

  writing = writing
    .then(async () => {
      const file = queueFile()
      const tmp = `${file}.tmp`
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(tmp, payload, 'utf-8')
      await rename(tmp, file)
    })
    .catch(() => undefined)

  return writing
}

/** 退出前强制落盘 */
export async function flushQueue(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await persist()
}
