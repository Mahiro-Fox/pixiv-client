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
  /** 所属系列；详情接口会带 seriesNavData，列表接口通常没有 */
  series?: WorkSeriesNav | null
}

export type WorkSource = 'tag' | 'bookmarks'
export type BookmarkRest = 'show' | 'hide'
/** 写操作的可见性：公开 / 私密（pixiv App API 的 restrict） */
export type BookmarkPrivacy = 'public' | 'private'

/** 作品收藏状态；restrict 在取消收藏后仍保留上一次的选择 */
export interface BookmarkState {
  bookmarked: boolean
  restrict: BookmarkPrivacy
}

export interface BookmarkInput {
  bookmarked: boolean
  /** 收藏时的可见性；取消收藏时忽略 */
  restrict?: BookmarkPrivacy
}

export interface FollowInput {
  followed: boolean
  /** 关注时的可见性；取关时忽略 */
  restrict?: BookmarkPrivacy
}
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
  /** 全局屏蔽：作品标签，逗号或空格分隔；搜索、用户作品、收藏与下载均生效 */
  blockTags: string
  /** 全局屏蔽：用户 ID 或作者名，逗号或空格分隔 */
  blockUsers: string
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
 * App API（OAuth）连接状态。
 * 写操作（收藏、关注）走 `app-api.pixiv.net` + Bearer，与 Cookie 读取链路是两套凭据。
 */
export interface OAuthStatus {
  /** 凭据齐全且可用（已保存并校验通过） */
  connected: boolean
  /** client_id / client_secret 是否已填 */
  hasClient: boolean
  /** refresh_token 末四位，用于确认当前是哪一份凭据 */
  tail: string
  /** access_token 过期时间戳（毫秒）；未换取过则为 null */
  expiresAt: number | null
  /** pixiv 用户 id，刷新 token 时一并返回 */
  userId: string | null
}

/**
 * App API 凭据，全部由用户自行填写并保存在本地，源码不含任何密钥。
 * client_id / client_secret 取自 pixiv 官方 Android 客户端，需用户自行获取。
 */
export interface OAuthCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

/** PKCE 授权登录的客户端常量；留空则用内置默认值 */
export interface OAuthClientInput {
  clientId?: string
  clientSecret?: string
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
  /** 关注列表接口每个用户自带的前 4 个作品缩略图 */
  works?: UserWorkThumb[]
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

/**
 * 任务阶段。结束态有四种，语义互斥：
 * - `done`：全部成功
 * - `paused`：用户暂停或软件退出，可原地继续
 * - `cancelled`：用户取消，保留已下载的文件，可重新开始
 * - `error`：跑完了但有失败项（下载失败 / 解析失败 / 熔断中止），需要人工处理
 */
export type DownloadPhase =
  | 'idle'
  | 'resolving'
  | 'downloading'
  | 'paused'
  | 'cancelled'
  | 'error'
  | 'done'

/** 中止原因：三条路径共用一个 AbortController，靠 reason 区分 */
export type AbortReason = 'pause' | 'cancel' | 'shutdown'

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
  /** 本次结束如果是被中止的，这里给出是哪条路径发起的 */
  abortReason?: AbortReason
}

/** queued：已加入队列，等待并行额度空出后由主进程自动启动 */
export type QueueStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'paused'
  | 'cancelled'
  | 'error'
  | 'done'

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
  /** 实际尝试次数（含任务级重试）；1 表示一次就成/一次就放弃 */
  attempts?: number
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
  /** status 为 error 时的原因摘要（失败项统计 / 熔断说明 / 启动前校验失败） */
  error?: string
}

export interface QueueResolveFailure {
  illustId: string
  title: string
  error: string
  /** 该错误是否值得重试（404、403 这类确定性错误为 false） */
  retryable?: boolean
}

/** 失败清单条目：图片下载失败或作品解析失败 */
export interface FailureItem {
  kind: 'image' | 'work'
  /** 作品 ID（图片失败时也能定位到作品） */
  illustId: string
  label: string
  error: string
  url?: string
  /** false 表示重试也不会成功（作品已删除、没有权限等），界面据此提示 */
  retryable?: boolean
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
  /** status 为 error 时的原因摘要，卡片上直接展示 */
  error?: string
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

/** 浏览记录条目：同一作品只保留一条，重复打开时更新为最近一次 */
export interface ViewHistoryEntry {
  /** 作品 ID */
  id: string
  title: string
  userId: string
  userName: string
  /** 250px 缩略图地址 */
  thumbnail: string
  pageCount: number
  /** 0 全年龄，1 R-18，2 R-18G */
  xRestrict: number
  /** 0 插画，1 漫画，2 动图 */
  illustType: number
  /** 最近一次浏览时间戳（毫秒） */
  at: number
}

/** 写入浏览记录时只需要作品的展示信息，时间由主进程补 */
export interface ViewRecordInput {
  id: string
  title: string
  userId: string
  userName: string
  /** 原图或任意尺寸地址，主进程会统一收敛成缩略图 */
  url: string
  pageCount: number
  xRestrict?: number
  illustType?: number
}

/**
 * 稍后看条目：手动加入、只保存在本地。
 * 与浏览记录的字段同构，区别是 `at` 表示「加入时间」而不是浏览时间。
 */
export interface WatchLaterEntry {
  /** 作品 ID */
  id: string
  title: string
  userId: string
  userName: string
  /** 250px 缩略图地址 */
  thumbnail: string
  pageCount: number
  /** 0 全年龄，1 R-18，2 R-18G */
  xRestrict: number
  /** 0 插画，1 漫画，2 动图 */
  illustType: number
  /** 加入时间戳（毫秒） */
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

/** 小说搜索排序：最新 / 最早 / 综合人气 / 男性人气 / 女性人气 */
export type NovelOrder =
  | 'date_d'
  | 'date'
  | 'popular_d'
  | 'popular_male_d'
  | 'popular_female_d'

/** 小说搜索分级：all 含 R-18，safe 仅全年龄 */
export type NovelSearchMode = 'all' | 'safe'

/** 小说搜索匹配方式：标签精确 / 标签包含 / 标题与简介 */
export type NovelSearchTarget = 's_tag_full' | 's_tag' | 's_tc'

export interface NovelSearchParams {
  word: string
  order: NovelOrder
  mode: NovelSearchMode
  target: NovelSearchTarget
  page: number
}

/** 搜索结果与系列目录共用的小说摘要 */
export interface NovelWork {
  id: string
  title: string
  userId: string
  userName: string
  /** 封面地址（i.pximg.net 有防盗链，主进程已统一补 Referer） */
  cover: string
  tags: string[]
  /** 0 全年龄，1 R-18，2 R-18G */
  xRestrict: number
  createDate: string
  updateDate?: string
  /** 正文字符数 */
  textCount: number
  /** 词数（pixiv 按语言估算） */
  wordCount: number
  /** 预计阅读秒数 */
  readingTime: number
  bookmarkCount: number
  description: string
  seriesId?: string
  seriesTitle?: string
  /** 在系列中的序号，从 1 开始 */
  seriesOrder?: number
  /** 1 非 AI，2 AI 生成 */
  aiType?: number
}

export interface NovelSearchResult {
  novels: NovelWork[]
  total: number
  /** 接口允许翻到的最后一页（pixiv 上限 10） */
  lastPage: number
  relatedTags: string[]
}

/** 插画 / 漫画所属系列（来自作品的 seriesNavData；不属于任何系列时为 null） */
export interface WorkSeriesNav {
  id: string
  title: string
  /** 本话在系列里的序号，从 1 起 */
  order: number
  isConcluded: boolean
}

/** 系列里的一话 */
export interface SeriesEpisode {
  id: string
  title: string
  /** 序号，从 1 起；接口缺失时按数组顺序补 */
  order: number
  thumbnail: string
  userId: string
  userName: string
  pageCount: number
  xRestrict: number
  illustType: number
}

export interface SeriesDetail {
  id: string
  title: string
  caption: string
  userId: string
  userName: string
  /** 作者头像 */
  avatar: string
  /** 系列封面 */
  cover: string
  /** 话数；网页兜底拿不到总话数时为 0（未知） */
  workCount: number
  isConcluded: boolean
  /** 是否已在 App API 的漫画追更列表里；网页兜底或未连接 OAuth 时恒为 false */
  watchlisted: boolean
  episodes: SeriesEpisode[]
  /** 数据来源：App API 详情，或网页作品页的系列信息兜底 */
  source: 'app' | 'web'
}

/** 读取系列详情的参数：workId 用于没有 App API 凭据时从作品页兜底 */
export interface WorkSeriesParams {
  seriesId: string
  /** 当前作品 ID；网页兜底时用来定位所属系列 */
  workId?: string
}

/** 系列内上一话 / 下一话 */
export interface NovelEpisodeRef {
  id: string
  title: string
  order: number
}

export interface NovelSeriesNav {
  id: string
  title: string
  order: number
  isConcluded: boolean
  prev: NovelEpisodeRef | null
  next: NovelEpisodeRef | null
}

export interface NovelDetail extends NovelWork {
  /** 正文原始标记文本：含 [newpage]、[[rb:..]]、[chapter:..] 等 */
  content: string
  /** 按 [newpage] 切分后的页数 */
  pageCount: number
  language?: string
  isOriginal?: boolean
  series: NovelSeriesNav | null
  /** 正文内嵌图片：键为正文中的图片 ID */
  embeddedImages: Record<string, string>
}

export interface NovelSeries {
  id: string
  title: string
  caption: string
  cover: string
  userId: string
  userName: string
  tags: string[]
  xRestrict: number
  isConcluded: boolean
  publishedContentCount: number
  publishedTotalCharacterCount: number
  publishedReadingTime: number
  updateDate: string
}

export interface NovelEpisode extends NovelWork {
  /** 系列内序号，从 1 开始 */
  order: number
}

export interface NovelSeriesDetail {
  series: NovelSeries
  episodes: NovelEpisode[]
}

export interface NovelDownloadParams {
  /** 单篇下载时传小说 ID */
  novelId?: string
  /** 下载整部系列时传系列 ID */
  seriesId?: string
  outDir?: string
}

export interface NovelDownloadResult {
  path: string
  title: string
  episodes: number
  characters: number
}

export interface NovelDownloadProgress {
  done: number
  total: number
  title: string
}

/** 本地小说书库条目：扫描保存目录下的 小说/ 得到 */
export interface NovelLibraryItem {
  path: string
  fileName: string
  title: string
  author: string
  size: number
  updatedAt: string
  characters: number
  episodes: number
  kind: 'novel' | 'series'
  novelId?: string
  seriesId?: string
  cover: string
  tags: string[]
}

export interface NovelLibraryResult {
  items: NovelLibraryItem[]
  root: string
}

/** 正文检索命中的文件，snippets 里已含关键词上下文 */
export interface NovelTextHit {
  path: string
  title: string
  author: string
  matches: number
  snippets: string[]
}

export interface NovelTextSearchResult {
  hits: NovelTextHit[]
  scanned: number
}

/** 作品搜索栏目：插画 / 漫画（小说走 NovelSearchParams） */
export type WorkSearchKind = 'illust' | 'manga'

/** 作品搜索排序，与 pixiv 的 order 参数一致 */
export type WorkSearchOrder =
  | 'date_d'
  | 'date'
  | 'popular_d'
  | 'popular_male_d'
  | 'popular_female_d'

/** 作品搜索分级：all 全部，safe 仅全年龄，r18 仅 R-18（需登录） */
export type WorkSearchMode = 'all' | 'safe' | 'r18'

/** 搜索范围：s_tag 仅标签，s_tag_tc 标签 + 标题 + 说明 */
export type WorkSearchScope = 'tag' | 'tag_tc'

export interface WorkSearchParams {
  kind: WorkSearchKind
  word: string
  order: WorkSearchOrder
  mode: WorkSearchMode
  page: number
  /** 按作者整合（csw=1） */
  csw?: boolean
  /** 收藏数下限，0 或省略表示不限（blt） */
  blt?: number
  /** 搜索范围 */
  scope?: WorkSearchScope
  /** 插画搜索时把漫画结果一并合并进来（对应「包含漫画」） */
  includeManga?: boolean
}

/**
 * 接口返回的筛选建议（suggestChips）。
 * pixiv 给的是网页路由 url，这里已解析成相对当前搜索的参数增量，
 * 前端只需按 params 切换 URL 状态即可，不用关心它的原始 url。
 */
export interface WorkSearchChip {
  id: string
  label: string
  premium: boolean
  params: {
    order?: WorkSearchOrder
    mode?: 'safe' | 'r18'
    csw?: '1'
    blt?: string
    scope?: WorkSearchScope
    includeManga?: '1'
  }
}

/** 搜索结果作品：比 PixivWork 多出列表专用的缩略图与收藏数 */
export interface SearchWork {
  id: string
  title: string
  userId: string
  userName: string
  /** 列表缩略图（约 250px） */
  thumbnail: string
  /** 作者头像 */
  profileImageUrl: string
  pageCount: number
  width: number
  height: number
  xRestrict: number
  illustType: number
  tags: string[]
  createDate: string
  bookmarkCount: number
  aiType: number
  /** 排行榜名次；只有排行榜来源才带该字段 */
  rank?: number
  /** 所属系列；不属于任何系列或接口未返回时为 null */
  series?: WorkSeriesNav | null
}

export interface WorkSearchResult {
  works: SearchWork[]
  total: number
  /** 接口允许翻到的最后一页 */
  lastPage: number
  relatedTags: string[]
  /** 标签翻译：标签 -> 当前展示语言文本（无译文时不包含该键） */
  tagTranslation: Record<string, string>
  /** 接口给出的筛选建议，随当前筛选状态变化 */
  chips: WorkSearchChip[]
  /** 可选的收藏数下限（bookmarkRanges），用于「高收藏数作品」类筛选 */
  bookmarkRanges: number[]
}

export interface UserSearchParams {
  word: string
  page: number
  /** 只看投稿过作品的用户；false 为全部用户 */
  postedOnly: boolean
}

/** 用户搜索结果里的前四个作品缩略图 */
export interface UserWorkThumb {
  id: string
  url: string
}

export interface UserSearchItem {
  id: string
  name: string
  comment: string
  avatar: string
  /** 该用户的前四个作品缩略图 */
  works: UserWorkThumb[]
}

export interface UserSearchResult {
  users: UserSearchItem[]
  total: number
}

/** 排行榜榜单类型，与 pixiv ranking.php 的 mode 参数一致 */
export type RankingMode =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'rookie'
  | 'original'
  | 'male'
  | 'female'

export interface RankingParams {
  kind: WorkSearchKind
  mode: RankingMode
  page: number
  /** YYYYMMDD；留空表示最新一期 */
  date?: string
}

export interface RankingResult {
  works: SearchWork[]
  page: number
  lastPage: number
  total: number
  /** 本期榜单对应的日期（YYYYMMDD） */
  date: string
  /** 可翻到的下一期日期；空字符串表示没有 */
  nextDate: string
}

export interface RecommendWorksParams {
  kind: WorkSearchKind
  /** 上一批返回的 nextUrl；首屏留空 */
  nextUrl?: string
  /** 未连接 App API 时，网页发现接口使用的分级 */
  mode?: WorkSearchMode
}

export interface RecommendWorksResult {
  works: SearchWork[]
  /** 继续加载的地址；空字符串表示没有更多 */
  nextUrl: string
  /** app = 个性化推荐，web = 网页发现兜底 */
  source: 'app' | 'web'
}

export interface RecommendUsersParams {
  /** 上一批返回的 nextUrl；首屏留空 */
  nextUrl?: string
}

export interface RecommendUsersResult {
  users: UserSearchItem[]
  /** 继续加载的地址；空字符串表示没有更多 */
  nextUrl: string
}

/** 用户详情页的栏目 */
export type UserContentTab = 'illust' | 'manga' | 'novel' | 'bookmarks'

export interface UserProfile {
  id: string
  name: string
  comment: string
  avatar: string
  background: string
  premium: boolean
  /** 关注数 */
  following: number
  /** 各栏目作品数（来自 profile/all） */
  counts: { illust: number; manga: number; novel: number }
}

export interface UserContentParams {
  userId: string
  tab: UserContentTab
  page: number
  limit?: number
  /** 收藏栏目专用：公开 / 私密收藏，缺省为公开 */
  bookmarkRest?: BookmarkRest
  /** 收藏栏目专用：只取该标签下的收藏，留空为全部 */
  bookmarkTag?: string
}

export interface UserContentResult {
  /** 插画 / 漫画 / 收藏的作品 */
  works: SearchWork[]
  /** 小说栏目 */
  novels: NovelWork[]
  total: number
  hasMore: boolean
}

/**
 * 自动更新状态：由主进程推送，渲染层只负责展示。
 * `unsupported` 表示开发环境或非打包运行，此时不做更新检查。
 *
 * 新版本由主进程在后台自动下载，因此 `available` 只是一瞬间的中间态，
 * 界面只在 `downloaded` 时弹窗问一句「现在重启安装吗」。
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
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
  /** App API 连接状态（写操作凭据） */
  getOAuthStatus: () => Promise<OAuthStatus>
  /** 保存并校验凭据：立即刷新一次，失败则不落盘 */
  saveOAuthCredentials: (credentials: OAuthCredentials) => Promise<OAuthStatus>
  /**
   * 打开 pixiv 授权页登录，用 PKCE 授权码自动换取并保存 refresh_token。
   * 用户关闭窗口或拒绝授权时返回 null。
   */
  loginOAuth: (client?: OAuthClientInput) => Promise<OAuthStatus | null>
  /** 清除 OAuth 凭据（不影响 Cookie） */
  clearOAuth: () => Promise<OAuthStatus>
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
  /** 订阅凭据状态变化（例如登录后静默完成的授权） */
  onOAuthChanged: (handler: (status: OAuthStatus) => void) => () => void
  pickDir: () => Promise<string | null>
  openDir: (dir: string) => Promise<void>
  collectWorks: (params: CollectParams) => Promise<CollectResult>
  getSelfUser: () => Promise<SelfUser | null>
  getFollowing: (params: FollowingParams) => Promise<FollowingResult>
  exportWorks: (params: WorkExportParams) => Promise<string | null>
  getWorkPages: (illustId: string) => Promise<WorkPage[]>
  /** 只有作品 id 时按 id 补全详情（标题/作者/标签等），失败返回 null */
  getWorkDetail: (illustId: string) => Promise<SearchWork | null>
  /** 搜索框下拉用的热门标签 */
  getTrendingTags: () => Promise<TagSuggestion[]>
  /** 官方排行榜：插画 / 漫画 × 日 / 周 / 月 / 新人 / 原创 / 男性向 / 女性向 */
  listRanking: (params: RankingParams) => Promise<RankingResult>
  /** 推荐作品：已连接 App API 时个性化推荐，否则网页发现兜底 */
  listRecommendedWorks: (params: RecommendWorksParams) => Promise<RecommendWorksResult>
  /** 推荐画师：走 App API，需要 OAuth 凭据 */
  listRecommendedUsers: (params: RecommendUsersParams) => Promise<RecommendUsersResult>
  suggestTags: (word: string) => Promise<TagSuggestion[]>
  /** 扫描本地图库（下载目录），返回按作品聚合的结果；force 为 true 时忽略缓存 */
  listLibrary: (force?: boolean) => Promise<LibraryResult>
  /** 打开本地图库中某作品所在的文件夹 */
  openLibraryDir: (dir: string) => Promise<void>
  /** 删除本地图库文件（仅限保存目录内），返回重新扫描后的图库 */
  deleteLibraryFiles: (paths: string[]) => Promise<LibraryResult>
  /** 浏览记录：按最近浏览时间倒序，同一作品只保留最后一条 */
  listViewHistory: () => Promise<ViewHistoryEntry[]>
  /** 记录一次作品浏览；只有作品 ID 与作者齐全时才写入 */
  recordView: (entry: ViewRecordInput) => Promise<void>
  /** 清空浏览记录，返回清空后的列表 */
  clearViewHistory: () => Promise<ViewHistoryEntry[]>
  /** 稍后看：按加入时间倒序 */
  listWatchLater: () => Promise<WatchLaterEntry[]>
  /** 该作品是否已在稍后看列表里 */
  isWatchLater: (id: string) => Promise<boolean>
  /** 加入稍后看，返回更新后的完整列表（已存在则不重复加入） */
  addWatchLater: (entry: ViewRecordInput) => Promise<WatchLaterEntry[]>
  /** 从稍后看移除，返回更新后的完整列表 */
  removeWatchLater: (id: string) => Promise<WatchLaterEntry[]>
  /** 清空稍后看，返回空列表 */
  clearWatchLater: () => Promise<WatchLaterEntry[]>
  /** 读取作品收藏状态（App API） */
  getBookmarkState: (workId: string) => Promise<BookmarkState>
  /** 收藏 / 取消收藏作品，返回最新状态 */
  setBookmark: (workId: string, input: BookmarkInput) => Promise<BookmarkState>
  /** 读取是否已关注该画师（App API） */
  getFollowState: (userId: string) => Promise<boolean>
  /** 关注 / 取关画师，返回最新状态 */
  setFollow: (userId: string, input: FollowInput) => Promise<boolean>
  /** 漫画 / 插画系列详情：已连接 App API 时取完整列表，否则用网页作品页的系列信息兜底 */
  getWorkSeries: (params: WorkSeriesParams) => Promise<SeriesDetail>
  /** 加入 / 退出系列的追更列表（App API 的 manga watchlist），需 OAuth 凭据 */
  setSeriesWatch: (seriesId: string, watch: boolean) => Promise<void>
  /** 读取小说收藏状态（App API）；需 OAuth 凭据 */
  getNovelBookmarkState: (novelId: string) => Promise<BookmarkState>
  /** 收藏 / 取消收藏小说，返回最新状态 */
  setNovelBookmark: (novelId: string, input: BookmarkInput) => Promise<BookmarkState>
  /** 读取小说系列是否已追更（App API）；未连接凭据时恒为 false */
  getNovelSeriesWatchState: (seriesId: string) => Promise<boolean>
  /** 加入 / 退出小说系列的追更列表（App API 的 novel watchlist） */
  setNovelSeriesWatch: (seriesId: string, watch: boolean) => Promise<void>
  checkDownloaded: (params: DownloadedParams) => Promise<string[]>
  /** 加入下载队列：立即返回队列快照，任务由主进程按并行额度自动启动 */
  enqueueDownload: (params: DownloadParams) => Promise<QueueSummary[]>
  /** 批量同步：选中多位画师，按当前标签与过滤规则逐个「抓取 → 下载」 */
  batchSync: (params: BatchSyncParams) => Promise<BatchSyncSummary>
  cancelDownload: () => Promise<boolean>
  /** 只中止批量同步，不影响队列里的普通任务 */
  cancelBatch: () => Promise<boolean>
  onBatchProgress: (callback: (progress: BatchSyncProgress) => void) => () => void
  listQueue: () => Promise<QueueSummary[]>
  /** 把未完成任务重新放回队列（排队等待额度） */
  resumeQueue: (id: string) => Promise<QueueSummary[]>
  /** 暂停单个任务：运行中立即中止，排队中直接转为未完成 */
  pauseQueue: (id: string) => Promise<QueueSummary[]>
  /** 取消单个任务：保留已下载文件，任务留在列表里显示「已取消」，可重新开始 */
  cancelQueue: (id: string) => Promise<QueueSummary[]>
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
  /** 作品搜索（插画 / 漫画） */
  searchWorks: (params: WorkSearchParams) => Promise<WorkSearchResult>
  /** 用户搜索 */
  searchUsers: (params: UserSearchParams) => Promise<UserSearchResult>
  /** 用户主页基础信息与各栏目作品数 */
  getUserProfile: (userId: string) => Promise<UserProfile>
  /** 用户主页各栏目的作品列表 */
  getUserContent: (params: UserContentParams) => Promise<UserContentResult>
  /** 小说搜索：关键词/标签，支持排序、分级与翻页 */
  searchNovels: (params: NovelSearchParams) => Promise<NovelSearchResult>
  /** 小说详情（含正文原始标记文本） */
  getNovelDetail: (novelId: string) => Promise<NovelDetail>
  /** 小说系列详情与章节目录 */
  getNovelSeries: (seriesId: string) => Promise<NovelSeriesDetail>
  /** 保存小说为 TXT：传 novelId 存单篇，传 seriesId 存整部系列 */
  downloadNovel: (params: NovelDownloadParams) => Promise<NovelDownloadResult>
  /** 订阅整部系列保存进度，返回取消订阅函数 */
  onNovelDownloadProgress: (callback: (progress: NovelDownloadProgress) => void) => () => void
  /** 扫描保存目录下的小说书库；force 为 true 时忽略缓存 */
  listNovelLibrary: (force?: boolean) => Promise<NovelLibraryResult>
  /** 在已下载小说的正文里检索关键词 */
  searchNovelLibrary: (keyword: string) => Promise<NovelTextSearchResult>
  /** 读取本地小说 TXT 内容，用于应用内阅读 */
  readNovelLibraryFile: (filePath: string) => Promise<string>
  /** 当前应用版本号，如 0.2.2 */
  getVersion: () => Promise<string>
  /** 读取最近一次更新状态（事件可能在界面订阅之前就已发生） */
  getUpdateStatus: () => Promise<UpdateStatus>
  /** 手动检查更新，返回检查后的状态；新版本由主进程自动在后台下载 */
  checkForUpdates: () => Promise<UpdateStatus>
  /** 重启并安装已下载的更新；返回 false 表示当前没有可安装的更新 */
  installUpdate: () => Promise<boolean>
  /** 订阅更新状态变化，返回取消订阅函数 */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
}
