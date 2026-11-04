import {
  BookOpen,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  FolderOpen,
  Filter,
  Images,
  Library,
  Loader2,
  ScrollText,
  Trophy,
  Users,
  Settings
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type * as React from 'react'
import { KeepAlive } from 'keepalive-for-react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutlet
} from 'react-router-dom'
import type { PixivWork } from '@shared/types'
import { countActiveFilters } from './utils/filters'
import { useAppSettings, bootLocale } from './hooks/useAppSettings'
import { useCookieSession } from './hooks/useCookieSession'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useQueueActions } from './hooks/useQueueActions'
import { useTopbarSearch } from './hooks/useTopbarSearch'
import { useWorkCollection } from './hooks/useWorkCollection'
import { WorkPreviewHost } from './hooks/useWorkPreview'
import { I18nProvider, translate } from './i18n'
import type { Translate } from './i18n'
import { FilterDialog } from './components/FilterDialog'
import { UserTagDialog } from './components/UserTagDialog'
import { FilterProvider } from './hooks/useFilterContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TourProvider, startTour } from './hooks/useTour'
import { ImagePreviewProvider } from './components/ImagePreview'
import { LibraryPanel } from './components/LibraryPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { WorkDetailDialog } from './components/WorkDetailDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { AccountMenu } from './components/AccountMenu'
import { SearchBox } from './components/SearchBox'
import { NovelSearchPage } from './pages/NovelSearchPage'
import { NovelSeriesPage } from './pages/NovelSeriesPage'
import { SeriesPage } from './pages/SeriesPage'
import { NovelReaderPage } from './pages/NovelReaderPage'
import { NovelLocalReaderPage } from './pages/NovelLocalReaderPage'
import { WorksSearchPage } from './pages/WorksSearchPage'
import { UsersPage } from './pages/UsersPage'
import { UsersFollowingPage } from './pages/UsersFollowingPage'
import { UserDetailPage } from './pages/UserDetailPage'
import { WorkbenchPage, type WorkbenchPageProps } from './pages/WorkbenchPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { HistoryPage } from './pages/HistoryPage'
import { WatchLaterPage } from './pages/WatchLaterPage'
import { RankingPage } from './pages/RankingPage'
import { RecommendPage } from './pages/RecommendPage'
import { Button } from './components/ui/button'
import { Toaster } from './components/ui/sonner'
import { messageOf } from './utils/errors'
import { toast } from './utils/toast'

/**
 * 缓存范围：用户点名的六个浏览页。
 * 这些页面进去详情再回来都应当保持原样，缓存键用 pathname，
 * 因此改筛选 / 翻页 / 回车搜索（search 参数变化）仍复用同一个实例，由页面 effect 重新请求。
 * 本地数据页（收藏 / 浏览记录 / 稍后看等）刻意不缓存，避免看到过期内容。
 */
const KEEP_ALIVE_ROUTES = [
  /^\/recommend$/,
  /^\/illust$/,
  /^\/manga$/,
  /^\/novel$/,
  /^\/ranking$/,
  /^\/users$/,
  /^\/users\/following$/
]

/** 非缓存路由共用一个占位缓存键，避免每个详情页都在缓存表里留一条 */
const OFF_CACHE_KEY = '/(off)'

/**
 * 路由缓存宿主。
 * KeepAlive 必须挂在不随路由变化的位置，所以用一个不带 path 的布局路由包住全部页面。
 *
 * 没有直接用 `keepalive-for-react-router` 的现成出口：它切换缓存键时把状态更新包进了
 * startTransition，新路由要等一个额外的调度帧才挂载，这期间浏览器已经把旧页面画出来了
 * （从推荐页点进用户详情 / 关注列表时会「闪一下推荐页」）。
 *
 * 这里改成：命中 KEEP_ALIVE_ROUTES 的页面才交给 KeepAlive 缓存；其它路由把 outlet
 * 直接渲染在正常 DOM 里，切换是同步的。同时在离开缓存页时立刻把缓存容器隐藏，
 * 免得那个还没被移除的旧节点在新页面上残留一帧。
 *
 * 缓存页刻意不做入场动效：它们靠隐藏 / 显示切换，动画只能等首帧画完再回退到 0，
 * 反而会闪一下；而且恢复滚动位置时整页位移会让人眼看着位置跳。
 */
function KeepAliveOutlet(): React.JSX.Element {
  const location = useLocation()
  const outlet = useOutlet()
  const reduce = useReducedMotion()
  const cached = KEEP_ALIVE_ROUTES.some((pattern) => pattern.test(location.pathname))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cached ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <KeepAlive
          include={KEEP_ALIVE_ROUTES}
          max={12}
          activeCacheKey={cached ? location.pathname : OFF_CACHE_KEY}
          containerClassName="flex h-full min-h-0 flex-col"
          cacheNodeClassName="flex min-h-0 flex-col"
        >
          {cached ? outlet : null}
        </KeepAlive>
      </div>
      {cached ? null : (
        /**
         * 未缓存的页面（详情页、收藏、浏览记录等）每次都是新挂载，顺手做一个入场淡入。
         * 只做 initial→animate、不做退场：页面切换必须同步完成，退场动画会让新页面
         * 晚一帧出现，正是之前「闪一下旧页面」的成因。
         */
        <motion.div
          key={location.pathname}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {outlet}
        </motion.div>
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [preview, setPreview] = useState<PixivWork | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  /**
   * 打开过滤弹窗的回调必须稳定：它进 FilterProvider 的 context value，
   * 写成内联箭头的话每次 App 渲染都会产生新引用，让所有列表页跟着重渲染
   * （下载进度一秒几十次，页面就会被动重绘几十次）。
   */
  const openFilter = useCallback(() => setFilterOpen(true), [])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * 全应用只有这一处把「要告诉用户的话」变成轻提示：
   * 以前是顶部一条可关闭的错误条 / 成功条，占版面且要手动关，
   * 现在统一走 toast，空字符串（原「清空」调用）自然不弹。
   */
  const reportError = useCallback((message: string) => {
    if (message) toast.error(message)
  }, [])
  const reportNotice = useCallback((message: string) => {
    if (message) toast.success(message)
  }, [])
  const [tab, setTab] = useState('works')
  /** 顶栏搜索：关键词同步、栏目查询串还原与回车提交 */
  const { keyword, setKeyword, submitSearch, linkWithWord } = useTopbarSearch()

  /** 下载与队列事件只在这里订阅：下载状态、日志、并行任务、队列、限速 */
  const downloadEvents = useDownloadEvents(reportError)
  /** Cookie / OAuth 会话：账号识别与体检都由它派生 */
  const session = useCookieSession(reportError)
  /** 作品采集与浏览状态：抓取、筛选排序分页、选择与导出 */
  const collection = useWorkCollection({
    setError: reportError,
    setNotice: reportNotice,
    setTab,
    setDownload: downloadEvents.setDownload,
    setItems: downloadEvents.setItems,
    setBatch: downloadEvents.setBatch,
    setPreview,
    running: downloadEvents.running,
    download: downloadEvents.download,
    session
  })
  /** 下载队列操作 */
  const queueActions = useQueueActions({
    config: collection.config,
    selectedWorks: collection.selectedWorks,
    setQueue: downloadEvents.setQueue,
    setItems: downloadEvents.setItems,
    setError: reportError,
    setNotice: reportNotice,
    setTab
  })
  /** 外壳设置：主题语言、代理、自动更新、下载目录 */
  const settings = useAppSettings({
    config: collection.config,
    updateConfig: collection.updateConfig,
    setError: reportError
  })
  const {
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
  } = settings

  const {
    config,
    works,
    selected,
    total,
    collecting,
    collectProgress,
    downloaded,
    pagedWorks,
    downloadedCount,
    filteredWorks,
    onlyNew,
    sort,
    currentPage,
    pageCount,
    pageSize,
    updateConfig,
    persistConfig,
    collect,
    switchContent,
    openAuthorDownload,
    toggleWork,
    toggleAll,
    toggleOnlyNew,
    changeSort,
    changePage,
    exportWorks
  } = collection

  // 徽标显示「当前页生效」的规则数：推荐页不适用内容分级，别把它算进去
  const onRecommend = location.pathname.startsWith('/recommend')
  const activeFilterCount = useMemo(
    () => (config ? countActiveFilters(config, { ignoreRating: onRecommend }) : 0),
    [config, onRecommend]
  )

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

  const cookieExpired = session.cookieExpired

  /** 顶栏导航项统一样式 */
  const navClass = (isActive: boolean): string =>
    `flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
      isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary/50'
    }`

  /**
   * 主栏目导航项：高亮底色交给 layoutId 的滑动块，这里只负责文字颜色。
   * 图标与文字加 relative，压在滑动块之上。
   */
  const navClassMain = (isActive: boolean): string =>
    `relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
      isActive ? 'text-primary' : 'text-muted-foreground hover:bg-secondary/50'
    }`

  /** 主栏目高亮的滑动块：同一个 layoutId 让它从旧位置滑到新位置 */
  const navPill = (
    <motion.span
      layoutId="nav-active-pill"
      className="absolute inset-0 rounded-md bg-primary/15"
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
    />
  )

  /**
   * 工作台的入参。
   *
   * 状态一律留在 App：抓取、下载、队列都跑在这里，主进程事件也只在这里订阅，
   * 页面拿到的只是"这一刻的快照 + 回调"。铺成一个对象再展开，
   * 路由那段就不会被几十个 prop 淹没。
   */
  const workbench: WorkbenchPageProps = {
    config,
    selfUser: session.selfUser,
    hasCookie: Boolean(session.cookie?.hasCookie),
    collecting,
    queued: downloadEvents.queue.length > 0,
    selectedCount: collection.selectedWorks.length,
    collectText,
    collectProgress,
    total,
    worksCount: works.length,
    onConfigChange: updateConfig,
    onCollect: () => void collect(),
    onDownload: () => void queueActions.startDownload(),
    onClearTag: () => void collect({ tag: '', offset: 0 }),
    onSwitchContent: switchContent,
    onSuggestTags: (word) => window.pixiv.suggestTags(word),
    cookieExpired,
    loggingIn: session.loggingIn,
    onRelogin: () => void session.loginPixiv(),
    onRecheckCookie: () => void session.recheckCookie(),
    onDismissCookieBanner: () => session.setHealthDismissed(true),
    tab,
    onTabChange: setTab,
    works: pagedWorks,
    selected,
    downloaded,
    downloadedCount,
    filteredTotal: filteredWorks.length,
    filteredOut: collection.ruleRemoved,
    onlyNew,
    sort,
    activeFilterCount,
    onSortChange: changeSort,
    onOpenFilter: openFilter,
    onOpenTags: () => setTagsOpen(true),
    onExport: () => void exportWorks(),
    page: currentPage,
    pageCount,
    pageSize,
    onPageChange: changePage,
    onToggle: toggleWork,
    onToggleAll: toggleAll,
    onOpen: setPreview,
    onToggleOnlyNew: toggleOnlyNew,
    queue: downloadEvents.queue,
    activeCount: downloadEvents.activeIds.size,
    throttle: downloadEvents.throttle,
    batch: downloadEvents.batch,
    onOpenSettings: () => setSettingsOpen(true),
    onCancelBatch: queueActions.cancelBatch,
    onResume: (id) => void queueActions.resumeQueue(id),
    onPause: (id) => void queueActions.pauseQueue(id),
    onCancel: (id) => void queueActions.cancelQueue(id),
    onRemove: (id) => void queueActions.removeQueue(id),
    onLoadFailures: (id) => window.pixiv.listFailures(id),
    onRetryFailure: queueActions.retryFailure,
    onExportFailures: (id) => void queueActions.exportFailures(id),
    onOpenDir: (dir) =>
      void window.pixiv.openDir(dir).catch((reason: unknown) => reportError(messageOf(reason))),
    items: downloadEvents.items,
    running: downloadEvents.running
  }

  return (
    <I18nProvider locale={config.locale}>
      <ImagePreviewProvider>
        <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-background to-background">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
            {/* <div className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <h1 className="text-sm font-semibold leading-5">
                {t("app.title")}
              </h1>
            </div> */}

            {/* 插画 / 漫画 / 小说 / 用户：切换栏目时保留搜索框里的关键词 */}
            <nav className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 p-0.5">
              <NavLink to="/recommend" className={({ isActive }) => navClassMain(isActive)}>
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <Compass className="relative h-4 w-4" />
                    <span className="relative">{t('nav.recommend')}</span>
                  </>
                )}
              </NavLink>
              <NavLink to="/ranking" className={({ isActive }) => navClassMain(isActive)}>
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <Trophy className="relative h-4 w-4" />
                    <span className="relative">{t('nav.ranking')}</span>
                  </>
                )}
              </NavLink>
              <NavLink
                to={linkWithWord('/illust')}
                className={({ isActive }) => navClassMain(isActive)}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <Images className="relative h-4 w-4" />
                    <span className="relative">{t('nav.illust')}</span>
                  </>
                )}
              </NavLink>
              <NavLink
                to={linkWithWord('/manga')}
                className={({ isActive }) => navClassMain(isActive)}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <BookOpen className="relative h-4 w-4" />
                    <span className="relative">{t('nav.manga')}</span>
                  </>
                )}
              </NavLink>
              <NavLink
                to={linkWithWord('/novel')}
                className={({ isActive }) => navClassMain(isActive)}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <ScrollText className="relative h-4 w-4" />
                    <span className="relative">{t('nav.novel')}</span>
                  </>
                )}
              </NavLink>
              <NavLink
                to={linkWithWord('/users')}
                className={({ isActive }) => navClassMain(isActive)}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? navPill : null}
                    <Users className="relative h-4 w-4" />
                    <span className="relative">{t('nav.users')}</span>
                  </>
                )}
              </NavLink>
            </nav>

            {/* 下载工作台 / 图库：图标入口，文案放 title 里节省顶栏宽度 */}
            <nav className="flex shrink-0 items-center gap-0.5">
              <NavLink
                to="/workbench"
                title={t('nav.workbench')}
                className={({ isActive }) => navClass(isActive)}
              >
                <Download className="h-4 w-4" />
              </NavLink>
              <NavLink
                to="/gallery"
                title={t('nav.gallery')}
                className={({ isActive }) => navClass(isActive)}
              >
                <Library className="h-4 w-4" />
              </NavLink>
              <NavLink
                to="/watch-later"
                title={t('nav.watchLater')}
                className={({ isActive }) => navClass(isActive)}
              >
                <Clock3 className="h-4 w-4" />
              </NavLink>
            </nav>

            {/* 全局搜索：回车在当前栏目下搜索，词同步到 URL；下拉含历史 / 联想 / 热门标签 */}
            <SearchBox
              value={keyword}
              onChange={setKeyword}
              onSubmit={submitSearch}
              placeholder={t('app.searchPlaceholder')}
            />

            <div className="flex shrink-0 items-center gap-1.5">
              <AccountMenu
                selfUser={session.selfUser}
                hasCookie={Boolean(session.cookie?.hasCookie)}
                loggingIn={session.loggingIn}
                onLogin={() => void session.loginPixiv()}
                onOpenFollowing={() => navigate('/users/following')}
                onOpenFavorites={() => navigate('/favorites')}
                onOpenHistory={() => navigate('/history')}
                onOpenSettings={() => setSettingsOpen(true)}
              />
              {/* 过滤规则是全局的：顶栏一个入口，所有列表页共用同一份规则 */}
              <Button
                variant="outline"
                size="sm"
                data-tour="filter-button"
                title={t('filter.button')}
                onClick={openFilter}
                className="relative"
              >
                <Filter className="h-4 w-4" />
                {activeFilterCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
              <Button variant="outline" size="sm" title={t('app.openDir')} onClick={openDir}>
                <FolderOpen className="h-4 w-4" />
              </Button>
              {/* 产品引导：第一次启动自动播放，看过之后从这里可以随时重看 */}
              <Button variant="outline" size="sm" title={t('tour.replay')} onClick={startTour}>
                <CircleHelp className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                title={t('app.settings')}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* 路由缓存宿主：命中 KEEP_ALIVE_ROUTES 的页面缓存，其余随路由挂载 / 卸载 */}
          {/* 过滤规则的上下文：顶栏按钮打开同一个弹窗，各页面列表就地按规则过滤 */}
          <ErrorBoundary>
            <FilterProvider config={config} onOpenFilter={openFilter}>
              <Routes>
                <Route element={<KeepAliveOutlet />}>
                  {/* 下载工作台保持原来的四标签结构，路由迁到 /workbench */}
                  <Route path="/workbench" element={<WorkbenchPage {...workbench} />} />
                  <Route path="/illust" element={<WorksSearchPage kind="illust" />} />
                  <Route path="/manga" element={<WorksSearchPage kind="manga" />} />
                  <Route path="/novel" element={<NovelSearchPage />} />
                  <Route path="/novel/series/:seriesId" element={<NovelSeriesPage />} />
                  <Route path="/novel/local" element={<NovelLocalReaderPage />} />
                  <Route path="/series/:seriesId" element={<SeriesPage oauth={session.oauth} />} />
                  <Route path="/users" element={<UsersPage cookie={session.cookie} />} />
                  <Route path="/users/following" element={<UsersFollowingPage />} />
                  <Route
                    path="/user/:userId"
                    element={
                      <UserDetailPage oauth={session.oauth} onDownloadAuthor={openAuthorDownload} />
                    }
                  />
                  <Route path="/favorites" element={<FavoritesPage />} />
                  <Route path="/ranking" element={<RankingPage />} />
                  <Route path="/recommend" element={<RecommendPage oauth={session.oauth} />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/watch-later" element={<WatchLaterPage />} />
                  {/* 本地图库独立成页，不再塞在插画的标签里 */}
                  <Route
                    path="/gallery"
                    element={
                      <main className="flex min-h-0 flex-1 flex-col px-6 py-4">
                        <LibraryPanel />
                      </main>
                    }
                  />
                  {/* 旧书库页并入图库：小说现在是作者页下的第三个栏目，老链接直接转过去 */}
                  <Route path="/library" element={<Navigate to="/gallery" replace />} />
                  <Route path="/novel/:novelId" element={<NovelReaderPage />} />
                  {/* 未匹配的路由，重定向到推荐页 */}
                  <Route path="*" element={<Navigate to="/recommend" replace />} />
                </Route>
              </Routes>
            </FilterProvider>
          </ErrorBoundary>

          {preview ? (
            <WorkDetailDialog
              work={preview}
              quality={config.imageQuality}
              selected={selected.has(preview.id)}
              onToggle={toggleWork}
              onClose={() => setPreview(null)}
            />
          ) : null}

          {/* 全站唯一的应用内预览：卡片直接调 openPreview，这里只负责渲染 */}
          <WorkPreviewHost />

          {tagsOpen ? (
            <UserTagDialog
              userId={config.userId}
              content={config.contentKind ?? 'all'}
              activeTag={config.tag}
              busy={collecting}
              onClose={() => setTagsOpen(false)}
              onSelect={(tag) => {
                setTagsOpen(false)
                const next = tag ?? ''
                // 选的是同一个标签且本来就在第一页：没必要再打一轮全量请求
                if (next === config.tag && config.offset === 0) return
                // 换标签等于换一次查询：回到第一页重新抓取
                void collect({ tag: next, offset: 0 })
              }}
            />
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

          {updateOpen && updateStatus ? (
            <UpdateDialog status={updateStatus} onClose={() => setUpdateOpen(false)} />
          ) : null}

          {settingsOpen ? (
            <SettingsDialog
              config={config}
              cookie={session.cookie}
              selfUser={session.selfUser}
              proxy={proxy}
              onConfigChange={updateConfig}
              onTrayChange={(patch) => void saveTrayConfig(patch)}
              onChangeLocale={(next) => void changeLocale(next)}
              onSaveProxy={saveProxy}
              onTestProxy={testProxy}
              onSaveCookie={session.saveCookie}
              onLogin={session.loginPixiv}
              onClearCookie={session.clearCookie}
              oauth={session.oauth}
              onSaveOAuth={session.saveOAuthCredentials}
              onLoginOAuth={session.loginOAuth}
              onClearOAuth={session.clearOAuth}
              onPickDir={() => void pickDir()}
              onOpenDir={openDir}
              onClose={() => {
                setSettingsOpen(false)
                persistConfig()
              }}
            />
          ) : null}
        </div>
        <TourProvider blocked={settingsOpen || filterOpen || tagsOpen || updateOpen || Boolean(preview)} />
        {/* 位置与可关闭沿用旧提示条的习惯：底部居中、最多同时 3 条 */}
        <Toaster position="bottom-center" closeButton visibleToasts={3} />
      </ImagePreviewProvider>
    </I18nProvider>
  )
}
