import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  AppConfig,
  BatchArtist,
  BatchSyncProgress,
  CollectProgress,
  DownloadItemEvent,
  DownloadProgress,
  PixivWork,
  WorkContent,
  WorkSort
} from '@shared/types'
import { applyWorkFilters } from './filters'
import { worksTag } from './files'
import { CONFIG_CHANGED_EVENT } from './workActions'
import { messageOf } from './errors'
import { toast } from './toast'
import { translate } from '../i18n'
import type { Translate } from '../i18n'
import type { CookieSessionState } from './useCookieSession'
import { TOUR_DEMO_AUTHOR, type TourAction } from './tour/steps'

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

export interface UseWorkCollectionOptions {
  setError: Dispatch<SetStateAction<string>>
  setNotice: Dispatch<SetStateAction<string>>
  setTab: Dispatch<SetStateAction<string>>
  setDownload: Dispatch<SetStateAction<DownloadProgress | null>>
  setItems: Dispatch<SetStateAction<DownloadItemEvent[]>>
  setBatch: Dispatch<SetStateAction<BatchSyncProgress | null>>
  /** 重新抓取后关掉还开着的老作品详情弹窗 */
  setPreview: Dispatch<SetStateAction<PixivWork | null>>
  /** 当前是否有下载 / 批量任务在跑：抓取时据此决定是否清空日志 */
  running: boolean
  download: DownloadProgress | null
  /** 当前登录会话：收藏夹在未登录时必然失败，抓取前要先看它 */
  session: CookieSessionState
}

export interface WorkCollectionState {
  config: AppConfig | null
  works: PixivWork[]
  selected: Set<string>
  selectedWorks: PixivWork[]
  total: number
  collecting: boolean
  collectProgress: CollectProgress | null

  downloaded: Set<string>
  /** 被过滤规则挡掉的作品数 */
  ruleRemoved: number
  filteredWorks: PixivWork[]
  sortedWorks: PixivWork[]
  pagedWorks: PixivWork[]
  downloadedCount: number

  onlyNew: boolean
  sort: WorkSort
  page: number
  currentPage: number
  pageCount: number
  pageSize: number

  updateConfig: (patch: Partial<AppConfig>) => void
  persistConfig: () => void

  refreshDownloaded: (list: PixivWork[], cfg: AppConfig | null) => Promise<Set<string>>
  collect: (patch?: Partial<AppConfig>, options?: { quietEmpty?: boolean }) => Promise<void>
  switchContent: (next: WorkContent) => void
  openAuthorDownload: (userId: string) => void
  prepareTourWorks: (action: TourAction) => void
  batchSync: (artists: BatchArtist[]) => Promise<void>

  toggleWork: (id: string) => void
  toggleAll: () => void
  toggleOnlyNew: () => void
  changeSort: (next: WorkSort) => void
  changePage: (next: number) => void
  exportWorks: () => Promise<void>
}

/** 工作台作品列表的栏目：全部 / 插画 / 漫画 / 收藏 */
type ContentTab = WorkContent

/**
 * 作品采集与浏览状态：配置、抓取结果、筛选 / 排序 / 分页、选择与导出。
 *
 * 采集和下载互不阻塞，所以下载是否在跑只影响「要不要清空日志」，
 * 不阻止重新抓取；批量同步的长任务也留在这条链路上。
 */
export function useWorkCollection(options: UseWorkCollectionOptions): WorkCollectionState {
  const {
    setError,
    setNotice,
    setTab,
    setDownload,
    setItems,
    setBatch,
    setPreview,
    running,
    download,
    session
  } = options

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [works, setWorks] = useState<PixivWork[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)
  const [collecting, setCollecting] = useState(false)
  const [collectProgress, setCollectProgress] = useState<CollectProgress | null>(null)
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [onlyNew, setOnlyNew] = useState(false)
  const [sort, setSort] = useState<WorkSort>('default')
  const [page, setPage] = useState(1)

  // App 自身的函数体在 I18nProvider 之上，useI18n 取不到配置里的语言，
  // 所以这里直接用纯函数按 locale 取文案（config 未就绪时不会走到需要文案的分支）
  const t: Translate = (key, params) => translate(config?.locale ?? 'zh-CN', key, params)

  useEffect(() => {
    let alive = true
    void window.pixiv
      .getConfig()
      .then((loadedConfig) => {
        if (alive) setConfig(loadedConfig)
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason))
      })
    return () => {
      alive = false
    }
  }, [setError])

  /**
   * 右键菜单里的「屏蔽作者」是直接写主进程配置的，App 内存里的 config 还是旧的。
   * 不同步过来的话，下次下载前调 setConfig(config) 就会把刚加的屏蔽项覆盖掉。
   */
  useEffect(() => {
    const reload = (): void => {
      void window.pixiv
        .getConfig()
        .then((next) => setConfig(next))
        .catch(() => undefined)
    }
    window.addEventListener(CONFIG_CHANGED_EVENT, reload)
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, reload)
  }, [])

  const updateConfig = (patch: Partial<AppConfig>): void => {
    setConfig((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  /** 关闭弹窗时把当前配置整份落盘，避免设置在下次抓取前丢失 */
  const persistConfig = (): void => {
    if (!config) return
    void window.pixiv.setConfig(config).catch((reason: unknown) => setError(messageOf(reason)))
  }

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
    () =>
      onlyNew ? ruleFiltered.works.filter((work) => !downloaded.has(work.id)) : ruleFiltered.works,
    [ruleFiltered, onlyNew, downloaded]
  )

  const sortedWorks = useMemo(() => sortWorks(filteredWorks, sort), [filteredWorks, sort])

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
    if (
      download.phase !== 'done' &&
      download.phase !== 'paused' &&
      download.phase !== 'cancelled' &&
      download.phase !== 'error'
    )
      return
    void refreshDownloaded(works, config)
  }, [download?.phase])

  // 切换下载质量后「已下载」判定会变化（原图需要匹配原图尺寸），重新扫描一次
  useEffect(() => {
    if (!config || works.length === 0) return
    void refreshDownloaded(works, config)
  }, [config?.imageQuality])

  useEffect(() => window.pixiv.onCollectProgress((progress) => setCollectProgress(progress)), [])

  /** patch 用于关注列表等入口「回填参数并立即抓取」；quietEmpty 用于切栏目时安静地展示空列表 */
  const collect = async (
    patch?: Partial<AppConfig>,
    options?: { quietEmpty?: boolean }
  ): Promise<void> => {
    // 抓取与下载互不阻塞：下载进行中也能重新抓取作品列表
    if (!config || collecting) return
    const cfg: AppConfig = { ...config, ...patch }
    if (patch) setConfig(cfg)

    // 未登录时收藏夹接口必然回 400（pixiv 不给出可读原因），
    // 在入口就拦下换成轻提示，不把原始错误甩进页面错误条；
    // Cookie 尚未加载完时不做判断，避免启动时误报
    if (cfg.contentKind === 'bookmarks' && session.cookie && !session.cookie.hasCookie) {
      toast.error(t('app.needLogin'))
      return
    }

    setCollecting(true)
    setError('')
    setCollectProgress(null)
    // 下载进行中时不要清空进度与日志，否则面板会闪回空态并丢掉正在刷的日志
    if (!running) {
      setDownload(null)
      setItems([])
    }
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
        contentKind: cfg.contentKind,
        bookmarkRest: cfg.bookmarkRest
      })
      setWorks(result.works)
      setTotal(result.total)
      setPreview(null)
      setPage(1)

      // 默认全选「当前筛选结果」的第一页
      await refreshDownloaded(result.works, cfg)
      const visible = applyWorkFilters(result.works, cfg).works
      setSelected(new Set(visible.slice(0, cfg.limit).map((work) => work.id)))

      setTab('works')
      if (result.works.length === 0) {
        // 切到「漫画」这类栏目时，作者本来就没有该类作品，空列表比报错更贴切
        if (!options?.quietEmpty) {
          setError(cfg.contentKind === 'bookmarks' ? t('app.noWorksBookmarks') : t('app.noWorks'))
        }
      } else if (result.failedPages > 0) {
        setError(t('app.partialFail', { count: result.failedPages }))
      }
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setCollecting(false)
    }
  }

  /**
   * 作品列表的栏目：全部（插画+漫画，与作者主页「作品」口径一致）/ 插画 / 漫画 / 收藏。
   * 四栏共用同一个「用户 ID」：收藏栏取的就是这位用户的收藏夹，留空则用当前登录账号。
   */
  const contentTab: ContentTab = config?.contentKind ?? 'all'

  /**
   * 「标签」在两类栏目里含义不同：前三个是作品标签，收藏栏是收藏夹标签。
   * 各记一份，切换栏目时换回来——否则从「插画 + R-18」切到收藏，会带着 R-18 去查收藏夹标签，
   * 结果为空还看不出是筛选造成的。
   */
  const tagByGroup = useRef<{ author: string; bookmarks: string }>({
    author: '',
    bookmarks: ''
  })

  /**
   * 切换栏目：只是换查询条件，条件齐了就顺手重抓一次
   * （与标签弹窗「选完即抓」保持一致）；缺用户 ID 时只切界面，等用户点「抓取」。
   */
  const switchContent = (next: ContentTab): void => {
    if (!config || next === contentTab) return

    const fromBookmarks = contentTab === 'bookmarks'
    const toBookmarks = next === 'bookmarks'
    let nextTag = config.tag
    if (fromBookmarks !== toBookmarks) {
      if (fromBookmarks) tagByGroup.current.bookmarks = config.tag
      else tagByGroup.current.author = config.tag
      nextTag = toBookmarks ? tagByGroup.current.bookmarks : tagByGroup.current.author
    }

    updateConfig({ contentKind: next, tag: nextTag })
    // 收藏栏留空会用当前登录账号，所以登录状态已知时也算条件齐全
    const ready =
      config.userId.trim() !== '' || (next === 'bookmarks' && Boolean(session.selfUser?.id))
    if (ready) {
      void collect({ contentKind: next, tag: nextTag, offset: 0 }, { quietEmpty: true })
    }
  }

  /**
   * 作者主页「转到下载页面」：填好作者 ID 并直接抓一轮。
   *
   * 「去下载某位作者」是一次点击指令，不是工作台页面的状态，所以在点击处就执行完，
   * 导航只负责导航。之前用 `navigate("/workbench", { state })` 把参数带过去、
   * 再让工作台的 effect 消费，结果那个 effect 必须靠「replace 掉 state」判断已经处理过：
   * 而 replace 是低优先级的 transition，setConfig 是同步的紧急更新，state 还没清掉
   * config 就换了新对象，effect 便反复触发，表现为无限抓取作品列表。
   */
  const openAuthorDownload = (userId: string): void => {
    setTab('works')
    // 先落盘参数：即使用户此刻正在抓别的东西（collect 会直接返回），ID 也已经填好了
    updateConfig({ userId, tag: '', offset: 0 })
    void collect({ userId, tag: '', offset: 0 })
  }

  /**
   * 引导第 5 步（采集来源）需要一个「有内容」的工作台。
   *
   * 没抓过作品时右侧工具栏根本不渲染，第 6 步（作品工具栏）的锚点就落空了，
   * 气泡只能原地降级。所以列表为空时先填一个示例作者、抓一页——
   * 只影响这一次抓取，不改变下载行为。
   * 已经抓过、或用户自己填过条件（只是没点「抓取」）时不覆盖他的参数。
   */
  const prepareTourWorks = (action: TourAction): void => {
    if (action !== 'demo-works') return
    if (!config || collecting || works.length > 0) return

    const hasParams = Boolean(config.userId.trim() || config.tag.trim() || config.tagExtra.trim())
    if (hasParams) {
      void collect()
      return
    }

    void collect({
      userId: TOUR_DEMO_AUTHOR,
      tag: '',
      tagExtra: '',
      tagExclude: '',
      offset: 0
    })
  }

  /**
   * 批量同步：按当前标签与过滤规则逐位画师「抓取 → 下载」。
   * 主进程串行执行，这里只负责转进度与汇总结果。
   *
   * ⚠️ 入口已临时屏蔽：改版后关注列表改为独立页面，不再提供勾选批量同步，
   * 因此这段逻辑目前不会被触发，但整条链路（batchSync / batch 进度 / 进度条）
   * 保留不动，待需求完善后恢复入口即可复用，请勿删除。
   */
  const batchSync = async (artists: BatchArtist[]): Promise<void> => {
    // 额度是否足够由主进程决定：满了会返回明确错误，这里不再静默拦截
    if (!config || !artists.length) return
    setError('')
    setNotice('')
    // 批量占一个额度但仍可与其它任务并行，所以不清空已有的进度与日志
    if (!running) {
      setDownload(null)
      setItems([])
    }
    setBatch({
      index: 1,
      total: artists.length,
      artist: artists[0]!,
      phase: 'collecting',
      works: 0,
      files: 0,
      failed: 0
    })
    setTab('tasks')
    try {
      await window.pixiv.setConfig(config)
      const summary = await window.pixiv.batchSync({
        artists,
        tag: worksTag(config),
        outDir: config.outDir,
        workers: config.workers,
        delay: config.delay,
        imageQuality: config.imageQuality,
        ugoiraFormat: config.ugoiraFormat
      })
      const failedNames = summary.artists
        .filter((item) => item.error)
        .map((item) => item.artist.name)
      if (summary.aborted) {
        setNotice(t('batch.aborted'))
      } else if (failedNames.length === 0) {
        setNotice(t('batch.done', { ok: summary.ok, failed: 0 }))
      } else {
        setError(
          `${t('batch.done', { ok: summary.ok, failed: summary.failed })}：${failedNames.join('、')}`
        )
      }
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBatch(null)
    }
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
    const allSelected = pagedWorks.length > 0 && pagedWorks.every((work) => selected.has(work.id))
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

  return {
    config,
    works,
    selected,
    selectedWorks,
    total,
    collecting,
    collectProgress,
    downloaded,
    ruleRemoved: ruleFiltered.removed,
    filteredWorks,
    sortedWorks,
    pagedWorks,
    downloadedCount,
    onlyNew,
    sort,
    page,
    currentPage,
    pageCount,
    pageSize,
    updateConfig,
    persistConfig,
    refreshDownloaded,
    collect,
    switchContent,
    openAuthorDownload,
    prepareTourWorks,
    batchSync,
    toggleWork,
    toggleAll,
    toggleOnlyNew,
    changeSort,
    changePage,
    exportWorks
  }
}
