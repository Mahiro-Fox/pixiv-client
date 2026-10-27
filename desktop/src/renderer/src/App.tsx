import { AlertTriangle, Images, Library, Loader2, LogIn, ScrollText, Settings2, Sparkles, User, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { Locale } from '@shared/types'
import type {
  AppConfig,
  CollectProgress,
  CookieHealth,
  CookieStatus,
  DownloadItemEvent,
  DownloadProgress,
  PixivWork,
  ProxyConfig,
  ProxyState,
  ProxyTestResult,
  QueueSummary,
  SelfUser,
  ThrottleState,
  WorkSort
} from '@shared/types'
import { applyWorkFilters, countActiveFilters } from './lib/filters'
import { applyTheme, watchSystemTheme } from './lib/theme'
import { I18nProvider, translate, useI18n } from './i18n'
import type { Translate } from './i18n'
import { LogPanel } from './components/LogPanel'
import { ProgressPanel } from './components/ProgressPanel'
import { QueuePanel } from './components/QueuePanel'
import { CollectPanel } from './components/CollectPanel'
import { FilterDialog } from './components/FilterDialog'
import { ImagePreviewProvider } from './components/ImagePreview'
import { LibraryPanel } from './components/LibraryPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { FollowDialog } from './components/FollowDialog'
import { WorkDetailDialog } from './components/WorkDetailDialog'
import { WorksGrid } from './components/WorksGrid'
import { Button } from './components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 收藏夹来源统一存到「收藏夹」目录，避免标签过滤条件改变目录结构 */
function worksTag(config: AppConfig): string {
  return config.source === 'bookmarks' ? '收藏夹' : config.tag
}

/**
 * 配置读出来之前也要有语言可用，否则启动首屏只能是中文。
 * 做法和主题一致：在本地存一份，配置到位后由它接管。
 */
const LOCALE_STORAGE_KEY = 'pixiv-locale'

function bootLocale(): Locale {
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  return saved === 'en' || saved === 'ja' ? saved : 'zh-CN'
}

/**
 * 顶栏账号区：未登录时是主按钮式的登录入口，已登录时是头像 + 昵称。
 * 面向不熟悉技术的用户，所以界面上一律不出现 Cookie 字样，
 * 那套说法只在设置面板里出现。
 */
function HeaderAccount(props: {
  selfUser: SelfUser | null
  hasCookie: boolean
  loggingIn: boolean
  onLogin: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useI18n()

  if (!props.selfUser) {
    // 有登录凭据但还没取到账号信息时，不要退化成「登录」按钮，
    // 否则用户会以为没登录而反复点击
    if (props.hasCookie) {
      return (
        <button
          type="button"
          onClick={props.onOpenSettings}
          className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/40"
        >
          <User className="h-3.5 w-3.5" />
          {t('header.loggedIn')}
        </button>
      )
    }
    return (
      <Button size="sm" disabled={props.loggingIn} onClick={props.onLogin}>
        {props.loggingIn ? <Loader2 className="animate-spin" /> : <LogIn />}
        {props.loggingIn ? t('header.loggingIn') : t('header.login')}
      </Button>
    )
  }

  return (
    <button
      type="button"
      onClick={props.onOpenSettings}
      title={props.selfUser.account ? `@${props.selfUser.account}` : props.selfUser.name}
      className="flex items-center gap-2 rounded-full border border-border/60 py-1 pl-1 pr-2.5 transition-colors hover:bg-secondary/40"
    >
      {props.selfUser.avatar ? (
        <img
          src={props.selfUser.avatar}
          alt=""
          className="h-6 w-6 rounded-full bg-secondary object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
          <User className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="max-w-[10rem] truncate text-xs font-medium leading-4">
        {props.selfUser.name}
      </span>
      {props.selfUser.premium ? (
        <span className="rounded bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-500">
          {t('header.premium')}
        </span>
      ) : null}
    </button>
  )
}

/**
 * Cookie 失效提醒条。
 * 之所以单独成组件：I18nProvider 挂在 App 内部，
 * 只有 provider 下面的组件才拿得到 useI18n。
 */
function CookieExpiredBanner(props: {
  loading: boolean
  onRelogin: () => void
  onRecheck: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1 leading-5">{t('cookie.expired')}</p>
      <Button variant="outline" size="sm" disabled={props.loading} onClick={props.onRelogin}>
        {props.loading ? <Loader2 className="animate-spin" /> : null}
        {t('cookie.relogin')}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onRecheck}>
        {t('cookie.recheck')}
      </Button>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label={t('cookie.dismiss')}
        className="rounded p-0.5 text-amber-500/70 transition-colors hover:bg-amber-500/15 hover:text-amber-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** 结果排序；'default' 保留接口原始顺序 */
function sortWorks(works: PixivWork[], sort: WorkSort): PixivWork[] {
  if (sort === 'default') return works
  const list = [...works]
  const byDate = (work: PixivWork): number => {
    const time = Date.parse(work.createDate || '')
    return Number.isFinite(time) ? time : 0
  }

  if (sort === 'pages-desc') return list.sort((a, b) => b.pageCount - a.pageCount)
  if (sort === 'pages-asc') return list.sort((a, b) => a.pageCount - b.pageCount)
  if (sort === 'date-desc') return list.sort((a, b) => byDate(b) - byDate(a))
  return list.sort((a, b) => byDate(a) - byDate(b))
}

export default function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [cookie, setCookie] = useState<CookieStatus | null>(null)
  const [proxy, setProxy] = useState<ProxyState | null>(null)
  const [works, setWorks] = useState<PixivWork[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)
  const [collecting, setCollecting] = useState(false)
  const [collectProgress, setCollectProgress] = useState<CollectProgress | null>(null)
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [items, setItems] = useState<DownloadItemEvent[]>([])
  const [running, setRunning] = useState(false)
  const [queue, setQueue] = useState<QueueSummary[]>([])
  const [throttle, setThrottle] = useState<ThrottleState[]>([])
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [selfUser, setSelfUser] = useState<SelfUser | null>(null)
  const [cookieHealth, setCookieHealth] = useState<CookieHealth>('valid')
  const [healthDismissed, setHealthDismissed] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [onlyNew, setOnlyNew] = useState(false)
  const [sort, setSort] = useState<WorkSort>('default')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<PixivWork | null>(null)
  const [followOpen, setFollowOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('works')

  useEffect(() => {
    let alive = true

    void Promise.all([window.pixiv.getConfig(), window.pixiv.getCookie()])
      .then(([loadedConfig, loadedCookie]) => {
        if (!alive) return
        setConfig(loadedConfig)
        setCookie(loadedCookie)
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason))
      })

    void window.pixiv.listQueue().then((jobs) => {
      if (alive) setQueue(jobs)
    })
    void window.pixiv.getThrottle().then((states) => {
      if (alive) setThrottle(states)
    })
    void window.pixiv.getProxy().then((state) => {
      if (alive) setProxy(state)
    })

    const unsubscribers = [
      window.pixiv.onCollectProgress((progress) => setCollectProgress(progress)),
      window.pixiv.onDownloadProgress((progress) => setDownload(progress)),
      window.pixiv.onDownloadItem((item) =>
        setItems((previous) => [item, ...previous].slice(0, 500))
      ),
      window.pixiv.onDownloadDone((summary) => {
        setDownload(summary)
        setRunning(false)
      }),
      window.pixiv.onQueueChanged((jobs) => setQueue(jobs)),
      window.pixiv.onThrottle((state) =>
        setThrottle((previous) => {
          const next = previous.filter((item) => item.kind !== state.kind)
          return [...next, state]
        })
      )
    ]

    return () => {
      alive = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  const selectedWorks = useMemo(
    () => works.filter((work) => selected.has(work.id)),
    [works, selected]
  )

  // 先按过滤规则筛选，再按「只看未下载」筛选
  const ruleFiltered = useMemo(
    () => (config ? applyWorkFilters(works, config) : { works, removed: 0 }),
    [works, config]
  )

  const filteredWorks = useMemo(
    () => (onlyNew ? ruleFiltered.works.filter((work) => !downloaded.has(work.id)) : ruleFiltered.works),
    [ruleFiltered, onlyNew, downloaded]
  )

  const sortedWorks = useMemo(() => sortWorks(filteredWorks, sort), [filteredWorks, sort])

  const activeFilterCount = useMemo(() => (config ? countActiveFilters(config) : 0), [config])

  // 分页逻辑与 pixiv 网页端一致：按抓取时的每页数量切页，默认停在第 1 页
  const pageSize = Math.max(1, Math.min(100, Math.round(config?.limit || 48)))
  const pageCount = Math.max(1, Math.ceil(sortedWorks.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedWorks = useMemo(
    () => sortedWorks.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedWorks, currentPage, pageSize]
  )
  const downloadedCount = useMemo(
    () => filteredWorks.filter((work) => downloaded.has(work.id)).length,
    [filteredWorks, downloaded]
  )

  // 结果变少（例如开启筛选）时把页码收回到最后一页
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /** 扫描作者目录，标记哪些作品已经下载过 */
  const refreshDownloaded = async (
    list: PixivWork[],
    cfg: AppConfig | null
  ): Promise<Set<string>> => {
    if (!cfg || list.length === 0) {
      setDownloaded(new Set())
      return new Set()
    }
    try {
      const ids = await window.pixiv.checkDownloaded({
        works: list,
        tag: worksTag(cfg),
        outDir: cfg.outDir
      })
      const next = new Set(ids)
      setDownloaded(next)
      return next
    } catch {
      setDownloaded(new Set())
      return new Set()
    }
  }

  useEffect(() => {
    if (!config || works.length === 0 || !download) return
    if (download.phase !== 'done' && download.phase !== 'paused') return
    void refreshDownloaded(works, config)
  }, [download?.phase])

  // 切换下载质量后「已下载」判定会变化（原图需要匹配原图尺寸），重新扫描一次
  useEffect(() => {
    if (!config || works.length === 0) return
    void refreshDownloaded(works, config)
  }, [config?.imageQuality])

  // Cookie 变化后重新识别当前登录账号（收藏夹同步会用到）
  useEffect(() => {
    let alive = true
    if (!cookie?.hasCookie) {
      setSelfUser(null)
      return
    }
    void window.pixiv.getSelfUser().then((user) => {
      if (alive) setSelfUser(user)
    })
    return () => {
      alive = false
    }
  }, [cookie?.hasCookie, cookie?.masked])

  // Cookie 体检：配置变化后主动打一次 pixiv 接口，确认它还认得我们。
  // 'unknown'（请求没打出去）不当成失效，避免代理抖动就弹提醒。
  useEffect(() => {
    if (!cookie?.hasCookie) {
      setCookieHealth('valid')
      return
    }
    let alive = true
    void window.pixiv.checkCookieHealth().then((health) => {
      if (alive) setCookieHealth(health)
    })
    return () => {
      alive = false
    }
  }, [cookie?.hasCookie, cookie?.masked])

  // 任务跑到一半 Cookie 才失效时，主进程会推这个通知过来
  useEffect(
    () =>
      window.pixiv.onCookieInvalid(() => {
        setHealthDismissed(false)
        setCookieHealth('expired')
      }),
    []
  )

  const updateConfig = (patch: Partial<AppConfig>): void => {
    setConfig((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  /**
   * 代理改完立即在主进程生效（不必等关闭设置弹窗），
   * 同时把规范化后的配置同步回本地状态，避免关闭时把旧值写回磁盘。
   */
  const saveProxy = async (
    patch: Partial<ProxyConfig>,
    password?: string
  ): Promise<ProxyState> => {
    const state = await window.pixiv.setProxy(patch, password)
    setProxy(state)
    setConfig((previous) => (previous ? { ...previous, proxy: state.config } : previous))
    return state
  }

  const testProxy: () => Promise<ProxyTestResult> = () => window.pixiv.testProxy()

  // 主题与语言：配置变化时立即生效；跟随系统时监听系统配色变化
  const themeMode = config?.theme
  const locale = config?.locale
  useEffect(() => {
    if (!themeMode) return
    applyTheme(themeMode)
    if (themeMode !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [themeMode])

  useEffect(() => {
    if (!locale) return
    document.documentElement.lang = locale
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }, [locale])

  /** 关闭弹窗时把当前配置整份落盘，避免设置在下次抓取前丢失 */
  const persistConfig = (): void => {
    if (!config) return
    void window.pixiv.setConfig(config).catch((reason: unknown) => setError(messageOf(reason)))
  }

  /** patch 用于关注列表等入口「回填参数并立即抓取」 */
  const collect = async (patch?: Partial<AppConfig>): Promise<void> => {
    if (!config || collecting || running) return
    const cfg: AppConfig = { ...config, ...patch }
    if (patch) setConfig(cfg)

    setCollecting(true)
    setError('')
    setCollectProgress(null)
    setDownload(null)
    setItems([])
    try {
      await window.pixiv.setConfig(cfg)
      const result = await window.pixiv.collectWorks({
        userId: cfg.userId,
        tag: cfg.tag,
        extraTag: cfg.tagExtra,
        excludeTag: cfg.tagExclude,
        tagMode: cfg.tagMode,
        offset: cfg.offset,
        limit: cfg.limit,
        workers: cfg.workers,
        source: cfg.source,
        bookmarkUserId: cfg.bookmarkUserId,
        bookmarkTag: cfg.bookmarkTag,
        bookmarkRest: cfg.bookmarkRest
      })
      setWorks(result.works)
      setTotal(result.total)
      setPreview(null)
      setPage(1)
      // 收藏夹同步默认只看未下载，实现增量同步
      const syncOnlyNew = cfg.source === 'bookmarks' && cfg.bookmarkOnlyNew
      setOnlyNew(syncOnlyNew)

      // 默认全选「当前筛选结果」的第一页
      const ids = await refreshDownloaded(result.works, cfg)
      const base = applyWorkFilters(result.works, cfg).works
      const visible = syncOnlyNew ? base.filter((work) => !ids.has(work.id)) : base
      setSelected(new Set(visible.slice(0, cfg.limit).map((work) => work.id)))

      setTab('works')
      if (result.works.length === 0) {
        setError(
          cfg.source === 'bookmarks'
            ? t('app.noWorksBookmarks')
            : t('app.noWorks')
        )
      } else if (result.failedPages > 0) {
        setError(t('app.partialFail', { count: result.failedPages }))
      }
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setCollecting(false)
    }
  }

  /** 关注列表选中画师：回填用户 ID 并自动抓取作品 */
  const pickFollowingUser = (userId: string): void => {
    setFollowOpen(false)
    if (!config) return
    setConfig({ ...config, source: 'tag', userId })
    void collect({ source: 'tag', userId })
  }

  const startDownload = async (): Promise<void> => {
    if (!config || running) return
    if (selectedWorks.length === 0) {
      setError(t('app.selectFirst'))
      return
    }
    setRunning(true)
    setError('')
    setDownload(null)
    setItems([])
    setTab('log')
    try {
      await window.pixiv.setConfig(config)
      const summary = await window.pixiv.startDownload({
        works: selectedWorks,
        tag: worksTag(config),
        outDir: config.outDir,
        workers: config.workers,
        delay: config.delay,
        imageQuality: config.imageQuality,
        ugoiraFormat: config.ugoiraFormat
      })
      setDownload(summary)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setRunning(false)
    }
  }

  const cancelDownload = (): void => {
    void window.pixiv.cancelDownload()
  }

  const resumeQueue = async (id: string): Promise<void> => {
    if (running) return
    setRunning(true)
    setError('')
    setItems([])
    setTab('log')
    try {
      const summary = await window.pixiv.resumeQueue(id)
      setDownload(summary)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setRunning(false)
    }
  }

  const removeQueue = async (id: string): Promise<void> => {
    try {
      setQueue(await window.pixiv.removeQueue(id))
      setNotice('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const exportFailures = async (id: string): Promise<void> => {
    try {
      const file = await window.pixiv.exportFailures(id)
      if (file) {
        setNotice(t('app.exportFailures', { file }))
        setError('')
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const saveCookie = async (raw: string): Promise<void> => {
    try {
      const status = await window.pixiv.setCookie(raw)
      setCookie(status)
      setError('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 应用内登录：弹出 pixiv 登录窗口，成功后自动保存 Cookie；取消则不改动现有配置 */
  const loginPixiv = async (): Promise<boolean> => {
    setLoggingIn(true)
    try {
      const status = await window.pixiv.loginPixiv()
      if (!status) return false
      setCookie(status)
      setError('')
      return true
    } catch (reason) {
      setError(messageOf(reason))
      return false
    } finally {
      setLoggingIn(false)
    }
  }

  /** 清除已保存 Cookie，并重置登录窗口的会话，使下次登录必须重新过一遍验证码 */
  const clearCookie = async (): Promise<void> => {
    try {
      const status = await window.pixiv.clearCookie()
      setCookie(status)
      setSelfUser(null)
      setError('')
    } catch (reason) {
      setError(messageOf(reason))
    }
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

  const toggleWork = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    // 和 pixiv 一样按页操作：全选只作用于当前页显示的这批作品
    const allSelected =
      pagedWorks.length > 0 && pagedWorks.every((work) => selected.has(work.id))
    setSelected((previous) => {
      const next = new Set(previous)
      if (allSelected) pagedWorks.forEach((work) => next.delete(work.id))
      else pagedWorks.forEach((work) => next.add(work.id))
      return next
    })
  }

  const toggleOnlyNew = (): void => {
    const next = !onlyNew
    setOnlyNew(next)
    setPage(1)
    if (next) void refreshDownloaded(works, config)
  }

  const changeSort = (next: WorkSort): void => {
    setSort(next)
    setPage(1)
  }

  const changePage = (next: number): void => {
    setPage(Math.max(1, Math.min(pageCount, next)))
  }

  const exportWorks = async (): Promise<void> => {
    if (!config || filteredWorks.length === 0) return
    try {
      const file = await window.pixiv.exportWorks({
        works: sortedWorks,
        tag: worksTag(config),
        downloaded: Array.from(downloaded)
      })
      if (file) {
        setNotice(t('app.exportWorks', { file }))
        setError('')
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  // App 自身的函数体在 I18nProvider 之上，useI18n 取不到配置里的语言，
  // 所以这里直接用纯函数按 locale 取文案（config 未就绪时退回本地缓存）
  const t: Translate = (key, params) => translate(config?.locale ?? bootLocale(), key, params)

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('app.loadingConfig')}
      </div>
    )
  }

  const collectText =
    collecting && collectProgress
      ? t('app.progress', {
          loaded: collectProgress.loaded,
          total: collectProgress.total,
          done: collectProgress.pagesDone,
          pages: collectProgress.pagesTotal
        })
      : null

  const cookieExpired =
    cookieHealth === 'expired' && Boolean(cookie?.hasCookie) && !healthDismissed

  const recheckCookie = async (): Promise<void> => {
    setHealthDismissed(false)
    setCookieHealth(await window.pixiv.checkCookieHealth())
  }

  return (
    <I18nProvider locale={config.locale}>
      <ImagePreviewProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-background to-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-5">{t('app.title')}</h1>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {t('app.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <HeaderAccount
            selfUser={selfUser}
            hasCookie={Boolean(cookie?.hasCookie)}
            loggingIn={loggingIn}
            onLogin={() => void loginPixiv()}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 />
            {t('app.settings')}
          </Button>
          <Button variant="outline" size="sm" onClick={openDir}>
            {t('app.openDir')}
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
        <aside className="min-h-0 border-r border-border/60 px-5 py-4">
          <CollectPanel
            config={config}
            selfUser={selfUser}
            hasCookie={Boolean(cookie?.hasCookie)}
            collecting={collecting}
            running={running}
            selectedCount={selectedWorks.length}
            onConfigChange={updateConfig}
            onCollect={() => void collect()}
            onDownload={() => void startDownload()}
            onCancel={cancelDownload}
            onSuggestTags={(word) => window.pixiv.suggestTags(word)}
            onOpenFollowing={() => setFollowOpen(true)}
          />
        </aside>

        <section className="flex min-h-0 flex-col gap-3 px-6 py-4">
          {cookieExpired ? (
            <CookieExpiredBanner
              loading={loggingIn}
              onRelogin={() => void loginPixiv()}
              onRecheck={() => void recheckCookie()}
              onDismiss={() => setHealthDismissed(true)}
            />
          ) : null}

          {notice ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <p className="flex-1 break-all leading-5">{notice}</p>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="rounded p-0.5 text-emerald-500/70 transition-colors hover:bg-emerald-500/15 hover:text-emerald-500"
                aria-label={t('app.dismissNotice')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              <p className="flex-1 break-all leading-5">{error}</p>
              <button
                type="button"
                onClick={() => setError('')}
                className="rounded p-0.5 text-destructive/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
                aria-label={t('app.dismissNotice')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <ProgressPanel progress={download} running={running} throttle={throttle} />

          <QueuePanel
            jobs={queue}
            running={running}
            onResume={(id) => void resumeQueue(id)}
            onRemove={(id) => void removeQueue(id)}
            loadFailures={(id) => window.pixiv.listFailures(id)}
            onExportFailures={(id) => void exportFailures(id)}
            onOpenDir={(dir) =>
              void window.pixiv.openDir(dir).catch((reason: unknown) => setError(messageOf(reason)))
            }
          />

          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="works">
                  <Images className="h-3.5 w-3.5" />
                  {t('app.tabWorks')}
                  {works.length > 0 ? `（${works.length}）` : ''}
                </TabsTrigger>
                <TabsTrigger value="log">
                  <ScrollText className="h-3.5 w-3.5" />
                  {t('app.tabLog')}
                  {items.length > 0 ? `（${items.length}）` : ''}
                </TabsTrigger>
                <TabsTrigger value="library">
                  <Library className="h-3.5 w-3.5" />
                  {t('app.tabLibrary')}
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {collecting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {collectText ?? t('app.collectingWorks')}
                  </>
                ) : null}
                {running ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    {t('app.downloadRunning')}
                  </>
                ) : null}
                {total > 0 && !collecting ? (
                  <span>{t('app.apiTotal', { total })}</span>
                ) : null}
              </div>
            </div>

            <TabsContent value="works" className="min-h-0">
              <WorksGrid
                works={pagedWorks}
                selected={selected}
                downloaded={downloaded}
                downloadedCount={downloadedCount}
                collecting={collecting}
                loaded={collectProgress?.loaded ?? 0}
                total={total}
                filteredTotal={filteredWorks.length}
                filteredOut={ruleFiltered.removed}
                onlyNew={onlyNew}
                sort={sort}
                activeFilterCount={activeFilterCount}
                onSortChange={changeSort}
                onOpenFilter={() => setFilterOpen(true)}
                onExport={() => void exportWorks()}
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
                onPageChange={changePage}
                onToggle={toggleWork}
                onToggleAll={toggleAll}
                onOpen={setPreview}
                onToggleOnlyNew={toggleOnlyNew}
              />
            </TabsContent>

            <TabsContent value="log" className="min-h-0">
              <LogPanel items={items} running={running} />
            </TabsContent>

            <TabsContent value="library" className="min-h-0">
              <LibraryPanel />
            </TabsContent>
          </Tabs>
        </section>
      </main>

      {preview ? (
        <WorkDetailDialog
          work={preview}
          quality={config.imageQuality}
          selected={selected.has(preview.id)}
          onToggle={toggleWork}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {followOpen ? (
        <FollowDialog onClose={() => setFollowOpen(false)} onPick={pickFollowingUser} />
      ) : null}

      {filterOpen ? (
        <FilterDialog
          config={config}
          onConfigChange={updateConfig}
          onClose={() => {
            setFilterOpen(false)
            persistConfig()
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          config={config}
          cookie={cookie}
          selfUser={selfUser}
          proxy={proxy}
          onConfigChange={updateConfig}
          onSaveProxy={saveProxy}
          onTestProxy={testProxy}
          onSaveCookie={saveCookie}
          onLogin={loginPixiv}
          onClearCookie={clearCookie}
          onPickDir={() => void pickDir()}
          onOpenDir={openDir}
          onClose={() => {
            setSettingsOpen(false)
            persistConfig()
          }}
        />
      ) : null}
      </div>
    </ImagePreviewProvider>
    </I18nProvider>
  )
}
