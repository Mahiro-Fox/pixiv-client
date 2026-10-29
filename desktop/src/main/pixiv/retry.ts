import type { AbortReason } from '../../shared/types'

/**
 * 下载/解析错误的分类与重试策略。
 *
 * 设计前提：传输层（`http.ts`）已经按 429 冷却与指数退避重试过 4 次，
 * 所以这里只负责两件事：
 * 1. 给错误定性 —— 值不值得「整个文件重来一次」；
 * 2. 给出任务级退避时间 —— 传输层的 4 次是几秒内打完的，
 *    连续失败往往是网络抖动或短时限流，拉开间隔再来一次才有效。
 *
 * 确定性错误（401 / 403 / 404）一律不重试：
 * 重试只会把 429 放大，而且作品已删除、没有权限这类情况永远成功不了。
 */

export type ErrorKind =
  /** 429 / 408：等冷却结束再试 */
  | 'rate-limit'
  /** 超时、连接中断、DNS、代理不可用：退避后重试 */
  | 'network'
  /** 5xx：服务器抖动，退避后重试 */
  | 'server'
  /** 401：需要重新登录，重试无意义 */
  | 'auth'
  /** 403：没有权限（例如他人的私密收藏），重试无意义 */
  | 'forbidden'
  /** 404 / 410：作品已删除或不可见，重试无意义 */
  | 'missing'
  /** 用户中止 */
  | 'cancelled'
  | 'unknown'

export interface ErrorHint {
  kind: ErrorKind
  retryable: boolean
  waitMs: number
}

/** 单个文件最多尝试几次（含首次）。传输层内部已经重试过，这里不再叠加太多 */
export const TASK_MAX_ATTEMPTS = 3

/**
 * 连续失败熔断阈值。
 * 正常网络抖动是零星失败；连续 8 条都失败说明是系统性问题
 * （Cookie 失效、代理挂了、磁盘写不进去），继续跑只会拖垮剩余任务。
 */
export const CONSECUTIVE_FAILURE_LIMIT = 8

/** 任务级退避表：第 1 次重试等 2s，第 2 次等 5s；限流时优先用服务端给的冷却时间 */
const TASK_BACKOFF_MS = [2_000, 5_000]

export function taskBackoffMs(attempt: number, hint: ErrorHint): number {
  if (hint.waitMs > 0) return hint.waitMs
  const index = Math.min(Math.max(attempt, 1), TASK_BACKOFF_MS.length) - 1
  return TASK_BACKOFF_MS[index]
}

/** 可重试错误只值得再试一次，不重试的错误直接放弃 */
export function shouldRetryTask(hint: ErrorHint, attempt: number): boolean {
  return hint.retryable && attempt < TASK_MAX_ATTEMPTS
}

interface Carried {
  retryable?: boolean
  waitMs?: number
  kind?: ErrorKind
}

/**
 * 读取错误上挂的分类信息。
 * `http.ts` 抛错时会把 kind / retryable / waitMs 一并挂上，
 * 这里对没有元数据的错误（转码失败、磁盘错误等）按文案兜底。
 */
export function classifyError(error: unknown): ErrorHint {
  const carried = (error ?? {}) as Carried
  const message = error instanceof Error ? error.message : String(error ?? '')
  const waitMs = Number(carried.waitMs ?? 0)

  if (carried.kind) {
    return { kind: carried.kind, retryable: carried.retryable !== false, waitMs }
  }

  if (carried.retryable === false) {
    return { kind: 'unknown', retryable: false, waitMs }
  }
  if (/已取消/.test(message)) return { kind: 'cancelled', retryable: false, waitMs }
  if (/HTTP 401|请重新登录|Cookie 已失效/.test(message)) {
    return { kind: 'auth', retryable: false, waitMs }
  }
  if (/HTTP 403|没有权限/.test(message)) return { kind: 'forbidden', retryable: false, waitMs }
  if (/HTTP 40[48]|HTTP 410|作品不存在|已删除/.test(message)) {
    return { kind: 'missing', retryable: false, waitMs }
  }
  if (/HTTP 429|限流/.test(message)) return { kind: 'rate-limit', retryable: true, waitMs }
  if (/HTTP 5\d\d/.test(message)) return { kind: 'server', retryable: true, waitMs }
  if (/超时|连接中断|net::ERR|代理/.test(message)) {
    return { kind: 'network', retryable: true, waitMs }
  }
  // 不认识的多半是确定性失败（转码、磁盘、路径非法），重试只会白白拖时间
  return { kind: 'unknown', retryable: carried.retryable === true, waitMs }
}

/**
 * 读中止原因。三条中止路径共用一个 AbortController：
 * 不带原因的 abort() 是「暂停」，`abort('cancel')` 是用户取消，
 * `abort('shutdown')` 是退出前收尾（下次启动仍按「未完成」继续）。
 */
export function abortReasonOf(signal: AbortSignal): AbortReason {
  const reason = signal.reason
  if (reason === 'cancel' || reason === 'shutdown') return reason
  return 'pause'
}
