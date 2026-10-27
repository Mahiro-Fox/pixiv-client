import { BrowserWindow, app, session, shell } from 'electron'

/**
 * pixiv 登录页。登录成功后会跳到 www.pixiv.net，
 * 靠这个跳转判断登录完成，再从自己的 session 里取 Cookie——
 * 全程走 Electron 官方 API，不需要解密浏览器数据。
 */
const LOGIN_URL = 'https://accounts.pixiv.net/login'
const PIXIV_HOST = /(^|\.)pixiv\.net$/
const ACCOUNTS_HOST = 'accounts.pixiv.net'
/** 登录窗口用独立分区：与主界面隔离，登录状态会保留，下次不用重输密码 */
const LOGIN_PARTITION = 'persist:pixiv-login'

// reCAPTCHA 会检查 navigator.webdriver 一类的自动化标记，显式关掉提高通过率。
// 必须在 app ready 之前调用，模块顶层正好满足。
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')

let activeLogin: Promise<string | null> | null = null

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function runLogin(parent: BrowserWindow | null): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 760,
      minWidth: 420,
      minHeight: 520,
      parent: parent ?? undefined,
      show: false,
      autoHideMenuBar: true,
      title: '登录 pixiv',
      backgroundColor: '#18181b',
      webPreferences: {
        partition: LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    let settled = false

    const settle = (cookie: string | null): void => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      resolve(cookie)
    }

    // 用户直接关窗视为取消，已保存的 Cookie 保持不动
    win.on('closed', () => {
      if (settled) return
      settled = true
      resolve(null)
    })

    // 登录页里的外链（帮助、条款等）不要在应用内打开
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    /**
     * 只取接口真正需要的 PHPSESSID，
     * 避免把浏览器里的追踪 Cookie 一并写进应用配置。
     */
    const check = async (): Promise<void> => {
      if (settled) return
      try {
        const host = hostOf(win.webContents.getURL())
        // 仍停留在登录页或验证码页面时不算成功
        if (!host || host === ACCOUNTS_HOST || !PIXIV_HOST.test(host)) return
        const cookies = await win.webContents.session.cookies.get({ domain: '.pixiv.net' })
        const session = cookies.find((item) => item.name === 'PHPSESSID' && item.value)
        if (session) settle(`PHPSESSID=${session.value}`)
      } catch {
        // 窗口已销毁等情况直接忽略，等下一次导航事件再判断
      }
    }

    win.webContents.on('did-navigate', () => void check())
    win.webContents.on('did-navigate-in-page', () => void check())
    // 已登录过时打开登录页会直接跳转，这里兜一次底
    win.webContents.on('did-finish-load', () => void check())

    win.once('ready-to-show', () => win.show())
    // 加载失败（例如代理不通）不销毁窗口：留着错误页让用户自己关，
    // 这样 Promise 仍会由 closed 事件收尾，不会悬着不放
    void win.loadURL(LOGIN_URL).catch(() => undefined)
  })
}

/**
 * 打开应用内 pixiv 登录窗口。
 * 登录成功返回 `PHPSESSID=…`；用户取消或直接关窗返回 null。
 * 同一时间只允许存在一个登录窗口，重复调用会复用同一个 Promise。
 */
export function openPixivLogin(parent: BrowserWindow | null): Promise<string | null> {
  if (activeLogin) return activeLogin
  // 成功、取消、抛异常都要解开，否则一次异常会让后续登录永久复用同一个失败 Promise
  const task = runLogin(parent).finally(() => {
    if (activeLogin === task) activeLogin = null
  })
  activeLogin = task
  return task
}

/**
 * 清空登录窗口分区的会话数据。
 * 不清的话，分区里残留的旧会话会让登录页直接跳走，
 * 窗口还没渲染出来就被关掉，用户会以为「点了没反应」。
 */
export async function clearPixivLoginSession(): Promise<void> {
  await session.fromPartition(LOGIN_PARTITION).clearStorageData({ storages: ['cookies'] })
}