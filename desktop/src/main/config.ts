import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig, CookieSource, CookieStatus } from '../shared/types'
import { DEFAULT_FILE_TEMPLATE } from '../shared/template'

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

export function defaultConfig(): AppConfig {
  return {
    userId: '114638697',
    tag: 'R-18',
    tagExtra: '',
    tagExclude: '',
    tagMode: 'and',
    offset: 0,
    limit: 48,
    workers: 8,
    delay: 0.2,
    outDir: defaultOutDir(),
    imageQuality: 'regular',
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
    filterExcludeAi: false
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const defaults = defaultConfig()
  try {
    const raw = await readFile(configFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const merged = { ...(await loadConfig()), ...patch }
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
