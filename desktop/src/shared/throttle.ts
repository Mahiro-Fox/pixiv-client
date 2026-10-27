/**
 * 请求限流的用户可调参数：按 host 类型分别控制并发上限与两次请求的最小间隔。
 * 主进程限速器与设置面板共用这一份定义，避免默认值两边不一致。
 */
export interface ThrottleLimits {
  /** 接口（作品列表 / 分页）最大并发 */
  apiConcurrency: number
  /** 接口两次请求的最小间隔（毫秒） */
  apiInterval: number
  /** 图片 CDN 最大并发 */
  cdnConcurrency: number
  /** 图片 CDN 两次请求的最小间隔（毫秒） */
  cdnInterval: number
}

export const DEFAULT_THROTTLE_LIMITS: ThrottleLimits = {
  apiConcurrency: 8,
  apiInterval: 200,
  cdnConcurrency: 12,
  cdnInterval: 100
}

/** 各参数的合法区间与步进，用于设置面板的加减按钮 */
export const THROTTLE_RANGES: Record<
  keyof ThrottleLimits,
  { min: number; max: number; step: number }
> = {
  apiConcurrency: { min: 1, max: 8, step: 1 },
  apiInterval: { min: 100, max: 2000, step: 50 },
  cdnConcurrency: { min: 1, max: 16, step: 1 },
  cdnInterval: { min: 50, max: 1000, step: 10 }
}

/** 配置里的字段名带 throttle 前缀，这里统一映射成限流器使用的结构 */
export function throttleLimitsFromConfig(config: {
  throttleApiConcurrency: number
  throttleApiInterval: number
  throttleCdnConcurrency: number
  throttleCdnInterval: number
}): ThrottleLimits {
  return {
    apiConcurrency: config.throttleApiConcurrency,
    apiInterval: config.throttleApiInterval,
    cdnConcurrency: config.throttleCdnConcurrency,
    cdnInterval: config.throttleCdnInterval
  }
}

/** 把任意输入收敛到合法区间，配置被手改成非法值时也不会卡死或狂发请求 */
export function clampThrottleValue(key: keyof ThrottleLimits, value: number): number {
  const range = THROTTLE_RANGES[key]
  if (!Number.isFinite(value)) return DEFAULT_THROTTLE_LIMITS[key]
  return Math.max(range.min, Math.min(range.max, Math.round(value)))
}
