import type { Dispatch, SetStateAction } from 'react'
import type {
  AppConfig,
  DownloadItemEvent,
  FailureItem,
  PixivWork,
  QueueSummary
} from '@shared/types'
import { messageOf } from './errors'
import { toast } from './toast'
import { worksTag } from './files'
import { translate } from '../i18n'
import type { Translate } from '../i18n'

export interface UseQueueActionsOptions {
  config: AppConfig | null
  selectedWorks: PixivWork[]
  setQueue: Dispatch<SetStateAction<QueueSummary[]>>
  /** 入队前清空上一轮的下载日志 */
  setItems: Dispatch<SetStateAction<DownloadItemEvent[]>>
  setError: (message: string) => void
  setNotice: (message: string) => void
  setTab: Dispatch<SetStateAction<string>>
}

export interface QueueActionsState {
  startDownload: () => Promise<void>
  cancelBatch: () => void
  pauseQueue: (id: string) => Promise<void>
  cancelQueue: (id: string) => Promise<void>
  resumeQueue: (id: string) => Promise<void>
  retryFailure: (id: string, item: FailureItem) => Promise<void>
  removeQueue: (id: string) => Promise<void>
  exportFailures: (id: string) => Promise<void>
}

/**
 * 下载队列操作：入队、暂停 / 取消 / 继续 / 重试 / 移除，以及失败清单导出。
 *
 * 队列数据本身由主进程在每次操作后整份返回，这里直接替换，
 * 不本地推演状态——避免与主进程的并行调度产生分歧。
 */
export function useQueueActions(options: UseQueueActionsOptions): QueueActionsState {
  const { config, selectedWorks, setQueue, setItems, setError, setNotice, setTab } = options

  const t: Translate = (key, params) => translate(config?.locale ?? 'zh-CN', key, params)

  /** 加入下载队列：立即返回，任务由主进程按并行额度自动启动 */
  const startDownload = async (): Promise<void> => {
    if (!config) return
    if (selectedWorks.length === 0) {
      toast.info(t('app.selectFirst'))
      return
    }
    setError('')
    setItems([])
    setTab('tasks')
    try {
      await window.pixiv.setConfig(config)
      setQueue(
        await window.pixiv.enqueueDownload({
          works: selectedWorks,
          tag: worksTag(config),
          outDir: config.outDir,
          workers: config.workers,
          delay: config.delay,
          imageQuality: config.imageQuality,
          ugoiraFormat: config.ugoiraFormat
        })
      )
      setNotice(t('app.enqueued', { count: selectedWorks.length }))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 批量同步是长任务、不进入队列，保留独立的中止入口（只停批量，不碰队列） */
  const cancelBatch = (): void => {
    void window.pixiv.cancelBatch()
  }

  /** 暂停单个任务：运行中只中止它自己，排队中直接转为未完成 */
  const pauseQueue = async (id: string): Promise<void> => {
    setError('')
    try {
      setQueue(await window.pixiv.pauseQueue(id))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 取消单个任务：保留已下载文件，任务留在列表里显示「已取消」，可重新开始 */
  const cancelQueue = async (id: string): Promise<void> => {
    setError('')
    try {
      setQueue(await window.pixiv.cancelQueue(id))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 继续任务：放回队列后由主进程在额度允许时自动启动 */
  const resumeQueue = async (id: string): Promise<void> => {
    setError('')
    setTab('tasks')
    try {
      setQueue(await window.pixiv.resumeQueue(id))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 失败清单逐条重试：只放行被点的那一项，其余失败项保持不变 */
  const retryFailure = async (id: string, item: FailureItem): Promise<void> => {
    setError('')
    setTab('tasks')
    try {
      setQueue(await window.pixiv.retryFailure(id, item))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const removeQueue = async (id: string): Promise<void> => {
    try {
      setQueue(await window.pixiv.removeQueue(id))
      setNotice('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const exportFailures = async (id: string): Promise<void> => {
    try {
      const file = await window.pixiv.exportFailures(id)
      if (file) {
        setNotice(t('app.exportFailures', { file }))
        setError('')
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return {
    startDownload,
    cancelBatch,
    pauseQueue,
    cancelQueue,
    resumeQueue,
    retryFailure,
    removeQueue,
    exportFailures
  }
}
