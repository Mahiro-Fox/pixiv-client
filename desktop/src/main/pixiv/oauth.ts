import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OAuthCredentials, OAuthStatus } from '../../shared/types'
import { postFormJson } from './http'

/**
 * App API（OAuth）凭据层。
 *
 * 为什么要单独一层：pixiv 的写操作（收藏、关注）只挂在 `app-api.pixiv.net`，
 * 认证方式是 Bearer access_token；我们读取数据用的 `www.pixiv.net` + Cookie
 * 是另一套体系（Mako 的 WebApi 通道也只注入 Cookie，没有网页端 POST）。
 * 因此这里只负责「用 refresh_token 换 access_token 并续期」，写操作接口
 * 后续通过 `getAccessToken()` 取凭据。
 *
 * 凭据（client_id / client_secret / refresh_token）全部由用户自行填入并
 * 存在本地，源码里不放任何密钥。refresh_token 可以手填，也可以点设置里的
 * 「通过 pixiv 登录获取」走 PKCE 授权码流程自动换取（见 `oauthLogin.ts`）。
 */
const OAUTH_TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token'
/** PKCE 授权码换 token 时回传的地址，必须与授权页一致 */
export const OAUTH_REDIRECT_URI = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback'
/** token 端点要求 Android 客户端 UA，不能沿用网页 UA */
const APP_USER_AGENT = 'PixivAndroidApp/6.140.2 (Android 15.0)'
/** 提前 60 秒续期，避免请求发出时刚好过期 */
const REFRESH_AHEAD_MS = 60_000

interface TokenRecord extends OAuthCredentials {
  accessToken: string | null
  /** access_token 过期时间戳（毫秒） */
  expiresAt: number | null
  userId: string | null
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  user?: { id?: string | number }
}

/** undefined 表示还没读过磁盘，null 表示读过但没有凭据 */
let cached: TokenRecord | null | undefined
/** 并发去重：多个写操作同时触发续期时只发一次刷新请求 */
let inflight: Promise<string> | null = null

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'oauth.json')
}

function isFilled(record: Partial<TokenRecord> | null): boolean {
  return Boolean(
    record?.clientId && record?.clientSecret && record?.refreshToken
  )
}

async function load(): Promise<TokenRecord | null> {
  if (cached !== undefined) return cached
  try {
    const raw = await readFile(tokenFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<TokenRecord>
    cached = isFilled(parsed)
      ? {
          clientId: String(parsed.clientId),
          clientSecret: String(parsed.clientSecret),
          refreshToken: String(parsed.refreshToken),
          accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : null,
          expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : null,
          userId: parsed.userId ? String(parsed.userId) : null
        }
      : null
  } catch {
    cached = null
  }
  return cached
}

async function persist(record: TokenRecord): Promise<void> {
  cached = record
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(tokenFile(), JSON.stringify(record, null, 2), 'utf-8')
}

function statusOf(record: TokenRecord | null): OAuthStatus {
  return {
    connected: Boolean(record),
    hasClient: Boolean(record?.clientId && record?.clientSecret),
    tail: record?.refreshToken ? record.refreshToken.slice(-4) : '',
    expiresAt: record?.expiresAt ?? null,
    userId: record?.userId ?? null
  }
}

/** 用 refresh_token 换 access_token；失败时把 pixiv 的错误码翻成能看懂的原因 */
async function refreshTokens(credentials: OAuthCredentials): Promise<TokenRecord> {
  const form = {
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    include_policy: 'true'
  }

  let response: TokenResponse
  try {
    response = await postFormJson<TokenResponse>(OAUTH_TOKEN_URL, form, {
      headers: { 'User-Agent': APP_USER_AGENT },
      readErrorBody: true,
      // App API 的 401 与 Cookie 无关，不能触发「请重新登录」
      notifyAuthFailure: false
    })
  } catch (reason) {
    const text = String(reason)
    if (text.includes('invalid_grant')) {
      throw new Error('refresh_token 无效或已被吊销，请重新导入')
    }
    if (text.includes('invalid_client')) {
      throw new Error('client_id 或 client_secret 不正确')
    }
    throw reason
  }

  if (!response.access_token) throw new Error('刷新失败：响应里没有 access_token')

  return {
    ...credentials,
    // pixiv 每次刷新都会下发新的 refresh_token，必须跟着更新
    refreshToken: response.refresh_token || credentials.refreshToken,
    accessToken: response.access_token,
    expiresAt: Date.now() + Math.max(0, Number(response.expires_in ?? 3600)) * 1000,
    userId: response.user?.id ? String(response.user.id) : null
  }
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  return statusOf(await load())
}

interface AuthorizationInput {
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
}

/**
 * PKCE 授权码 → 令牌。
 * 与 refresh 流程共用 token 端点，但 grant_type 换成 authorization_code，
 * 并回传 code_verifier 与 redirect_uri。
 */
async function requestTokensByCode(input: AuthorizationInput): Promise<TokenRecord> {
  const form = {
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: OAUTH_REDIRECT_URI,
    include_policy: 'true'
  }

  let response: TokenResponse
  try {
    response = await postFormJson<TokenResponse>(OAUTH_TOKEN_URL, form, {
      headers: { 'User-Agent': APP_USER_AGENT },
      readErrorBody: true,
      notifyAuthFailure: false
    })
  } catch (reason) {
    const text = String(reason)
    if (text.includes('invalid_grant')) {
      throw new Error('授权码无效或已过期，请重新登录授权')
    }
    if (text.includes('invalid_client')) {
      throw new Error('client_id 或 client_secret 不正确')
    }
    throw reason
  }

  if (!response.access_token || !response.refresh_token) {
    throw new Error('授权失败：响应里没有 access_token 或 refresh_token')
  }

  return {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: response.refresh_token,
    accessToken: response.access_token,
    expiresAt: Date.now() + Math.max(0, Number(response.expires_in ?? 3600)) * 1000,
    userId: response.user?.id ? String(response.user.id) : null
  }
}

/**
 * 用授权页拿到的 code 完成登录，成功即落盘。
 * 返回的状态与 `saveOAuthCredentials` 一致，界面可直接复用同一套展示。
 */
export async function completePixivAuthorization(
  input: AuthorizationInput
): Promise<OAuthStatus> {
  const record = await requestTokensByCode({
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim(),
    code: input.code.trim(),
    codeVerifier: input.codeVerifier
  })
  await persist(record)
  return statusOf(record)
}

/**
 * 保存并校验凭据：先刷新一次，成功才落盘。
 * 这样「保存成功」就等于「凭据可用」，避免存进一份死 token。
 */
export async function saveOAuthCredentials(raw: OAuthCredentials): Promise<OAuthStatus> {
  const credentials: OAuthCredentials = {
    clientId: raw.clientId.trim(),
    clientSecret: raw.clientSecret.trim(),
    refreshToken: raw.refreshToken.trim()
  }
  if (!isFilled(credentials)) throw new Error('client_id、client_secret、refresh_token 都要填写')

  const next = await refreshTokens(credentials)
  await persist(next)
  return statusOf(next)
}

export async function clearOAuth(): Promise<OAuthStatus> {
  cached = null
  inflight = null
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(tokenFile(), '{}', 'utf-8')
  return statusOf(null)
}

/** 供写操作使用：返回可用的 access_token，过期前自动续期 */
export async function getAccessToken(): Promise<string> {
  const record = await load()
  if (!record) {
    throw new Error('未配置 App API 凭据：请在设置里填入 client_id / client_secret / refresh_token')
  }

  const stillValid =
    record.accessToken &&
    record.expiresAt !== null &&
    record.expiresAt - Date.now() > REFRESH_AHEAD_MS
  if (stillValid) return record.accessToken as string

  if (!inflight) {
    inflight = (async () => {
      try {
        const next = await refreshTokens(record)
        await persist(next)
        return next.accessToken as string
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}
