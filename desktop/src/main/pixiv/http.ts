import { net } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { acquireSlot, noteRateLimited, noteSuccess, retryAfterMs, sleep } from './throttle'

export { sleep }

export const BASE = 'https://www.pixiv.net'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
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

function buildRequest(url: string, cookie: string): Electron.ClientRequest {
  const request = net.request({ url, method: 'GET', redirect: 'follow' })
  request.setHeader('User-Agent', USER_AGENT)
  request.setHeader('Referer', `${BASE}/`)
  request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9')
  if (cookie) request.setHeader('Cookie', cookie)
  return request
}

function open(
  url: string,
  cookie: string,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT
): Promise<Electron.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = buildRequest(url, cookie)
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
    request.on('error', (error) => finish(() => reject(error)))
    request.end()
  })
}

function drain(response: Electron.IncomingMessage): void {
  response.on('data', () => undefined)
}

export async function fetchJson<T>(url: string, cookie = '', signal?: AbortSignal): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < API_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('已取消')

    // 全局 API 闸门：冷却 / 并发 / 最小间隔都在这里排队
    const release = await acquireSlot('api', signal)
    try {
      const response = await open(url, cookie, signal)
      const status = response.statusCode

      if (status === 429) {
        const cooldown = noteRateLimited('api', retryAfterMs(response.headers))
        drain(response)
        throw fail(`HTTP 429：接口限流，全局冷却 ${Math.round(cooldown / 1000)}s`, true, cooldown)
      }
      if (status < 200 || status >= 300) {
        drain(response)
        throw fail(`HTTP ${status}`, !isFatalStatus(status))
      }

      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        response.on('end', () => resolve())
        response.on('aborted', () => reject(new Error('连接中断')))
        response.on('error', reject)
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      })
      noteSuccess('api')
      return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw new Error('已取消')
      const hint = hintOf(error)
      if (!hint.retryable) break
      if (attempt < API_ATTEMPTS - 1) {
        await sleep(hint.waitMs > 0 ? hint.waitMs : 1200 * (attempt + 1))
      }
    } finally {
      release()
    }
  }

  throw new Error(`请求失败：${url}（${String(lastError)}）`)
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
