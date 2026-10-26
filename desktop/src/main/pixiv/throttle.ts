import type { ThrottleKind, ThrottleState } from '../../shared/types'

/**
 * 全局限速器。
 *
 * 429 的根因是「单位时间内同一出口 IP 的请求总量超标」，而不是单个任务太快，
 * 所以这里按 host 类型（api / 图片 CDN）做全局闸门：
 *   - 限制同时在途的请求数
 *   - 限制两次请求之间的最小间隔
 *   - 一旦收到 429，读取 Retry-After 并让整类请求全局冷却（指数退避 + 抖动）
 *   - 冷却期间自动下调并发，连续成功后再逐步恢复
 */

interface Limiter {
  kind: ThrottleKind
  maxConcurrency: number
  minInterval: number
  /** 连续命中的 429 次数，越大越保守 */
  penalty: number
  /** 用于恢复并发的连续成功计数 */
  okStreak: number
  active: number
  lastStart: number
  cooldownUntil: number
}

const LIMITS: Record<ThrottleKind, { concurrency: number; minInterval: number }> = {
  // 作品列表 / 分页接口：限制最严，串行两路即可
  api: { concurrency: 2, minInterval: 650 },
  // 图片 CDN：带宽型请求，可以更激进，但仍需节流
  cdn: { concurrency: 6, minInterval: 120 }
}

const MAX_COOLDOWN = 45_000
const RECOVER_STREAK = 8

function createLimiter(kind: ThrottleKind): Limiter {
  const limit = LIMITS[kind]
  return {
    kind,
    maxConcurrency: limit.concurrency,
    minInterval: limit.minInterval,
    penalty: 0,
    okStreak: 0,
    active: 0,
    lastStart: 0,
    cooldownUntil: 0
  }
}

const limiters: Record<ThrottleKind, Limiter> = {
  api: createLimiter('api'),
  cdn: createLimiter('cdn')
}

const listeners = new Set<(state: ThrottleState) => void>()

function concurrencyOf(limiter: Limiter): number {
  return Math.max(1, limiter.maxConcurrency - limiter.penalty * 2)
}

function snapshot(limiter: Limiter): ThrottleState {
  return {
    kind: limiter.kind,
    maxConcurrency: limiter.maxConcurrency,
    concurrency: concurrencyOf(limiter),
    minInterval: limiter.minInterval,
    penalty: limiter.penalty,
    active: limiter.active,
    cooldownUntil: limiter.cooldownUntil
  }
}

function emit(limiter: Limiter): void {
  const state = snapshot(limiter)
  listeners.forEach((listener) => listener(state))
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function onThrottleChange(listener: (state: ThrottleState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function throttleStates(): ThrottleState[] {
  return [snapshot(limiters.api), snapshot(limiters.cdn)]
}

/** 距离解除冷却还剩多少毫秒 */
export function cooldownRemaining(kind: ThrottleKind): number {
  return Math.max(0, limiters[kind].cooldownUntil - Date.now())
}

/**
 * 申请一个请求额度，返回释放函数。
 * 会同时等待冷却结束、并发空位、最小间隔，并做轻微抖动避免惊群。
 */
export async function acquireSlot(kind: ThrottleKind, signal?: AbortSignal): Promise<() => void> {
  const limiter = limiters[kind]

  for (;;) {
    if (signal?.aborted) throw new Error('已取消')

    const now = Date.now()
    const waitCooldown = limiter.cooldownUntil - now
    const waitInterval = limiter.minInterval - (now - limiter.lastStart)

    if (waitCooldown <= 0 && waitInterval <= 0 && limiter.active < concurrencyOf(limiter)) {
      limiter.active += 1
      limiter.lastStart = now
      emit(limiter)
      return () => {
        limiter.active = Math.max(0, limiter.active - 1)
        emit(limiter)
      }
    }

    const candidates = [1000]
    if (waitCooldown > 0) candidates.push(waitCooldown)
    if (waitInterval > 0) candidates.push(waitInterval)
    const wait = Math.max(50, Math.min(...candidates))
    await sleep(wait + Math.random() * 40)
  }
}

/** 解析 Retry-After（秒数或 HTTP 日期），返回毫秒；无有效值时返回 0 */
export function retryAfterMs(
  headers: Record<string, string | string[] | undefined>,
  now = Date.now()
): number {
  const raw = headers['retry-after'] ?? headers['Retry-After']
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  if (!value) return 0

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)

  const date = Date.parse(value)
  if (Number.isNaN(date)) return 0
  return Math.max(0, date - now)
}

/**
 * 记录一次 429：整类请求全局冷却，并下调并发。
 * 返回本次冷却时长（毫秒）。
 */
export function noteRateLimited(kind: ThrottleKind, retryAfter = 0): number {
  const limiter = limiters[kind]
  limiter.penalty = Math.min(limiter.maxConcurrency - 1, limiter.penalty + 1)
  limiter.okStreak = 0

  const base = kind === 'api' ? 2500 : 1200
  const backoff = Math.min(MAX_COOLDOWN, Math.max(retryAfter, base * 2 ** (limiter.penalty - 1)))
  const cooldown = Math.round(backoff * (1 + Math.random() * 0.3))
  limiter.cooldownUntil = Math.max(limiter.cooldownUntil, Date.now() + cooldown)
  emit(limiter)
  return cooldown
}

/** 记录一次成功：连续足够多次后逐步恢复并发 */
export function noteSuccess(kind: ThrottleKind): void {
  const limiter = limiters[kind]
  if (limiter.penalty === 0) return

  limiter.okStreak += 1
  if (limiter.okStreak >= RECOVER_STREAK) {
    limiter.okStreak = 0
    limiter.penalty -= 1
    emit(limiter)
  }
}
