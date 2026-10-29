import { BrowserWindow, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import type { OAuthStatus } from '../../shared/types'
import { LOGIN_PARTITION } from './login'
import { completePixivAuthorization, getOAuthStatus, OAUTH_REDIRECT_URI } from './oauth'

/**
 * PKCE 授权码登录。
 *
 * pixiv 的 App API 没有「网页登录直接拿 refresh_token」的接口，
 * 官方 Android 客户端的做法是：本地生成 code_verifier，
 * 用它算出 code_challenge，打开授权页登录，跳回 callback 时带走 code，
 * 再把 code + code_verifier 换成一组长效令牌。
 *
 * 这里复用 Cookie 登录窗口的分区，用户如果已经登录过就不会再问一次密码。
 */
const AUTHORIZE_URL = 'https://app-api.pixiv.net/web/v1/login'

let activeLogin: Promise<OAuthStatus | null> | null = null

/** 静默授权等不到回调时，多久后把窗口显示出来让用户处理（毫秒） */
const REVEAL_AFTER_MS = 6_000

/** 32 字节随机数转 base64url，长度与官方客户端一致 */
function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** code_challenge = base64url(SHA256(verifier)) */
function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

function authorizeUrl(challenge: string): string {
  const query = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    client: 'pixiv-android'
  })
  return `${AUTHORIZE_URL}?${query.toString()}`
}

/** callback 地址里带的 code；没有则返回空字符串 */
function codeOf(url: string): string {
  if (!url.startsWith(OAUTH_REDIRECT_URI)) return ''
  try {
    return new URL(url).searchParams.get('code') || ''
  } catch {
    return ''
  }
}

/**
 * 打开授权页并等 code。
 * 用户关窗、或授权页带回 error（例如拒绝授权）都按取消处理，返回空字符串。
 */
function runAuthorizeWindow(
  parent: BrowserWindow | null,
  url: string,
  silent: boolean
): Promise<string> {
  return new Promise<string>((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 760,
      minWidth: 420,
      minHeight: 520,
      parent: parent ?? undefined,
      show: false,
      autoHideMenuBar: true,
      title: 'pixiv 授权登录',
      backgroundColor: '#18181b',
      webPreferences: {
        partition: LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    let settled = false
    let revealTimer: ReturnType<typeof setTimeout> | null = null

    const settle = (code: string): void => {
      if (settled) return
      settled = true
      if (revealTimer) clearTimeout(revealTimer)
      if (!win.isDestroyed()) win.destroy()
      resolve(code)
    }

    win.on('closed', () => {
      if (settled) return
      settled = true
      if (revealTimer) clearTimeout(revealTimer)
      resolve('')
    })

    win.webContents.setWindowOpenHandler(({ url: target }) => {
      void shell.openExternal(target)
      return { action: 'deny' }
    })

    // callback 页面本身没有内容，命中就拦下，不必真的加载
    const intercept = (event: Electron.Event, target: string): void => {
      const code = codeOf(target)
      if (!code) return
      event.preventDefault()
      settle(code)
    }
    win.webContents.on('will-navigate', intercept)
    win.webContents.on('will-redirect', intercept)
    // 某些情况下 callback 会先落地成普通导航，这里兜底
    win.webContents.on('did-navigate', (_event, target) => {
      const code = codeOf(target)
      if (code) settle(code)
    })

    if (silent) {
      // 静默模式：窗口一开始不显示。已登录状态下授权页会直接跳回 callback，
      // 用户完全看不到界面；迟迟等不到就让窗口露出来，交给用户完成登录 / 验证码
      revealTimer = setTimeout(() => {
        revealTimer = null
        if (!win.isDestroyed() && !win.isVisible()) win.show()
      }, REVEAL_AFTER_MS)
    } else {
      win.once('ready-to-show', () => win.show())
    }
    // 加载失败（例如代理不通）不销毁窗口：留着错误页让用户自己关，
    // 这样 Promise 仍会由 closed 事件收尾，不会悬着不放
    void win.loadURL(url).catch(() => undefined)
  })
}

/**
 * 打开授权窗口并换取令牌；用户取消返回 null。
 * 同一时间只允许一个授权窗口，重复调用复用同一个 Promise。
 */
export function loginOAuthWithPKCE(
  parent: BrowserWindow | null,
  client: { clientId?: string; clientSecret?: string } = {},
  options: { silent?: boolean } = {}
): Promise<OAuthStatus | null> {
  if (activeLogin) return activeLogin

  const task = (async (): Promise<OAuthStatus | null> => {
    const clientId = (client.clientId || '').trim()
    const clientSecret = (client.clientSecret || '').trim()

    const verifier = createCodeVerifier()
    const code = await runAuthorizeWindow(
      parent,
      authorizeUrl(challengeOf(verifier)),
      Boolean(options.silent)
    )
    if (!code) return null

    return completePixivAuthorization({ clientId, clientSecret, code, codeVerifier: verifier })
  })().finally(() => {
    if (activeLogin === task) activeLogin = null
  })

  activeLogin = task
  return task
}

/**
 * Cookie 登录成功后的静默授权。
 *
 * refresh_token 只能通过 OAuth 授权码拿到，Cookie 换成不了（pixiv 没有这种端点），
 * 但授权窗口复用了登录分区，已登录时打开授权页会直接跳回 callback、不出现任何界面。
 * 所以这里可以在后台静默跑完；只有等不到回调时才把窗口显示出来。
 * 失败一律忽略——读数据不依赖 App API，不该因为授权失败打断登录流程。
 */
export async function autoLoginOAuth(parent: BrowserWindow | null): Promise<void> {
  try {
    if ((await getOAuthStatus()).connected) return
    await loginOAuthWithPKCE(parent, {}, { silent: true })
  } catch {
    // 授权失败不影响 Cookie 登录与读取功能
  }
}
