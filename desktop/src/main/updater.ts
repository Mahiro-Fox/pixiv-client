import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

/** 启动后延迟检查，避开首屏的接口与图片请求 */
const CHECK_DELAY_MS = 8000

let status: UpdateStatus = { state: 'idle' }
let emit: (next: UpdateStatus) => void = () => undefined

function setStatus(next: UpdateStatus): void {
  status = next
  emit(next)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/**
 * 检查更新。开发环境（未打包）不做检查：
 * 没有 app-update.yml，且 electron-updater 会直接抛错。
 */
export function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({ state: 'unsupported' })
    return Promise.resolve(status)
  }
  // 正在检查或正在下载时不重复触发
  if (status.state === 'checking' || status.state === 'downloading') {
    return Promise.resolve(status)
  }

  return autoUpdater
    .checkForUpdates()
    .then(() => status)
    .catch((error: unknown) => {
      setStatus({ state: 'error', message: messageOf(error) })
      return status
    })
}

/** 重启并安装已下载的更新；没有可安装的更新时返回 false */
export function installUpdate(): boolean {
  if (status.state !== 'downloaded') return false
  // 参数：isSilent=false 显示安装向导；isForceRunAfter=true 安装完自动拉起新版本
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}

/**
 * 初始化自动更新。`send` 由 ipc 层提供，用来把状态广播给所有窗口。
 * 必须等到 app ready 之后再调用。
 */
export function initUpdater(send: (next: UpdateStatus) => void): void {
  emit = send

  if (!app.isPackaged) {
    setStatus({ state: 'unsupported' })
    return
  }

  // 发现新版本后自动后台下载；退出时若已下载完成则自动安装
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    setStatus({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', (info) =>
    setStatus({ state: 'up-to-date', version: info.version })
  )
  autoUpdater.on('download-progress', (progress) => {
    // download-progress 不带版本号，沿用上一个状态里记录的新版本号
    const version =
      status.state === 'available' || status.state === 'downloading' ? status.version : ''
    setStatus({
      state: 'downloading',
      version,
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })
  autoUpdater.on('update-downloaded', (info) =>
    setStatus({ state: 'downloaded', version: info.version })
  )
  // 检查失败只更新状态，不弹窗：当前版本可以继续正常使用
  autoUpdater.on('error', (error) => setStatus({ state: 'error', message: messageOf(error) }))

  setTimeout(() => void checkForUpdates(), CHECK_DELAY_MS)
}
