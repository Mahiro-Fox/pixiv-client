import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  BatchSyncProgress,
  DownloadItemEvent,
  DownloadProgress,
  QueueSummary,
  ThrottleState
} from '@shared/types'

export interface DownloadEventsState {
  /** 最近的下载日志，新的在前，最多保留 500 条 */
  items: DownloadItemEvent[]
  setItems: Dispatch<SetStateAction<DownloadItemEvent[]>>
  download: DownloadProgress | null
  setDownload: Dispatch<SetStateAction<DownloadProgress | null>>
  batch: BatchSyncProgress | null
  setBatch: Dispatch<SetStateAction<BatchSyncProgress | null>>
  /** 正在下载的队列任务 ID（并行下载时可能同时存在多个） */
  activeIds: Set<string>
  /** 是否有下载 / 批量任务在跑：抓取时据此决定是否清空日志 */
  running: boolean
  queue: QueueSummary[]
  setQueue: Dispatch<SetStateAction<QueueSummary[]>>
  throttle: ThrottleState[]
}

/**
 * 下载与队列的实时状态：主进程推送的所有事件只在这里订阅。
 *
 * 进度本身已经在主进程里节流，这里不再做额外的合并；
 * activeIds 维护的是「当前真正在跑」的任务集合，界面据此显示并行数量。
 */
export function useDownloadEvents(setError: Dispatch<SetStateAction<string>>): DownloadEventsState {
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [batch, setBatch] = useState<BatchSyncProgress | null>(null)
  const [items, setItems] = useState<DownloadItemEvent[]>([])
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<QueueSummary[]>([])
  const [throttle, setThrottle] = useState<ThrottleState[]>([])
  const running = activeIds.size > 0 || Boolean(batch)

  useEffect(() => {
    let alive = true

    // 首屏装饰：取不到就保持空态，不能让未处理的 Promise 变成控制台噪音
    void window.pixiv
      .listQueue()
      .then((jobs) => {
        if (alive) setQueue(jobs)
      })
      .catch(() => undefined)
    void window.pixiv
      .getThrottle()
      .then((states) => {
        if (alive) setThrottle(states)
      })
      .catch(() => undefined)

    const unsubscribers = [
      window.pixiv.onDownloadProgress((progress) => {
        setDownload(progress)
        const id = progress.jobId
        if (!id) return
        // 结束的任务从运行集合里移除，界面据此显示并行数量。
        // 四种结束态都算结束：完成 / 暂停 / 取消 / 失败
        const finished =
          progress.phase === 'done' ||
          progress.phase === 'paused' ||
          progress.phase === 'cancelled' ||
          progress.phase === 'error'
        setActiveIds((previous) => {
          if (finished) {
            if (!previous.has(id)) return previous
            const next = new Set(previous)
            next.delete(id)
            return next
          }
          return previous.has(id) ? previous : new Set(previous).add(id)
        })
      }),
      window.pixiv.onBatchProgress((progress) => setBatch(progress)),
      window.pixiv.onDownloadItem((item) =>
        setItems((previous) => [item, ...previous].slice(0, 500))
      ),
      window.pixiv.onDownloadDone((summary) => {
        setDownload(summary)
        setActiveIds((previous) => {
          if (!previous.has(summary.jobId)) return previous
          const next = new Set(previous)
          next.delete(summary.jobId)
          return next
        })
      }),
      window.pixiv.onQueueChanged((jobs) => setQueue(jobs)),
      window.pixiv.onQueueError((message) => setError(message)),
      window.pixiv.onThrottle((state) =>
        setThrottle((previous) => {
          const next = previous.filter((item) => item.kind !== state.kind)
          return [...next, state]
        })
      )
    ]

    return () => {
      alive = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [setError])

  return {
    items,
    setItems,
    download,
    setDownload,
    batch,
    setBatch,
    activeIds,
    running,
    queue,
    setQueue,
    throttle
  }
}
