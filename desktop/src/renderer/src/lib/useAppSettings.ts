import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  AppConfig,
  Locale,
  ProxyConfig,
  ProxyState,
  ProxyTestResult,
  UpdateStatus
} from '@shared/types'
import { applyTheme, watchSystemTheme } from './theme'
import { messageOf } from './errors'
import { toast } from './toast'
import { translate } from '../i18n'
import type { Translate } from '../i18n'

/**
 * 配置读出来之前也要有语言可用，否则启动首屏只能是中文。
 * 做法和主题一致：在本地存一份，配置到位后由它接管。
 */
export const LOCALE_STORAGE_KEY = 'pixiv-locale'

export function bootLocale(): Locale {
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  return saved === 'en' || saved === 'ja' ? saved : 'zh-CN'
}

export interface UseAppSettingsOptions {
  config: AppConfig | null
  updateConfig: (patch: Partial<AppConfig>) => void
  setError: (message: string) => void
}

export interface AppSettingsState {
  proxy: ProxyState | null
  updateStatus: UpdateStatus | null
  updateOpen: boolean
  setUpdateOpen: Dispatch<SetStateAction<boolean>>
  saveProxy: (patch: Partial<ProxyConfig>, password?: string) => Promise<ProxyState>
  testProxy: () => Promise<ProxyTestResult>
  saveTrayConfig: (patch: Partial<AppConfig>) => Promise<void>
  changeLocale: (next: Locale) => Promise<void>
  pickDir: () => Promise<void>
  openDir: () => void
}

/**
 * App 外壳的设置：主题 / 语言、代理、自动更新与下载目录。
 *
 * 这些都是「配置变化立即生效」的入口，与作品采集无关；
 * 页面本身只消费各自的快照，不参与这里的写入。
 */
export function useAppSettings(options: UseAppSettingsOptions): AppSettingsState {
  const { config, updateConfig, setError } = options

  const [proxy, setProxy] = useState<ProxyState | null>(null)
  /** 自动更新状态与弹窗开关；取消后保持关闭，直到下一次状态变化 */
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)

  // 首屏装饰：代理状态取不到就保持空态
  useEffect(() => {
    let alive = true
    void window.pixiv
      .getProxy()
      .then((state) => {
        if (alive) setProxy(state)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // 自动更新：主进程在后台检查并下载，这里只在「安装包已就绪」时弹窗问一句是否重启。
  // 发现新版本（available）不弹窗——那只是下载前的瞬间状态，弹了用户也没得选。
  useEffect(() => {
    let alive = true
    void window.pixiv
      .getUpdateStatus()
      .then((value) => {
        if (alive) setUpdateStatus(value)
      })
      // 自动更新是附加能力，取不到状态就当作「没有更新」
      .catch(() => undefined)
    return window.pixiv.onUpdateStatus((value) => setUpdateStatus(value))
  }, [])

  useEffect(() => {
    if (updateStatus?.state === 'downloaded') setUpdateOpen(true)
  }, [updateStatus])

  /**
   * 代理改完立即在主进程生效（不必等关闭设置弹窗），
   * 同时把规范化后的配置同步回本地状态，避免关闭时把旧值写回磁盘。
   */
  const saveProxy = async (patch: Partial<ProxyConfig>, password?: string): Promise<ProxyState> => {
    const state = await window.pixiv.setProxy(patch, password)
    setProxy(state)
    updateConfig({ proxy: state.config })
    return state
  }

  const testProxy: () => Promise<ProxyTestResult> = () => window.pixiv.testProxy()

  /**
   * 托盘设置改完立刻落盘，不等到关闭设置弹窗：
   * 托盘图标要马上出现 / 消失，「关闭窗口收进托盘」也必须在用户点关闭之前就生效。
   * 只提交这一个 patch —— 不能把整份本地配置写回去，否则会盖掉主进程刚规范化的值。
   */
  const saveTrayConfig = async (patch: Partial<AppConfig>): Promise<void> => {
    updateConfig(patch)
    try {
      await window.pixiv.setConfig(patch)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  // 主题与语言：配置变化时立即生效；跟随系统时监听系统配色变化
  const themeMode = config?.theme
  const locale = config?.locale
  useEffect(() => {
    if (!themeMode) return
    applyTheme(themeMode)
    if (themeMode !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [themeMode])

  // 这里只同步 DOM 与本地副本，不刷新页面：
  // 页面加载时 locale 会从 undefined 变成配置里的值，effect 必然再跑一次；
  // 若在此处 reload，就变成「刷新 → 加载 → 又触发 effect → 再刷新」的死循环。
  useEffect(() => {
    if (!locale) return
    document.documentElement.lang = locale
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [locale])

  const t: Translate = (key, params) => translate(config?.locale ?? bootLocale(), key, params)

  /**
   * 切换界面语言：先落盘，再整页刷新。
   *
   * 刷新挂在点击这一处，而不是监听 locale 变化的 effect 里 ——
   * 只有用户真的换了语言才会刷新，也保证刷新前磁盘配置与主进程的
   * pixivLang 都已换成新语言（否则新页面还是按旧语言取数据，甚至会
   * 因为读到旧配置而反复刷新）。刷新后 HashRouter 会保留当前 hash，
   * 页面位置不丢，但列表数据需要重新获取。
   */
  const changeLocale = async (next: Locale): Promise<void> => {
    if (!config || config.locale === next) return
    updateConfig({ locale: next })
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    try {
      await window.pixiv.setConfig({ ...config, locale: next })
    } catch (reason) {
      setError(messageOf(reason))
      return
    }
    toast.success(t('settings.appearance.languageSuccess'))
    setTimeout(() => window.location.reload(), 3000)
  }

  const pickDir = async (): Promise<void> => {
    try {
      const dir = await window.pixiv.pickDir()
      if (!dir) return
      updateConfig({ outDir: dir })
      await window.pixiv.setConfig({ outDir: dir })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const openDir = (): void => {
    if (!config) return
    void window.pixiv.openDir(config.outDir).catch((reason: unknown) => setError(messageOf(reason)))
  }

  return {
    proxy,
    updateStatus,
    updateOpen,
    setUpdateOpen,
    saveProxy,
    testProxy,
    saveTrayConfig,
    changeLocale,
    pickDir,
    openDir
  }
}
