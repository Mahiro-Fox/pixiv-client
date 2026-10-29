import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
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

/**
 * 更新包体积（字节）。
 * 不能把 `files` 相加：里面通常同时列了安装包、zip 等多个产物，实际只会下载其中一个，
 * 相加会把体积算大（例如 107 MB 的安装包显示成 140 MB）。取最大值即安装包本身。
 * 差分下载（differential download）时真实流量可能比这个数字更少。
 */
function sizeOf(info: UpdateInfo): number {
  const files = (info.files || []) as Array<{ size?: number }>
  return files.reduce((max, file) => Math.max(max, Number(file.size) || 0), 0)
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

/**
 * 用户确认后才开始下载。
 * 之所以不自动下载：安装包动辄几十上百 MB，应该先让用户看到体积自己决定。
 */
export function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available') return Promise.resolve(status)

  return autoUpdater
    .downloadUpdate()
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

  // 只检查、不自动下载：由界面弹窗征得同意后再走 downloadUpdate()
  autoUpdater.autoDownload = false
  // 已下载但用户没点重启时，退出应用顺手装上，避免下次再下一次
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    setStatus({ state: 'available', version: info.version, size: sizeOf(info) })
  )
  autoUpdater.on('update-not-available', (info) =>
    setStatus({ state: 'up-to-date', version: info.version })
  )
  autoUpdater.on('download-progress', (progress) => {
    // download-progress 不带版本号，沿用上一个状态里记录的新版本号。
    // 不展示已下载 / 总字节：差分下载时这两个数和百分比的口径不一致，容易自相矛盾
    const version =
      status.state === 'available' || status.state === 'downloading' ? status.version : ''
    setStatus({
      state: 'downloading',
      version,
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond
    })
  })
  autoUpdater.on('update-downloaded', (info) =>
    setStatus({ state: 'downloaded', version: info.version })
  )
  // 检查失败只更新状态，不弹窗：当前版本可以继续正常使用
  autoUpdater.on('error', (error) => setStatus({ state: 'error', message: messageOf(error) }))

  setTimeout(() => void checkForUpdates(), CHECK_DELAY_MS)
}
