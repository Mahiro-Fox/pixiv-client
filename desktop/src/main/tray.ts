import { Menu, Notification, Tray, app, nativeImage, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppConfig, DownloadSummary, Locale, QueueSummary } from '../shared/types'
import { loadConfig } from './config'
import { listSummaries } from './queue'

/**
 * 托盘常驻：图标、右键菜单、关闭/最小化到托盘，以及后台下载完成提醒。
 *
 * 这里刻意不反向依赖 ipc.ts —— 暂停 / 继续、显示窗口这些动作由 index.ts
 * 以 `TrayActions` 注入，避免 ipc → tray → ipc 的循环引用。
 * 菜单内容每次都按内存里的队列快照重建（listSummaries 是同步的），
 * 所以不需要额外的事件订阅，ipc.ts 在队列变化时调 refreshTray() 即可。
 */

/** 仍在流程中的任务：排队中还没开始，但也算「未结束」 */
const ACTIVE_STATUS: QueueSummary['status'][] = ['queued', 'resolving', 'downloading']

/** 可以「继续」的任务：暂停、失败、取消都能重新入队 */
const RESUMABLE_STATUS: QueueSummary['status'][] = ['paused', 'error', 'cancelled']

interface TrayText {
  show: string
  hide: string
  progress: string
  pauseAll: string
  resumeAll: string
  openDir: string
  quit: string
  tooltipProgress: string
  tooltipPaused: string
  hiddenTitle: string
  hiddenBody: string
  doneTitle: string
  doneFailedTitle: string
  doneBody: string
  doneFailedBody: string
}

/** 主进程没有 i18n 设施，托盘菜单自带一份最小文案表 */
const TEXT: Record<Locale, TrayText> = {
  'zh-CN': {
    show: '显示主窗口',
    hide: '隐藏到托盘',
    progress: '下载中 {jobs} 个任务 · {percent}%（{done}/{total}）',
    pauseAll: '全部暂停',
    resumeAll: '全部继续',
    openDir: '打开下载目录',
    quit: '退出 Pixiv Client',
    tooltipProgress: 'Pixiv Client\n下载中 {jobs} 个任务 · {percent}%',
    tooltipPaused: 'Pixiv Client\n{count} 个任务已暂停',
    hiddenTitle: 'Pixiv Client 仍在后台运行',
    hiddenBody: '窗口已收进托盘，点托盘图标可以重新打开；彻底退出请用托盘菜单。',
    doneTitle: '下载完成',
    doneFailedTitle: '下载结束，有失败项',
    doneBody: '成功 {ok} 个文件，已存在 {exists} 个',
    doneFailedBody: '成功 {ok} 个，失败 {failed} 个，可在下载任务里重试'
  },
  en: {
    show: 'Show window',
    hide: 'Hide to tray',
    progress: 'Downloading {jobs} task(s) · {percent}% ({done}/{total})',
    pauseAll: 'Pause all',
    resumeAll: 'Resume all',
    openDir: 'Open download folder',
    quit: 'Quit Pixiv Client',
    tooltipProgress: 'Pixiv Client\nDownloading {jobs} task(s) · {percent}%',
    tooltipPaused: 'Pixiv Client\n{count} task(s) paused',
    hiddenTitle: 'Pixiv Client is still running',
    hiddenBody: 'The window is in the tray. Click the tray icon to reopen it; use the tray menu to quit.',
    doneTitle: 'Download finished',
    doneFailedTitle: 'Download finished with failures',
    doneBody: '{ok} file(s) saved, {exists} already existed',
    doneFailedBody: '{ok} succeeded, {failed} failed — retry from the task list'
  },
  ja: {
    show: 'メインウィンドウを表示',
    hide: 'トレイに隠す',
    progress: 'ダウンロード中 {jobs} 件 · {percent}%（{done}/{total}）',
    pauseAll: 'すべて一時停止',
    resumeAll: 'すべて再開',
    openDir: '保存先を開く',
    quit: 'Pixiv Client を終了',
    tooltipProgress: 'Pixiv Client\nダウンロード中 {jobs} 件 · {percent}%',
    tooltipPaused: 'Pixiv Client\n{count} 件が一時停止中',
    hiddenTitle: 'Pixiv Client はバックグラウンドで動作中',
    hiddenBody: 'ウィンドウはトレイに格納されました。トレイアイコンをクリックで再表示、終了はトレイメニューから。',
    doneTitle: 'ダウンロード完了',
    doneFailedTitle: 'ダウンロード終了（失敗あり）',
    doneBody: '{ok} 件保存、{exists} 件は既に存在',
    doneFailedBody: '成功 {ok} 件、失敗 {failed} 件。タスク一覧から再試行できます'
  }
}

export interface TrayActions {
  /** 显示并聚焦主窗口；窗口已被销毁时重建 */
  showWindow: () => void
  hideWindow: () => void
  quit: () => void
  /** 运行中的任务中止为「未完成」，排队中的直接标记暂停 */
  pauseAll: () => Promise<void>
  resumeAll: () => Promise<void>
  /** 窗口是否真的在用户眼前（可见 + 未最小化 + 有焦点），用于决定要不要弹提醒 */
  isWindowActive: () => boolean
}

interface TrayPrefs {
  enabled: boolean
  closeToTray: boolean
  minimizeToTray: boolean
  notify: boolean
  locale: Locale
}

const prefs: TrayPrefs = {
  enabled: true,
  closeToTray: true,
  minimizeToTray: false,
  notify: true,
  locale: 'zh-CN'
}

let tray: Tray | null = null
let actions: TrayActions | null = null
/** 托盘提示气泡只在本次运行中弹一次，避免每次都打扰 */
let hiddenHintShown = false
/** 缓存 tooltip，鼠标划过时不必每帧重设（Windows 上重设会闪） */
let lastTooltip = ''

function text(): TrayText {
  return TEXT[prefs.locale] ?? TEXT['zh-CN']
}

/** `{name}` 占位替换；主进程不引 i18n 的插值实现，保持零依赖 */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
}

function iconPath(): string {
  // 打包后走 extraResources（见 electron-builder.yml），开发时直接用仓库里的 build/
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.ico')
    : join(app.getAppPath(), 'build', 'tray.ico')
}

/**
 * 图标缺失时的兜底：画一个纯色方块。
 * 托盘图标为空会让 Windows 显示成一块透明占位，比「不好看」更糟。
 */
function fallbackIcon(): Electron.NativeImage {
  const size = 16
  const bitmap = Buffer.alloc(size * size * 4)
  for (let index = 0; index < size * size; index++) {
    // 内存里是 BGRA，取主题色 #3b82f6
    bitmap[index * 4] = 0xf6
    bitmap[index * 4 + 1] = 0x82
    bitmap[index * 4 + 2] = 0x3b
    bitmap[index * 4 + 3] = 0xff
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size })
}

function aggregatePercent(jobs: QueueSummary[]): number {
  const total = jobs.reduce((sum, job) => sum + job.total, 0)
  if (total <= 0) return 0
  const settled = jobs.reduce((sum, job) => sum + job.ok + job.exists + job.failed, 0)
  return Math.max(0, Math.min(100, Math.round((settled / total) * 100)))
}

function tooltipOf(jobs: QueueSummary[]): string {
  const active = jobs.filter((job) => ACTIVE_STATUS.includes(job.status))
  if (active.length > 0) {
    return fill(text().tooltipProgress, {
      jobs: active.length,
      percent: aggregatePercent(active)
    })
  }
  const paused = jobs.filter((job) => job.status === 'paused').length
  if (paused > 0) return fill(text().tooltipPaused, { count: paused })
  return 'Pixiv Client'
}

function menuOf(jobs: QueueSummary[]): Menu {
  const strings = text()
  const active = jobs.filter((job) => ACTIVE_STATUS.includes(job.status))
  const resumable = jobs.filter((job) => RESUMABLE_STATUS.includes(job.status))
  const windowVisible = actions?.isWindowActive() ?? false

  const items: MenuItemConstructorOptions[] = [
    // 版本号放在只读首项：用户反馈问题时一眼能看到自己跑的是哪个版本
    { label: `Pixiv Client ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    {
      label: windowVisible ? strings.hide : strings.show,
      click: () => (windowVisible ? actions?.hideWindow() : actions?.showWindow())
    }
  ]

  if (jobs.length > 0) {
    items.push({ type: 'separator' })
    if (active.length > 0) {
      const total = active.reduce((sum, job) => sum + job.total, 0)
      const settled = active.reduce(
        (sum, job) => sum + job.ok + job.exists + job.failed,
        0
      )
      items.push({
        label: fill(strings.progress, {
          jobs: active.length,
          percent: aggregatePercent(active),
          done: settled,
          total
        }),
        enabled: false
      })
      items.push({
        label: strings.pauseAll,
        click: () => void actions?.pauseAll().catch(() => undefined)
      })
    }
    if (resumable.length > 0) {
      items.push({
        label: strings.resumeAll,
        click: () => void actions?.resumeAll().catch(() => undefined)
      })
    }
  }

  items.push(
    { type: 'separator' },
    { label: strings.openDir, click: () => void openDownloadDir() },
    { type: 'separator' },
    { label: strings.quit, click: () => actions?.quit() }
  )

  return Menu.buildFromTemplate(items)
}

async function openDownloadDir(): Promise<void> {
  try {
    const config = await loadConfig()
    const dir = (config.outDir || '').trim()
    if (!dir) return
    // 目录可能被用户删掉了，先确保存在再打开，否则 Shell 只会静默失败
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  } catch {
    // 打开目录失败不需要打扰用户
  }
}

/**
 * 托盘气泡优先于系统通知：Windows 上气泡不依赖 AUMID 注册，
 * 开发模式（没有安装快捷方式）也能正常弹出。
 */
function notify(title: string, body: string): void {
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({ title, content: body, iconType: 'info' })
    return
  }
  if (!Notification.isSupported()) return
  new Notification({ title, body }).show()
}

function createTray(): void {
  if (tray) return
  const file = iconPath()
  // 直接把路径交给 Tray：Windows 会从多尺寸 ICO 里挑当前 DPI 最合适的一张。
  // 先用 nativeImage 转一道只会拿到单张位图，缩放到托盘尺寸就糊了。
  tray = new Tray(existsSync(file) ? file : fallbackIcon())
  tray.setToolTip('Pixiv Client')
  // macOS 上设了右键菜单后左键也会弹菜单，再切窗口会变成两次操作，只保留 Windows 的左键切换。
  // 只监听 click：Windows 双击会先派发两次 click 再派发 double-click，两者都绑会先隐藏再显示，反而闪。
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (actions?.isWindowActive()) actions.hideWindow()
      else actions?.showWindow()
    })
  }
  refreshTray()
}

function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
  lastTooltip = ''
}

/**
 * 配置变化时同步托盘：开关图标、更新文案语言与关闭 / 最小化行为。
 * `nextActions` 只在启动时传一次，之后仅同步配置。
 */
export function applyTrayConfig(config: AppConfig, nextActions?: TrayActions): void {
  prefs.enabled = config.trayEnabled !== false
  prefs.closeToTray = config.closeToTray !== false
  prefs.minimizeToTray = config.minimizeToTray === true
  prefs.notify = config.trayNotify !== false
  prefs.locale = config.locale
  if (nextActions) actions = nextActions

  if (prefs.enabled) createTray()
  else destroyTray()
  refreshTray()
}

/** 队列变化后重建菜单与 tooltip；没有托盘时直接跳过 */
export function refreshTray(): void {
  if (!tray) return
  const jobs = listSummaries()
  const tooltip = tooltipOf(jobs)
  if (tooltip !== lastTooltip) {
    tray.setToolTip(tooltip)
    lastTooltip = tooltip
  }
  tray.setContextMenu(menuOf(jobs))
}

/** 托盘是否真的在运行：窗口关闭 / 全关时用它决定要不要保留进程 */
export function isTrayActive(): boolean {
  return tray !== null && prefs.enabled
}

/** 关窗口是「收进托盘」还是「真退出」 */
export function shouldCloseToTray(): boolean {
  return isTrayActive() && prefs.closeToTray
}

/** 最小化是「收进托盘」还是「留在任务栏」 */
export function shouldMinimizeToTray(): boolean {
  return isTrayActive() && prefs.minimizeToTray
}

/** 第一次收进托盘时提示一次，避免用户以为程序被关掉了 */
export function notifyHiddenToTray(): void {
  if (hiddenHintShown || !isTrayActive()) return
  hiddenHintShown = true
  notify(text().hiddenTitle, text().hiddenBody)
}

/**
 * 后台下载结束提醒：只有窗口不在前台时才弹，
 * 用户正盯着界面时界内已有结果，重复提醒反而烦。
 */
export function notifyDownloadDone(summary: DownloadSummary): void {
  if (!prefs.notify) return
  if (summary.phase !== 'done' && summary.phase !== 'error') return
  if (actions?.isWindowActive()) return
  const strings = text()
  if (summary.failed > 0 || summary.resolveFailed > 0) {
    notify(
      strings.doneFailedTitle,
      fill(strings.doneFailedBody, {
        ok: summary.ok + summary.exists,
        failed: summary.failed + summary.resolveFailed
      })
    )
    return
  }
  notify(
    strings.doneTitle,
    fill(strings.doneBody, { ok: summary.ok, exists: summary.exists })
  )
}
