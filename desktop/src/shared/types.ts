export interface PixivWork {
  id: string
  title: string
  userId: string
  userName: string
  url: string
  pageCount: number
  width: number
  height: number
  /** 0 全年龄，1 R-18，2 R-18G */
  xRestrict?: number
  /** 作品类型：0 插画，1 漫画，2 动图（ugoira） */
  illustType?: number
  /** 作品标签（接口返回的原始标签） */
  tags?: string[]
  /** 发布时间，ISO 字符串 */
  createDate?: string
  /** 1 非 AI，2 AI 生成 */
  aiType?: number
}

export type WorkSource = 'tag' | 'bookmarks'
export type BookmarkRest = 'show' | 'hide'
export type R18Filter = 'any' | 'only' | 'exclude'
/** 多标签组合方式：and 同时满足，or 任一满足 */
export type TagMode = 'and' | 'or'
/** 下载质量：regular 常规图（约 1200px），original 高清原图 */
export type ImageQuality = 'regular' | 'original'
/** 动图保存格式：zip 保留帧压缩包，mp4 / gif 转码后保存 */
export type UgoiraFormat = 'zip' | 'mp4' | 'gif'

/** 动图帧：文件名 + 该帧展示时长（毫秒） */
export interface UgoiraFrame {
  file: string
  delay: number
}

export interface AppConfig {
  userId: string
  tag: string
  /** 多标签组合：附加包含标签，逗号/空格/顿号分隔 */
  tagExtra: string
  /** 多标签组合：排除标签，逗号/空格/顿号分隔 */
  tagExclude: string
  /** 多标签组合方式 */
  tagMode: TagMode
  offset: number
  limit: number
  workers: number
  delay: number
  outDir: string
  /** 下载质量：常规图 / 高清原图 */
  imageQuality: ImageQuality
  /** 动图保存格式：zip / mp4 / gif */
  ugoiraFormat: UgoiraFormat
  /** 作品来源：作者标签 / 收藏夹 */
  source: WorkSource
  /** 文件名模板，变量见 shared/template.ts */
  fileNameTemplate: string
  /** 收藏夹所属用户 ID，留空表示当前登录账号 */
  bookmarkUserId: string
  /** 收藏夹接口级标签过滤，留空表示全部收藏 */
  bookmarkTag: string
  /** 公开收藏 / 私密收藏 */
  bookmarkRest: BookmarkRest
  /** 收藏夹同步时只保留未下载作品 */
  bookmarkOnlyNew: boolean
  /** 过滤规则：页数区间，0 表示不限 */
  filterMinPages: number
  filterMaxPages: number
  /** 过滤规则：原图最小宽高，0 表示不限 */
  filterMinWidth: number
  filterMinHeight: number
  /** 过滤规则：排除标签，逗号或空格分隔 */
  filterExcludeTags: string
  /** 过滤规则：标题排除关键词，逗号或空格分隔 */
  filterExcludeKeywords: string
  /** 过滤规则：内容分级 */
  filterR18: R18Filter
  /** 过滤规则：排除 AI 生成作品 */
  filterExcludeAi: boolean
  /** 接口请求最大并发 */
  throttleApiConcurrency: number
  /** 接口两次请求的最小间隔（毫秒） */
  throttleApiInterval: number
  /** 图片 CDN 最大并发 */
  throttleCdnConcurrency: number
  /** 图片 CDN 两次请求的最小间隔（毫秒） */
  throttleCdnInterval: number
  /** 同时运行的下载任务数上限；1 表示串行 */
  parallelJobs: number
  /** 界面主题：亮色 / 暗色 / 跟随系统 */
  theme: ThemeMode
  /** 界面语言 */
  locale: Locale
  /** 应用内网络代理 */
  proxy: ProxyConfig
}

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5'

/**
 * 应用内代理设置。
 * 密码不落在这里：只保存账号名，密码由主进程用 `safeStorage` 加密后单独存储。
 */
export interface ProxyConfig {
  enabled: boolean
  protocol: ProxyProtocol
  host: string
  port: number
  /** HTTP / HTTPS 代理的认证账号；SOCKS 不支持认证 */
  username: string
  /** 不走代理的地址列表，格式同 Chromium 的 proxy bypass rules */
  bypassRules: string
}

export interface ProxyState {
  config: ProxyConfig
  /** 是否已保存代理密码（密码本身不会返回渲染层） */
  hasPassword: boolean
  /** 最近一次应用是否成功；关闭代理时恒为 true */
  applied: boolean
  /** 最近一次应用失败的原因 */
  error?: string
  /** Chromium 解析出的实际路由，如 `PROXY 127.0.0.1:10808`、`DIRECT` */
  resolved?: string
}

export interface ProxyTestResult {
  ok: boolean
  latencyMs: number
  /** 收到的 HTTP 状态码；网络层失败时没有 */
  status?: number
  message: string
}

export type ThemeMode = 'light' | 'dark' | 'system'

export type Locale = 'zh-CN' | 'en' | 'ja'

export type CookieSource = 'env' | 'file' | 'none'

export interface CookieStatus {
  hasCookie: boolean
  masked: string
  source: CookieSource
}

/**
 * Cookie 体检结论。
 * `unknown` 表示请求没打到 pixiv（超时、代理不通），
 * 它不能和 `expired` 混为一谈，否则网络抖动会误报成「要重新登录」。
 */
export type CookieHealth = 'valid' | 'expired' | 'unknown'

export interface CollectParams {
  userId: string
  tag: string
  extraTag?: string
  excludeTag?: string
  tagMode?: TagMode
  offset: number
  limit: number
  workers: number
  source: WorkSource
  bookmarkUserId: string
  bookmarkTag: string
  bookmarkRest: BookmarkRest
}

export interface SelfUser {
  id: string
  name: string
  /** pixiv 账号名，即 @ 后面的那串 */
  account: string
  /** 头像地址；i.pximg.net 有防盗链，主进程已统一补 Referer */
  avatar: string
  /** 是否为高级会员 */
  premium: boolean
}

export interface FollowUser {
  id: string
  name: string
  comment: string
  avatar: string
}

export interface FollowingParams {
  /** 留空表示当前登录账号 */
  userId: string
  offset: number
  limit: number
}

export interface FollowingResult {
  users: FollowUser[]
  total: number
}

export type WorkSort = 'default' | 'pages-desc' | 'pages-asc' | 'date-desc' | 'date-asc'

export interface WorkExportParams {
  works: PixivWork[]
  tag: string
  /** 已下载的作品 ID，导出时标记来源状态 */
  downloaded: string[]
}

export interface CollectProgress {
  loaded: number
  total: number
  pagesDone: number
  pagesTotal: number
}

export interface CollectResult {
  works: PixivWork[]
  total: number
  failedPages: number
}

export interface WorkPage {
  url: string
  /** 常规图地址（约 1200px） */
  regular?: string
  /** 高清原图地址 */
  original?: string
  width: number
  height: number
}

export interface TagSuggestion {
  tag: string
  translation?: string
}

export interface DownloadedParams {
  works: PixivWork[]
  tag: string
  outDir: string
}

export interface DownloadParams {
  works: PixivWork[]
  tag: string
  outDir: string
  workers: number
  delay: number
  /** 本次下载质量，缺省使用配置中的 imageQuality */
  imageQuality?: ImageQuality
  /** 本次动图保存格式，缺省使用配置中的 ugoiraFormat */
  ugoiraFormat?: UgoiraFormat
}

export type DownloadPhase = 'idle' | 'resolving' | 'downloading' | 'paused' | 'done'

export interface DownloadProgress {
  /** 所属队列任务 ID；并行下载时界面靠它区分不同任务的进度 */
  jobId?: string
  phase: DownloadPhase
  total: number
  done: number
  ok: number
  exists: number
  failed: number
  resolveFailed: number
  bytes: number
  resolvedWorks: number
  totalWorks: number
  startedAt: number
  /** 结束（完成或暂停）时间；存在时「用时」不再继续增长 */
  finishedAt?: number
}

export interface DownloadItemEvent {
  /** 所属队列任务 ID，便于并行下载时把条目归到对应任务 */
  jobId?: string
  status: 'ok' | 'exists' | 'replaced' | 'failed'
  label: string
  bytes: number
  error?: string
}

export interface DownloadSummary extends DownloadProgress {
  jobId: string
  outDir: string
  elapsedMs: number
  paused: boolean
}

/** queued：已加入队列，等待并行额度空出后由主进程自动启动 */
export type QueueStatus = 'queued' | 'resolving' | 'downloading' | 'paused' | 'done'

export type QueueTaskStatus = 'pending' | 'ok' | 'exists' | 'failed'

export interface QueueTask {
  illustId: string
  url: string
  dest: string
  label: string
  /** 0 基页码；动图为 0 */
  page?: number
  /** 原图尺寸，用于按质量校验已存在文件是否满足要求 */
  width?: number
  height?: number
  /** 动图任务：zip 下载地址之外的帧信息，转码时按顺序与时长编码 */
  frames?: UgoiraFrame[]
  /** 是否为动图任务（url 始终是帧压缩包地址） */
  ugoira?: boolean
  status: QueueTaskStatus
  bytes: number
  error?: string
}

export interface QueueJob {
  id: string
  tag: string
  outDir: string
  rootDir: string
  /** 任务创建时选择的下载质量，续传时沿用 */
  imageQuality?: ImageQuality
  /** 任务创建时的动图格式，续传时沿用 */
  ugoiraFormat?: UgoiraFormat
  status: QueueStatus
  createdAt: number
  updatedAt: number
  works: PixivWork[]
  tasks: QueueTask[]
  progress: DownloadProgress
  /** 解析失败的作品（没有分页任务，续传时会重新解析） */
  resolveFailures?: QueueResolveFailure[]
  /** 入队时记录的并发与间隔：调度器启动任务时沿用，避免用户中途改设置影响已排队任务 */
  workers?: number
  delay?: number
  /** 失败项逐条重试：排队启动时按此范围重置，启动后清空 */
  retry?: { taskUrls?: string[]; illustIds?: string[] }
  /** 单一作者作品的作者 ID；多作者任务为空 */
  artistId?: string
  /** 任务归属展示用，单一作者为「{userId}-{userName}」，多作者为「N 位作者」 */
  artistLabel?: string
}

export interface QueueResolveFailure {
  illustId: string
  title: string
  error: string
}

/** 失败清单条目：图片下载失败或作品解析失败 */
export interface FailureItem {
  kind: 'image' | 'work'
  /** 作品 ID（图片失败时也能定位到作品） */
  illustId: string
  label: string
  error: string
  url?: string
}

/** 给渲染层展示的队列任务摘要 */
export interface QueueSummary {
  id: string
  tag: string
  rootDir: string
  status: QueueStatus
  /** 任务当前阶段，用于任务卡片显示「解析中 / 下载中」 */
  phase: DownloadProgress['phase']
  /** 单一作者作品的作者 ID，用于入队去重；多作者任务为空 */
  artistId?: string
  /** 任务归属展示用，单一作者为「{userId}-{userName}」，多作者为「N 位作者」 */
  artistLabel?: string
  createdAt: number
  updatedAt: number
  totalWorks: number
  total: number
  pending: number
  ok: number
  exists: number
  failed: number
  /** 解析失败的作品数（不计入 failed，单独展示） */
  resolveFailed: number
  bytes: number
}

export type ThrottleKind = 'api' | 'cdn'

export interface ThrottleState {
  kind: ThrottleKind
  maxConcurrency: number
  concurrency: number
  minInterval: number
  penalty: number
  active: number
  cooldownUntil: number
}

/** 批量同步选中的画师 */
export interface BatchArtist {
  id: string
  name: string
}

export interface BatchSyncParams {
  artists: BatchArtist[]
  tag: string
  outDir: string
  workers: number
  delay: number
  imageQuality?: ImageQuality
  ugoiraFormat?: UgoiraFormat
}

/** 批量同步进度：始终指向当前正在处理的那位画师 */
export interface BatchSyncProgress {
  /** 1 基序号 */
  index: number
  total: number
  artist: BatchArtist
  phase: 'collecting' | 'downloading' | 'done' | 'failed'
  /** 已抓取到的作品数 */
  works: number
  /** 该画师已处理的文件数 */
  files: number
  failed: number
}

export interface BatchArtistResult {
  artist: BatchArtist
  works: number
  files: number
  failed: number
  error?: string
}

export interface BatchSyncSummary {
  artists: BatchArtistResult[]
  total: number
  ok: number
  failed: number
  /** 用户中途取消 */
  aborted: boolean
}

/** 下载历史条目：按文件记录，供本地图库补充标题/作者等元数据 */
export interface HistoryEntry {
  illustId: string
  title: string
  userId: string
  userName: string
  tag: string
  /** 0 基页码；动图为 0 */
  page: number
  path: string
  bytes: number
  ugoira: boolean
  at: number
}

export interface LibraryFile {
  page: number
  path: string
  name: string
  bytes: number
  ext: string
}

/** 本地图库中的一个作品（按「标签目录 + 作品 ID」聚合） */
export interface LibraryWork {
  id: string
  title: string
  userId: string
  userName: string
  tag: string
  /** 实际存在的页数（按文件名页码去重后统计） */
  pageCount: number
  files: LibraryFile[]
  totalBytes: number
  updatedAt: number
  /** 封面文件绝对路径 */
  cover: string
  ugoira: boolean
  /** 是否命中下载历史索引（否则标题/作者为推断值） */
  hasHistory: boolean
}

export interface LibraryResult {
  outDir: string
  scannedAt: number
  works: LibraryWork[]
  totalFiles: number
  totalBytes: number
  tags: string[]
}

/**
 * 自动更新状态：由主进程推送，渲染层只负责展示。
 * `unsupported` 表示开发环境或非打包运行，此时不做更新检查。
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | {
      state: 'downloading'
      version: string
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { state: 'downloaded'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unsupported' }

export interface PixivApi {
  getConfig: () => Promise<AppConfig>
  setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  getCookie: () => Promise<CookieStatus>
  setCookie: (raw: string) => Promise<CookieStatus>
  /**
   * 打开应用内 pixiv 登录窗口，登录成功后自动抓取会话 Cookie 并保存。
   * 用户取消或直接关窗时返回 null。
   */
  loginPixiv: () => Promise<CookieStatus | null>
  /** 清除已保存的 Cookie，并重置应用内登录窗口的会话 */
  clearCookie: () => Promise<CookieStatus>
  /**
   * Cookie 体检：主动打一次 pixiv 接口判断是否还有效。
   * 未配置 Cookie 时返回 'expired'。
   */
  checkCookieHealth: () => Promise<CookieHealth>
  /**
   * 订阅「接口返回 401/403」的通知。
   * 业务进行中 Cookie 才失效时，靠这个把提醒推给界面。
   * 返回取消订阅函数。
   */
  onCookieInvalid: (handler: () => void) => () => void
  pickDir: () => Promise<string | null>
  openDir: (dir: string) => Promise<void>
  collectWorks: (params: CollectParams) => Promise<CollectResult>
  getSelfUser: () => Promise<SelfUser | null>
  getFollowing: (params: FollowingParams) => Promise<FollowingResult>
  exportWorks: (params: WorkExportParams) => Promise<string | null>
  getWorkPages: (illustId: string) => Promise<WorkPage[]>
  suggestTags: (word: string) => Promise<TagSuggestion[]>
  /** 扫描本地图库（下载目录），返回按作品聚合的结果；force 为 true 时忽略缓存 */
  listLibrary: (force?: boolean) => Promise<LibraryResult>
  /** 打开本地图库中某作品所在的文件夹 */
  openLibraryDir: (dir: string) => Promise<void>
  /** 删除本地图库文件（仅限保存目录内），返回重新扫描后的图库 */
  deleteLibraryFiles: (paths: string[]) => Promise<LibraryResult>
  checkDownloaded: (params: DownloadedParams) => Promise<string[]>
  /** 加入下载队列：立即返回队列快照，任务由主进程按并行额度自动启动 */
  enqueueDownload: (params: DownloadParams) => Promise<QueueSummary[]>
  /** 批量同步：选中多位画师，按当前标签与过滤规则逐个「抓取 → 下载」 */
  batchSync: (params: BatchSyncParams) => Promise<BatchSyncSummary>
  cancelDownload: () => Promise<boolean>
  onBatchProgress: (callback: (progress: BatchSyncProgress) => void) => () => void
  listQueue: () => Promise<QueueSummary[]>
  /** 把未完成任务重新放回队列（排队等待额度） */
  resumeQueue: (id: string) => Promise<QueueSummary[]>
  /** 暂停单个任务：运行中立即中止，排队中直接转为未完成 */
  pauseQueue: (id: string) => Promise<QueueSummary[]>
  removeQueue: (id: string) => Promise<QueueSummary[]>
  listFailures: (jobId: string) => Promise<FailureItem[]>
  /** 重试失败清单中的单条（图片或作品解析），其余失败项保持不变 */
  retryFailure: (jobId: string, item: FailureItem) => Promise<QueueSummary[]>
  exportFailures: (jobId: string) => Promise<string | null>
  getThrottle: () => Promise<ThrottleState[]>
  /** 读取当前代理配置与生效状态 */
  getProxy: () => Promise<ProxyState>
  /**
   * 保存并立即应用代理设置。
   * `password` 传 undefined 表示保持已保存的密码，传空串表示清除密码。
   */
  setProxy: (patch: Partial<ProxyConfig>, password?: string) => Promise<ProxyState>
  /** 通过当前代理请求一次 pixiv 首页，用于验证连通性 */
  testProxy: () => Promise<ProxyTestResult>
  onQueueChanged: (callback: (jobs: QueueSummary[]) => void) => () => void
  /** 队列任务自动启动失败（如 Cookie 失效、目录非法）时通知界面 */
  onQueueError: (callback: (message: string) => void) => () => void
  onThrottle: (callback: (state: ThrottleState) => void) => () => void
  /** 保存目录被外部增删文件时触发，用于自动刷新图库 */
  onLibraryChanged: (callback: () => void) => () => void
  onCollectProgress: (callback: (progress: CollectProgress) => void) => () => void
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
  onDownloadItem: (callback: (item: DownloadItemEvent) => void) => () => void
  onDownloadDone: (callback: (summary: DownloadSummary) => void) => () => void
  /** 当前应用版本号，如 0.2.2 */
  getVersion: () => Promise<string>
  /** 读取最近一次更新状态（事件可能在界面订阅之前就已发生） */
  getUpdateStatus: () => Promise<UpdateStatus>
  /** 手动检查更新，返回检查后的状态；下载仍会在后台继续 */
  checkForUpdates: () => Promise<UpdateStatus>
  /** 重启并安装已下载的更新；返回 false 表示当前没有可安装的更新 */
  installUpdate: () => Promise<boolean>
  /** 订阅更新状态变化，返回取消订阅函数 */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
}
