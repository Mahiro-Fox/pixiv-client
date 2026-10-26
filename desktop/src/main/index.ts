import { BrowserWindow, app, net, protocol, session, shell } from 'electron'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers, shutdownActiveJob } from './ipc'
import { flushHistory } from './history'
import { flushQueue } from './queue'
import { loadConfig } from './config'

const LOCAL_SCHEME = 'pixivfile'

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
    title: 'Pixiv 下载器',
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
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

registerLocalFileProtocol()

app.whenReady().then(() => {
  installImageReferer()
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
    app.quit()
  })()
})
