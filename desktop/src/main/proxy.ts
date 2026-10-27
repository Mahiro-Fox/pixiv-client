import { app, net, safeStorage, session } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProxyConfig, ProxyState, ProxyTestResult } from '../shared/types'
import { loadConfig, normalizeProxy, resolveCookie } from './config'
import { BASE, USER_AGENT } from './pixiv/http'
import { LOGIN_PARTITION } from './pixiv/login'

/**
 * 应用内代理。
 *
 * Chromium 只接受「代理规则」字符串，HTTP/HTTPS 代理的用户名密码不在规则里，
 * 而是在实际遇到 407 时由认证回调提供：webContents 走 app 的 `login` 事件，
 * `net.request` 走请求对象自己的 `login` 事件。SOCKS4/SOCKS5 在 Chromium 里
 * 根本不支持认证，所以界面只对 HTTP/HTTPS 开放账号密码。
 */

const PROXY_PASSWORD_FILE = 'proxy_password.bin'
/** 代理密码不写进 config.json，只留在内存与加密文件里 */
let cachedUsername = ''
let cachedPassword = ''
/** app 上只挂一次 login 监听，重复 applyProxy 时不重复注册 */
let authHooked = false

let lastState: { applied: boolean; error?: string; resolved?: string } = { applied: true }
/** applyProxy 可能被连续调用（用户连续改字段），串行执行避免设置交叉 */
let applyChain: Promise<unknown> = Promise.resolve()

function passwordFile(): string {
  return path.join(app.getPath('userData'), PROXY_PASSWORD_FILE)
}

/** 代理规则：单一协议时直接给出 URI，Chromium 会把它用于 http 与 https */
export function proxyRulesOf(config: ProxyConfig): string {
  return `${config.protocol}://${config.host}:${config.port}`
}

function isAddressValid(config: ProxyConfig): boolean {
  return Boolean(config.host) && Number.isFinite(config.port) && config.port > 0
}

/**
 * 代理认证回调。`authInfo.isProxy` 用来区分「代理要密码」和「pixiv 要登录」，
 * 后者绝不能在这里自动填密码。这里只覆盖登录窗口等 webContents 的请求；
 * `net.request` 的认证在 `http.ts` 里通过 ClientRequest 自己的 login 事件处理。
 */
function hookProxyAuth(): void {
  if (authHooked) return
  authHooked = true
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    if (!cachedUsername) return
    event.preventDefault()
    callback(cachedUsername, cachedPassword)
  })
}

/** 供 `net.request` 的 `login` 事件使用：这类请求不走 webContents 的登录回调 */
export function proxyCredentials(): { username: string; password: string } | null {
  if (!cachedUsername) return null
  return { username: cachedUsername, password: cachedPassword }
}

/**
 * Chromium 的网络错误码对用户没有信息量，换成能照着修的提示。
 * 最常见的坑：把「HTTPS」当成「用代理访问 HTTPS」，实际含义是
 * 对代理本身发起 TLS，普通 HTTP 代理会直接拒连（ERR_PROXY_CONNECTION_FAILED）。
 */
export function explainNetError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('ERR_PROXY_CONNECTION_FAILED')) {
    return '代理连接失败：协议或端口不匹配（v2rayN / Clash 的本地混合端口请选 HTTP），或代理未启动'
  }
  if (message.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
    return '代理隧道建立失败：请检查代理协议、端口与账号密码'
  }
  if (message.includes('ERR_PROXY_AUTH')) {
    return '代理要求认证：请在设置中填写代理账号与密码'
  }
  return message
}

function targetSessions(): Electron.Session[] {
  return [session.defaultSession, session.fromPartition(LOGIN_PARTITION)]
}

async function readPassword(): Promise<string> {
  try {
    const raw = await readFile(passwordFile())
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(raw)
      } catch {
        // 换机或系统密钥变化后解不开，按明文回落；解不出就当作没有密码
        return raw.toString('utf-8')
      }
    }
    return raw.toString('utf-8')
  } catch {
    return ''
  }
}

/**
 * 保存代理密码。`undefined` 表示保持原值，空串表示清除。
 * 未启用系统加密时退化为明文文件（仅限当前用户目录），至少保证功能可用。
 */
export async function saveProxyPassword(password: string | undefined): Promise<void> {
  if (password === undefined) {
    cachedPassword = await readPassword()
    return
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  if (!password) {
    await rm(passwordFile(), { force: true })
    cachedPassword = ''
    return
  }
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(password)
    : Buffer.from(password, 'utf-8')
  await writeFile(passwordFile(), data)
  cachedPassword = password
}

/** 读取当前代理状态给界面；密码只暴露「有没有」 */
export async function getProxyState(): Promise<ProxyState> {
  const config = (await loadConfig()).proxy
  const password = await readPassword()
  return { config, hasPassword: Boolean(password), ...lastState }
}

async function applyNow(config: ProxyConfig): Promise<ProxyState> {
  // 账号名来自配置，密码来自加密文件；login 回调直接用这份缓存
  cachedUsername = config.username
  cachedPassword = await readPassword()

  if (config.enabled && !isAddressValid(config)) {
    lastState = { applied: false, error: '代理地址未填写完整' }
    return { config, hasPassword: Boolean(cachedPassword), ...lastState }
  }

  try {
    hookProxyAuth()
    for (const ses of targetSessions()) {
      if (config.enabled) {
        await ses.setProxy({
          mode: 'fixed_servers',
          proxyRules: proxyRulesOf(config),
          proxyBypassRules: config.bypassRules || '<local>'
        })
      } else {
        await ses.setProxy({ mode: 'system' })
      }
      // 断掉已建立的连接，否则旧连接会继续走旧代理
      await ses.closeAllConnections().catch(() => undefined)
    }
    // 让 Chromium 自己回答「访问 pixiv 实际走哪条路」，这是「是否真正生效」的直接证据：
    // 启用时应为 PROXY/SOCKS5 host:port，关闭时为 DIRECT 或系统代理
    const resolved = await session.defaultSession
      .resolveProxy('https://www.pixiv.net/')
      .catch(() => '')
    lastState = { applied: true, resolved }
  } catch (error) {
    lastState = { applied: false, error: error instanceof Error ? error.message : String(error) }
  }

  return { config, hasPassword: Boolean(cachedPassword), ...lastState }
}

/** 应用代理设置（缺省读取已保存的配置）；返回应用结果供界面提示 */
export function applyProxy(config?: ProxyConfig): Promise<ProxyState> {
  const task = applyChain.then(async () => {
    const target = config ? normalizeProxy(config) : (await loadConfig()).proxy
    return applyNow(target)
  })
  // 链上保留一个永远 resolved 的 Promise，避免一次失败卡死后续调用
  applyChain = task.catch(() => undefined)
  return task
}

function probe(url: string, cookie: string, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'follow' })
    // 与真实接口请求保持同一套请求头：pixiv 对匿名/异常 UA 会直接回 403，
    // 只用默认 UA 测出来的 403 会被误读成代理不通
    request.setHeader('User-Agent', USER_AGENT)
    request.setHeader('Referer', `${BASE}/`)
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9')
    if (cookie) request.setHeader('Cookie', cookie)
    let settled = false
    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    const timer = setTimeout(() => {
      request.abort()
      finish(() => reject(new Error('请求超时')))
    }, timeoutMs)

    request.on('response', (response) => {
      request.abort()
      finish(() => resolve(response.statusCode))
    })
    request.on('login', (_authInfo, callback) => {
      const credentials = proxyCredentials()
      if (credentials) callback(credentials.username, credentials.password)
      else callback()
    })
    request.on('error', (error) => finish(() => reject(error)))
    request.end()
  })
}

/**
 * 用当前代理请求一次 pixiv 首页，验证代理是否可用。
 *
 * 只要收到 HTTP 响应就说明代理链路是通的：4xx / 5xx 是 pixiv 的判断
 * （出口 IP 被风控、匿名请求被拦），不是代理配置错误，所以仍返回 ok。
 */
export async function testProxy(): Promise<ProxyTestResult> {
  const config = (await loadConfig()).proxy
  if (config.enabled && !isAddressValid(config)) {
    return { ok: false, latencyMs: 0, message: '代理地址未填写完整' }
  }

  const { cookie } = await resolveCookie()
  const started = Date.now()
  try {
    const status = await probe('https://www.pixiv.net/', cookie, 15_000)
    return { ok: true, latencyMs: Date.now() - started, status, message: `HTTP ${status}` }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: explainNetError(error)
    }
  }
}
