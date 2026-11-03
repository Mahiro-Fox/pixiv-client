import type { DownloadPhase, DownloadProgress } from '../shared/types'

/** 结束态：这些进度必须立刻送到界面，不能等节流窗口 */
const FINAL_PHASES: DownloadPhase[] = ['done', 'paused', 'cancelled', 'error']

/** 进度合并窗口：约 6 帧/秒，肉眼连续、又不会让渲染层每落一个文件就重渲染整棵树 */
export const PROGRESS_INTERVAL = 150

/**
 * 下载进度节流。
 *
 * jobs 每落一个文件就回调一次，24 并发时一秒几十次，而渲染层收到一次就
 * `setState`，把整个 App（含路由页面）重渲染一遍。这里把中间态合并成
 * 每 150ms 一帧、只发最新快照；结束态直接发，保证界面最终数字不会停在中间值。
 *
 * 单独成模块是为了能脱离 Electron 直接跑测试（见 progressThrottle 的用例）。
 */
export function throttledProgress(
  send: (channel: string, payload: unknown) => void
): (progress: DownloadProgress) => void {
  let timer: NodeJS.Timeout | null = null
  let pending: DownloadProgress | null = null

  const flush = (): void => {
    timer = null
    if (!pending) return
    const next = pending
    pending = null
    send('download:progress', next)
  }

  return (progress) => {
    if (FINAL_PHASES.includes(progress.phase)) {
      // 结束态先清掉还没发出去的中间快照，否则 150ms 后会把界面刷回「下载中」
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
      send('download:progress', progress)
      return
    }
    pending = progress
    if (!timer) timer = setTimeout(flush, PROGRESS_INTERVAL)
  }
}
