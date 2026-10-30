import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { UpdateStatus } from '../shared/types'

/** 启动后延迟检查，避开首屏的接口与图片请求 */
const CHECK_DELAY_MS = 8000
/** 上次已经把安装包下好了：不必等那么久，弹窗越快出现越好 */
const CHECK_DELAY_PENDING_MS = 1000
const PENDING_FILE = 'pending-update.json'

/**
 * 上次运行下载完、却还没安装的更新。
 *
 * electron-updater 自己会把安装包缓存在 `%LOCALAPPDATA%\pixiv-client-updater\pending`
 * （目录名来自 app-update.yml 的 `updaterCacheDirName`），下次检查时按 sha512 校验并直接复用
 * （`DownloadedUpdateHelper.validateDownloadedPath`），所以「第二次打开不重新下载」是它本来就有的能力。
 * 这里另存一份标记只是为了**不用等检查和网络往返就能立刻弹窗**，
 * 以及安装完成后知道该清掉哪条旧记录。
 */
interface PendingUpdate {
  version: string
  /** 安装包绝对路径；启动时确认它还在，避免对着已删除的文件弹窗 */
  file: string
}

let status: UpdateStatus = { state: 'idle' }
let emit: (next: UpdateStatus) => void = () => undefined
/** 最近一次检查到的新版本号：`download-progress` 事件本身不带版本号 */
let targetVersion = ''

function pendingPath(): string {
  return path.join(app.getPath('userData'), PENDING_FILE)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 内容没变就不广播。
 * 后台复核会再走一遍 update-available → update-downloaded，重复广播会让
 * 用户刚点「取消」关掉的弹窗又弹回来。
 */
function setStatus(next: UpdateStatus): void {
  if (JSON.stringify(next) === JSON.stringify(status)) return
  status = next
  emit(next)
}

/**
 * 是否有更新的版本。只用来判断磁盘上的安装包相对当前运行版本是否还有意义；
 * 版本号解析不出来时退化为「不相等」——宁可多弹一次，也别漏掉更新。
 */
function isNewer(candidate: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const match = /^v?(\d+(?:\.\d+)*)/.exec(String(value).trim())
    return match ? match[1].split('.').map((part) => Number(part) || 0) : null
  }
  const next = parse(candidate)
  const now = parse(current)
  if (!next || !now) return candidate !== current

  const length = Math.max(next.length, now.length)
  for (let index = 0; index < length; index += 1) {
    const left = next[index] ?? 0
    const right = now[index] ?? 0
    if (left !== right) return left > right
  }
  return false
}

/**
 * 已下载安装包的路径。
 * electron-updater 没有公开这个字段，只能读它的内部 helper；读不到就返回空串，
 * 调用方会退回「下次检查时按 sha512 复用缓存」那条路，功能不受影响，只是弹窗晚几秒。
 */
function installerPath(): string {
  const internals = autoUpdater as unknown as {
    downloadedUpdateHelper?: { file?: string | null }
  }
  return internals.downloadedUpdateHelper?.file || ''
}

async function readPending(): Promise<PendingUpdate | null> {
  try {
    const raw = JSON.parse(await readFile(pendingPath(), 'utf8')) as Partial<PendingUpdate>
    const version = String(raw?.version || '')
    const file = String(raw?.file || '')
    if (!version || !file || !existsSync(file)) return null
    return { version, file }
  } catch {
    return null
  }
}

async function clearPending(): Promise<void> {
  await unlink(pendingPath()).catch(() => undefined)
}

async function savePending(version: string): Promise<void> {
  const file = installerPath()
  // 拿不到路径就别写半条记录，否则下次启动会以为「没有可复用的安装包」
  if (!file) return
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(pendingPath(), JSON.stringify({ version, file } satisfies PendingUpdate), 'utf8')
  } catch {
    // 标记只是加速手段，写不进去不影响更新本身
  }
}

/**
 * 启动时先认领上次下好的安装包：有就直接进入「已就绪」，弹窗立刻出现。
 * 随后的检查照常跑，用来确认这个版本还有效（万一线上撤回了或已装上新版本）。
 */
async function restorePending(): Promise<void> {
  const pending = await readPending()
  // 文件没了、记录坏了、或者当前运行的版本已经追上（说明安装完成了）——都可以清掉
  if (!pending || !isNewer(pending.version, app.getVersion())) {
    await clearPending()
    return
  }
  setStatus({ state: 'downloaded', version: pending.version })
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/**
 * 检查更新。开发环境（未打包）不做检查：
 * 没有 app-update.yml，且 electron-updater 会直接抛错。
 *
 * `autoDownload` 为 true 时，发现新版本会自动在后台下载，这里只等检查结果，
 * 不等下载完成——后续进度与完成由事件推给渲染层。
 */
export function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({ state: 'unsupported' })
    return Promise.resolve(status)
  }
  // 正在检查或正在下载时不重复触发；已下载完成时允许再查，用来确认有没有更新的版本
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
 * 重启并安装已下载的更新；没有可安装的更新时返回 false。
 *
 * 有一种情况要等一等：上次启动下好、这次刚从标记里恢复出「已就绪」时，
 * electron-updater 还没做本轮检查，内部还没拿到安装包路径，直接 quitAndInstall 会报错。
 * 这时先补跑一次检查——缓存命中的话不会重新下载，只是把路径校验出来。
 */
export async function installUpdate(): Promise<boolean> {
  if (status.state !== 'downloaded') return false

  if (!installerPath()) {
    await checkForUpdates()
    // 检查没拿到安装包（离线、或被撤销）就别假装修好了
    if (!installerPath()) return false
  }

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

  // 后台直接下：差分更新通常只有几 MB，没必要先让用户看体积再决定；
  // 下载完成后才弹窗，只问「现在重启安装，还是取消」。
  autoUpdater.autoDownload = true
  // 取消就必须是真的不装。默认 true 会在退出程序时把更新装上，和「取消」的语义冲突；
  // 安装包留在缓存里，下次启动校验通过后直接复用，不会再下一次。
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    // 复核期间保持「已就绪」，否则已经打开的弹窗会先消失再重新出现
    if (status.state !== 'downloaded') setStatus({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    targetVersion = info.version
    // 下好的就是同一个版本（启动复核、手动再检查）时不往回退成 available，避免弹窗闪烁
    if (status.state === 'downloaded' && status.version === info.version) return
    setStatus({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    // 线上已经追上或该版本被撤回，磁盘上的安装包不再有意义
    void clearPending()
    setStatus({ state: 'up-to-date', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    // 不展示已下载 / 总字节：差分下载时这两个数和百分比的口径不一致，容易自相矛盾
    setStatus({
      state: 'downloading',
      version: targetVersion,
      percent: Math.round(progress.percent)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    targetVersion = info.version
    setStatus({ state: 'downloaded', version: info.version })
    void savePending(info.version)
  })
  // 检查或下载失败只记状态，不弹窗：当前版本可以继续正常使用，设置里能看到原因
  autoUpdater.on('error', (error) => setStatus({ state: 'error', message: messageOf(error) }))

  void restorePending().finally(() => {
    const delay = status.state === 'downloaded' ? CHECK_DELAY_PENDING_MS : CHECK_DELAY_MS
    setTimeout(() => void checkForUpdates(), delay)
  })
}
