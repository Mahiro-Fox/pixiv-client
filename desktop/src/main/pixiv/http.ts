import { net } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { acquireSlot, noteRateLimited, noteSuccess, retryAfterMs, sleep } from './throttle'
import { explainNetError, proxyCredentials } from '../proxy'

export { sleep }

export const BASE = 'https://www.pixiv.net'
/**
 * 登录窗口与接口请求共用同一个 UA。
 * Chromium 版本必须取运行时真实值：写死一个偏低的版本号会和
 * `navigator.userAgentData` / `sec-ch-ua` 对不上，被 reCAPTCHA
 * 判定成伪造客户端，导致图片验证无限循环。
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${process.versions.chrome} Safari/537.36`
const TIMEOUT = 30_000
const API_ATTEMPTS = 5
const DOWNLOAD_ATTEMPTS = 4

interface RetryHint {
  retryable: boolean
  waitMs: number
}

function fail(message: string, retryable: boolean, waitMs = 0): Error {
  return Object.assign(new Error(message), { retryable, waitMs })
}

function hintOf(error: unknown): RetryHint {
  const value = error as Partial<RetryHint> | null
  return { retryable: value?.retryable !== false, waitMs: Number(value?.waitMs ?? 0) }
}

/** 除 429 外的 4xx 属于确定性错误，重试只会加重限流 */
function isFatalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429 && status !== 408
}

/**
 * 只有 401 才说明登录状态失效（实测：失效 Cookie 取 /ajax/user/self 返回 401）。
 * 403 是「没有权限」，例如访问他人的私密收藏，此时登录是好的，
 * 一并当成失效会误弹「请重新登录」。
 */
let authFailureHandler: (() => void) | null = null

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  form?: Record<string, string>
  /** 额外 header，同名会覆盖默认值（App API 需要 Android UA） */
  headers?: Record<string, string>
  /** 非 2xx 时读取响应体拼进错误信息（OAuth 要区分 invalid_grant） */
  readErrorBody?: boolean
  /** 401 是否视为 Cookie 失效；App API 的 401 与 Cookie 无关 */
  notifyAuthFailure?: boolean
}

/** 表单编码；没有 form 时返回 undefined，请求体为空 */
function encodeForm(form: Record<string, string> | undefined): string | undefined {
  return form ? new URLSearchParams(form).toString() : undefined
}

function buildRequest(
  url: string,
  cookie: string,
  options: RequestOptions = {}
): Electron.ClientRequest {
  const request = net.request({
    url,
    method: options.method ?? 'GET',
    redirect: 'follow'
  })
  request.setHeader('User-Agent', USER_AGENT)
  request.setHeader('Referer', `${BASE}/`)
  request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9')
  if (cookie) request.setHeader('Cookie', cookie)
  if (options.form) {
    request.setHeader('Content-Type', 'application/x-www-form-urlencoded')
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    request.setHeader(name, value)
  }
  // HTTP/HTTPS 代理要求认证时，Chromium 通过这个事件要账号密码；
  // 没有配置账号就回空凭据，让请求按「认证失败」正常报错
  request.on('login', (_authInfo, callback) => {
    const credentials = proxyCredentials()
    if (credentials) callback(credentials.username, credentials.password)
    else callback()
  })
  return request
}

function open(
  url: string,
  cookie: string,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT,
  options: RequestOptions = {}
): Promise<Electron.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = buildRequest(url, cookie, options)
    const body = encodeForm(options.form)
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      run()
    }

    const onAbort = () => {
      request.abort()
      finish(() => reject(new Error('已取消')))
    }

    timer = setTimeout(() => {
      request.abort()
      finish(() => reject(new Error('请求超时')))
    }, timeoutMs)

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    request.on('response', (response) => finish(() => resolve(response)))
    request.on('error', (error) => finish(() => reject(new Error(explainNetError(error)))))
    request.end(body)
  })
}

function drain(response: Electron.IncomingMessage): void {
  response.on('data', () => undefined)
}

/** 读完整个响应体；JSON 解析与错误摘要共用 */
async function readText(response: Electron.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    response.on('end', () => resolve())
    response.on('aborted', () => reject(new Error('连接中断')))
    response.on('error', reject)
    response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
  })
  return Buffer.concat(chunks).toString('utf-8')
}

async function requestJson<T>(
  url: string,
  cookie: string,
  signal: AbortSignal | undefined,
  attempts: number,
  options: RequestOptions = {}
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new Error('已取消')

    // 全局 API 闸门：冷却 / 并发 / 最小间隔都在这里排队
    const release = await acquireSlot('api', signal)
    try {
      const response = await open(url, cookie, signal, TIMEOUT, options)
      const status = response.statusCode

      if (status === 429) {
        const cooldown = noteRateLimited('api', retryAfterMs(response.headers))
        drain(response)
        throw fail(`HTTP 429：接口限流，全局冷却 ${Math.round(cooldown / 1000)}s`, true, cooldown)
      }
      if (status < 200 || status >= 300) {
        if (status === 401 && options.notifyAuthFailure !== false) authFailureHandler?.()
        // 403 是没权限，最常见的是抓取他人的私密收藏，给一句能看懂的原因
        if (status === 403) {
          drain(response)
          throw fail('HTTP 403：没有权限访问该内容（例如他人的私密收藏）', false)
        }
        if (options.readErrorBody) {
          const detail = (await readText(response)).replace(/\s+/g, ' ').slice(0, 200)
          throw fail(`HTTP ${status}${detail ? `：${detail}` : ''}`, !isFatalStatus(status))
        }
        drain(response)
        throw fail(`HTTP ${status}`, !isFatalStatus(status))
      }

      noteSuccess('api')
      const text = (await readText(response)).trim()
      // 写操作的 DELETE 端点偶尔返回空体，按成功处理，避免 JSON.parse 抛错
      if (!text) return undefined as T
      return JSON.parse(text) as T
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw new Error('已取消')
      const hint = hintOf(error)
      if (!hint.retryable) break
      if (attempt < attempts - 1) {
        await sleep(hint.waitMs > 0 ? hint.waitMs : 1200 * (attempt + 1))
      }
    } finally {
      release()
    }
  }

  throw new Error(`请求失败：${url}（${String(lastError)}）`)
}

export async function fetchJson<T>(
  url: string,
  cookie = '',
  signal?: AbortSignal,
  attempts = API_ATTEMPTS
): Promise<T> {
  return requestJson<T>(url, cookie, signal, attempts)
}

/**
 * 带自定义请求头的 GET（App API 用）。
 * 不传 Cookie，401 也不触发「Cookie 失效」提醒 —— token 与 Cookie 是两套凭据。
 */
export async function fetchJsonWithHeaders<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  attempts = API_ATTEMPTS
): Promise<T> {
  return requestJson<T>(url, '', signal, attempts, {
    headers,
    notifyAuthFailure: false
  })
}

/**
 * 表单 POST（`application/x-www-form-urlencoded`），用于 OAuth token 端点。
 * 复用同一套代理、超时与限流通道。
 */
export async function postFormJson<T>(
  url: string,
  form: Record<string, string>,
  options: RequestOptions = {}
): Promise<T> {
  // 刷新 token 属于幂等操作，但失败后重试意义不大，只留一次网络抖动重试
  return requestJson<T>(url, '', undefined, 2, { ...options, method: 'POST', form })
}

/**
 * 带自定义请求头的表单 POST（App API 写操作用）。
 * 非 2xx 时读取响应体，pixiv 会在 message 里给出具体原因；
 * 401 与 Cookie 无关，不触发「请重新登录」提醒。
 */
export async function postFormWithHeaders<T>(
  url: string,
  form: Record<string, string>,
  headers: Record<string, string>,
  signal?: AbortSignal,
  attempts = 2
): Promise<T> {
  return requestJson<T>(url, '', signal, attempts, {
    method: 'POST',
    form,
    headers,
    readErrorBody: true,
    notifyAuthFailure: false
  })
}

export interface DownloadOptions {
  signal?: AbortSignal
  onBytes?: (bytes: number) => void
}

export async function downloadFile(
  url: string,
  destPath: string,
  cookie = '',
  options: DownloadOptions = {}
): Promise<number> {
  const partPath = `${destPath}.part`
  await mkdir(dirname(destPath), { recursive: true })
  let lastError: unknown

  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new Error('已取消')

    const release = await acquireSlot('cdn', options.signal)
    try {
      const response = await open(url, cookie, options.signal)
      const status = response.statusCode

      if (status === 429) {
        const cooldown = noteRateLimited('cdn', retryAfterMs(response.headers))
        drain(response)
        throw fail(`HTTP 429：图片 CDN 限流，冷却 ${Math.round(cooldown / 1000)}s`, true, cooldown)
      }
      if (status < 200 || status >= 300) {
        drain(response)
        throw fail(`HTTP ${status}`, !isFatalStatus(status))
      }

      const file = createWriteStream(partPath)
      let bytes = 0
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const failStream = (error: Error) => {
          if (settled) return
          settled = true
          file.destroy()
          reject(error)
        }

        response.on('end', () => {
          if (settled) return
          file.end(() => {
            if (settled) return
            settled = true
            resolve()
          })
        })
        response.on('aborted', () => failStream(new Error('连接中断')))
        response.on('error', failStream)
        file.on('error', failStream)
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          options.onBytes?.(chunk.length)
          file.write(chunk)
        })
      })

      noteSuccess('cdn')
      await rename(partPath, destPath)
      return bytes
    } catch (error) {
      lastError = error
      await rm(partPath, { force: true }).catch(() => undefined)
      if (options.signal?.aborted) throw new Error('已取消')
      const hint = hintOf(error)
      if (!hint.retryable) break
      if (attempt < DOWNLOAD_ATTEMPTS - 1) {
        await sleep(hint.waitMs > 0 ? hint.waitMs : 1000 * (attempt + 1))
      }
    } finally {
      release()
    }
  }

  throw new Error(`下载失败：${url}（${String(lastError)}）`)
}
