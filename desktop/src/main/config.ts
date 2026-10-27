import { app } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig, CookieSource, CookieStatus, ProxyConfig, ProxyProtocol } from '../shared/types'
import { DEFAULT_FILE_TEMPLATE } from '../shared/template'
import { DEFAULT_THROTTLE_LIMITS } from '../shared/throttle'

function configFile(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function cookieFile(): string {
  return path.join(app.getPath('userData'), 'pixiv_cookie.txt')
}

function legacyCookieFile(): string {
  return path.resolve(app.getAppPath(), '..', 'pixiv_cookie.txt')
}

function defaultOutDir(): string {
  if (!app.isPackaged) {
    return path.resolve(app.getAppPath(), '..', 'pixiv_downloads')
  }
  return path.join(app.getPath('downloads'), 'pixiv_downloads')
}

const PROXY_PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks4', 'socks5']

/** 旧配置没有 proxy 字段，或字段被手改坏时，逐项补齐成可用值 */
export function normalizeProxy(value: unknown): ProxyConfig {
  const raw = (value || {}) as Partial<ProxyConfig>
  const protocol = PROXY_PROTOCOLS.includes(raw.protocol as ProxyProtocol)
    ? (raw.protocol as ProxyProtocol)
    : 'http'
  const port = Number(raw.port)
  return {
    enabled: Boolean(raw.enabled),
    protocol,
    host: typeof raw.host === 'string' ? raw.host.trim() : '',
    // 0 表示未填写，交给界面提示；这里只挡掉非法值
    port: Number.isFinite(port) ? Math.max(0, Math.min(65535, Math.round(port))) : 0,
    username: typeof raw.username === 'string' ? raw.username.trim() : '',
    bypassRules: typeof raw.bypassRules === 'string' ? raw.bypassRules.trim() : '<local>'
  }
}

export function defaultConfig(): AppConfig {
  return {
    userId: '',
    tag: '',
    tagExtra: '',
    tagExclude: '',
    tagMode: 'and',
    offset: 0,
    limit: 48,
    workers: 24,
    delay: 0.2,
    outDir: defaultOutDir(),
    imageQuality: 'regular',
    ugoiraFormat: 'mp4',
    source: 'tag',
    fileNameTemplate: DEFAULT_FILE_TEMPLATE,
    bookmarkUserId: '',
    bookmarkTag: '',
    bookmarkRest: 'show',
    bookmarkOnlyNew: true,
    filterMinPages: 0,
    filterMaxPages: 0,
    filterMinWidth: 0,
    filterMinHeight: 0,
    filterExcludeTags: '',
    filterExcludeKeywords: '',
    filterR18: 'any',
    filterExcludeAi: false,
    throttleApiConcurrency: DEFAULT_THROTTLE_LIMITS.apiConcurrency,
    throttleApiInterval: DEFAULT_THROTTLE_LIMITS.apiInterval,
    throttleCdnConcurrency: DEFAULT_THROTTLE_LIMITS.cdnConcurrency,
    throttleCdnInterval: DEFAULT_THROTTLE_LIMITS.cdnInterval,
    // 默认允许两个任务并行：既能明显缩短连续下载的总时长，又不会把接口/磁盘打满
    parallelJobs: 2,
    // 现有界面一直是暗色，首次升级保持原样，用户可自行切换
    theme: 'dark',
    locale: 'zh-CN',
    proxy: normalizeProxy({ bypassRules: '<local>' })
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const defaults = defaultConfig()
  try {
    const raw = await readFile(configFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    // 浅合并对嵌套字段无效：老配置没有 proxy，必须补默认值并逐项校正
    return { ...defaults, ...parsed, proxy: normalizeProxy(parsed.proxy) }
  } catch {
    return defaults
  }
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig()
  const merged = { ...current, ...patch }
  if (patch.proxy) merged.proxy = normalizeProxy({ ...current.proxy, ...patch.proxy })
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(configFile(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function normalizeCookie(raw: string): string {
  const value = (raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ')
  if (!value) return ''
  return value.includes('=') ? value : `PHPSESSID=${value}`
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, 'utf-8')).trim()
  } catch {
    return ''
  }
}

export async function resolveCookie(): Promise<{ cookie: string; source: CookieSource }> {
  const fromEnv = (process.env.PIXIV_COOKIE || '').trim()
  if (fromEnv) return { cookie: normalizeCookie(fromEnv), source: 'env' }

  const saved = await readIfExists(cookieFile())
  if (saved) return { cookie: normalizeCookie(saved), source: 'file' }

  if (!app.isPackaged) {
    const legacy = await readIfExists(legacyCookieFile())
    if (legacy) return { cookie: normalizeCookie(legacy), source: 'file' }
  }

  return { cookie: '', source: 'none' }
}

export function maskCookie(cookie: string): string {
  if (!cookie) return ''
  if (cookie.length < 24) return cookie
  return `${cookie.slice(0, 12)}...${cookie.slice(-6)}`
}

export async function getCookieStatus(): Promise<CookieStatus> {
  const { cookie, source } = await resolveCookie()
  return { hasCookie: Boolean(cookie), masked: maskCookie(cookie), source }
}

export async function saveCookie(raw: string): Promise<CookieStatus> {
  const normalized = normalizeCookie(raw)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(cookieFile(), normalized, 'utf-8')
  return {
    hasCookie: Boolean(normalized),
    masked: maskCookie(normalized),
    source: normalized ? 'file' : 'none'
  }
}

/** 删除已保存的 Cookie 文件；文件不存在也视为成功 */
export async function clearCookie(): Promise<CookieStatus> {
  await rm(cookieFile(), { force: true })
  return { hasCookie: false, masked: '', source: 'none' }
}
