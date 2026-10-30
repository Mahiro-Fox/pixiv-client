import { BrowserWindow, app, net, protocol, session, shell } from 'electron'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers, shutdownActiveJob } from './ipc'
import { flushHistory } from './history'
import { flushViews } from './viewHistory'
import { flushWatchLater } from './watchLater'
import { flushQueue } from './queue'
import { loadConfig } from './config'
import { applyProxy } from './proxy'
import { USER_AGENT } from './pixiv/http'
import { setPixivLang } from './pixiv/lang'

const LOCAL_SCHEME = 'pixivfile'

/**
 * 全局 UA 兜底。
 * Electron 默认 UA 里带 `Electron/45.0.0` 和 app 名，reCAPTCHA 这类风控
 * 一看到就会把请求判为嵌入式客户端，导致 pixiv 登录页的验证无限循环。
 * 必须用 `userAgentFallback`：`webContents.setUserAgent()` 和
 * `session.setUserAgent()` 都不会传播到跨站 OOPIF，而 reCAPTCHA 恰好
 * 跑在 recaptcha.net 的 iframe 里。此项必须在 app ready 之前设置。
 */
app.userAgentFallback = USER_AGENT

/** 本地图库缩略图协议：只允许读取保存目录内的文件，避免越权访问 */
function registerLocalFileProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

function serveLocalFile(): void {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const config = await loadConfig()
      const root = resolve(config.outDir)
      // 形如 pixivfile://local/?path=D%3A%2F... ，host 仅作占位
      const raw = url.searchParams.get('path') || ''
      const target = resolve(raw)
      const inside = relative(root, target)
      if (!inside || inside.startsWith('..') || resolve(root, inside) !== target) {
        return new Response('Forbidden', { status: 403 })
      }
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

function installImageReferer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://i.pximg.net/*', 'https://*.pximg.net/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://www.pixiv.net/'
      callback({ requestHeaders: details.requestHeaders })
    }
  )
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0e',
    title: 'Pixiv Client',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
    // 开发模式：F12 / Ctrl+Shift+I 切换 DevTools。
    // 用 before-input-event 而不是 globalShortcut —— 后者是系统级热键，
    // 要和其他程序抢 F12，抢不到就静默失效；这里只在本窗口聚焦时响应，
    // 且打包后不注册。
    const onDevToolsHotkey = (event: Electron.Event, input: Electron.Input): void => {
      if (input.type !== 'keyDown') return
      const modifier = process.platform === 'darwin' ? input.meta : input.control
      const toggle =
        input.key === 'F12' ||
        (modifier && input.shift && input.key.toLowerCase() === 'i')
      if (!toggle) return
      event.preventDefault()
      window.webContents.toggleDevTools()
    }
    window.webContents.on('before-input-event', onDevToolsHotkey)
    // DevTools 打开后焦点在它自己的 webContents 上，主窗口收不到按键，
    // 这里补一份监听，F12 才能再次关闭面板
    window.webContents.on('devtools-opened', () => {
      window.webContents.devToolsWebContents?.on('before-input-event', onDevToolsHotkey)
    })
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

registerLocalFileProtocol()

app.whenReady().then(async () => {
  installImageReferer()
  // 先应用代理再建窗口：首屏的接口与图片请求就要走对网络
  await applyProxy().catch(() => undefined)
  // 接口的 lang 参数跟着界面语言走，首屏抓取前就得对齐，否则第一批标题是中文译文
  await loadConfig()
    .then((config) => setPixivLang(config.locale))
    .catch(() => undefined)
  serveLocalFile()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前：中止下载任务，等它把「已暂停」快照写出，再强制落盘队列
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  void (async () => {
    await shutdownActiveJob()
    await flushQueue()
    await flushHistory()
    await flushViews()
    await flushWatchLater()
    app.quit()
  })()
})
