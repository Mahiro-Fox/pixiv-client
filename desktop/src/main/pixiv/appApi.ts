import { fetchJsonWithHeaders, postFormWithHeaders } from './http'
import { getAccessToken, getOAuthStatus } from './oauth'

/**
 * pixiv App API 通道。
 *
 * 推荐、写操作都挂在 `app-api.pixiv.net`，认证是 Bearer access_token；
 * 与读取用的 `www.pixiv.net` + Cookie 是两套体系。
 * 这里只做「带上凭据发 GET」，限流复用 http.ts 的全局 API 闸门。
 */
export const APP_BASE = 'https://app-api.pixiv.net'

/** App API 要求客户端 UA；与 oauth.ts 刷新 token 时保持一致 */
const APP_USER_AGENT = 'PixivAndroidApp/6.140.2 (Android 15.0)'

const APP_HEADERS: Record<string, string> = {
  'User-Agent': APP_USER_AGENT,
  'App-OS': 'android',
  'App-OS-Version': '15.0',
  'App-Version': '6.140.2',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Referer: `${APP_BASE}/`
}

/**
 * next_url 来自接口响应，必须原样回传才能继续翻页。
 * 只放行 app-api.pixiv.net，避免把任意地址交给主进程去请求。
 */
export function resolveAppUrl(pathOrUrl: string): string {
  const value = String(pathOrUrl || '').trim()
  if (!value) return APP_BASE
  if (!/^https?:\/\//i.test(value)) {
    return `${APP_BASE}${value.startsWith('/') ? '' : '/'}${value}`
  }
  const url = new URL(value)
  if (url.hostname !== 'app-api.pixiv.net') {
    throw new Error('拒绝访问非 App API 地址')
  }
  return url.toString()
}

/** App API GET：自动取 token（过期前续期）并补全客户端请求头 */
export async function appApiGet<T>(pathOrUrl: string, signal?: AbortSignal): Promise<T> {
  const token = await getAccessToken()
  return fetchJsonWithHeaders<T>(
    resolveAppUrl(pathOrUrl),
    { ...APP_HEADERS, Authorization: `Bearer ${token}` },
    signal
  )
}

/**
 * App API 表单 POST（收藏、关注等写操作）。
 * 响应体可能是空字符串，调用方只关心是否成功时可直接忽略返回值。
 */
export async function appApiPost<T>(
  path: string,
  form: Record<string, string>,
  signal?: AbortSignal
): Promise<T> {
  const token = await getAccessToken()
  return postFormWithHeaders<T>(resolveAppUrl(path), form, {
    ...APP_HEADERS,
    Authorization: `Bearer ${token}`
  }, signal)
}

/** 写操作前置检查：没有凭据时给出可执行的提示，而不是直接抛 401 */
export async function ensureAppConnected(): Promise<void> {
  const status = await getOAuthStatus()
  if (!status.connected) {
    throw new Error('写操作需要先连接 App API 凭据（设置 → App API 凭据）')
  }
}

/** 把 App API 的 401 / 403 翻成能看懂的提示，避免界面层暴露 `HTTP 401` */
export function explainAppError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error)
  if (/HTTP 401/.test(text)) {
    return new Error('App API 凭据已失效，请在设置中重新连接')
  }
  if (/HTTP 403/.test(text)) {
    return new Error('没有权限执行该操作，请确认账号状态')
  }
  return error instanceof Error ? error : new Error(text)
}
