import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppConfig,
  BatchSyncParams,
  BatchSyncProgress,
  BatchSyncSummary,
  BookmarkInput,
  BookmarkState,
  CollectParams,
  CollectProgress,
  CollectResult,
  CookieHealth,
  CookieStatus,
  DownloadItemEvent,
  DownloadParams,
  DownloadProgress,
  DownloadSummary,
  DownloadedParams,
  FailureItem,
  FollowingParams,
  FollowingResult,
  FollowInput,
  LibraryResult,
  NovelDetail,
  NovelDownloadParams,
  NovelDownloadProgress,
  NovelDownloadResult,
  NovelLibraryResult,
  NovelSearchParams,
  NovelSearchResult,
  NovelSeriesDetail,
  NovelTextSearchResult,
  OAuthCredentials,
  OAuthClientInput,
  OAuthStatus,
  PixivApi,
  ProxyConfig,
  ProxyState,
  ProxyTestResult,
  QueueSummary,
  RankingParams,
  RankingResult,
  RecommendUsersParams,
  RecommendUsersResult,
  RecommendWorksParams,
  RecommendWorksResult,
  SearchWork,
  SelfUser,
  TagSuggestion,
  ThrottleState,
  UpdateStatus,
  UserContentParams,
  UserContentResult,
  UserProfile,
  UserSearchParams,
  UserSearchResult,
  ViewHistoryEntry,
  ViewRecordInput,
  WorkExportParams,
  WorkPage,
  WorkSearchParams,
  WorkSearchResult
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PixivApi = {
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch) as Promise<AppConfig>,
  getCookie: () => ipcRenderer.invoke('cookie:get') as Promise<CookieStatus>,
  setCookie: (raw: string) => ipcRenderer.invoke('cookie:set', raw) as Promise<CookieStatus>,
  loginPixiv: () =>
    ipcRenderer.invoke('cookie:login') as Promise<CookieStatus | null>,
  clearCookie: () => ipcRenderer.invoke('cookie:clear') as Promise<CookieStatus>,
  checkCookieHealth: () => ipcRenderer.invoke('cookie:health') as Promise<CookieHealth>,
  getOAuthStatus: () => ipcRenderer.invoke('oauth:status') as Promise<OAuthStatus>,
  saveOAuthCredentials: (credentials: OAuthCredentials) =>
    ipcRenderer.invoke('oauth:save', credentials) as Promise<OAuthStatus>,
  clearOAuth: () => ipcRenderer.invoke('oauth:clear') as Promise<OAuthStatus>,
  loginOAuth: (client: OAuthClientInput) =>
    ipcRenderer.invoke('oauth:login', client) as Promise<OAuthStatus | null>,
  onCookieInvalid: (handler: () => void) => subscribe<unknown>('cookie:invalid', () => handler()),
  pickDir: () => ipcRenderer.invoke('dialog:pick-dir') as Promise<string | null>,
  openDir: (dir: string) => ipcRenderer.invoke('shell:open-dir', dir) as Promise<void>,
  collectWorks: (params: CollectParams) =>
    ipcRenderer.invoke('works:collect', params) as Promise<CollectResult>,
  getSelfUser: () => ipcRenderer.invoke('user:self') as Promise<SelfUser | null>,
  getFollowing: (params: FollowingParams) =>
    ipcRenderer.invoke('user:following', params) as Promise<FollowingResult>,
  exportWorks: (params: WorkExportParams) =>
    ipcRenderer.invoke('works:export', params) as Promise<string | null>,
  getWorkPages: (illustId: string) =>
    ipcRenderer.invoke('work:pages', illustId) as Promise<WorkPage[]>,
  getWorkDetail: (illustId: string) =>
    ipcRenderer.invoke('work:detail', illustId) as Promise<SearchWork | null>,
  getTrendingTags: () =>
    ipcRenderer.invoke('search:trendingTags') as Promise<TagSuggestion[]>,
  listRanking: (params: RankingParams) =>
    ipcRenderer.invoke('ranking:list', params) as Promise<RankingResult>,
  listRecommendedWorks: (params: RecommendWorksParams) =>
    ipcRenderer.invoke('recommend:works', params) as Promise<RecommendWorksResult>,
  listRecommendedUsers: (params: RecommendUsersParams) =>
    ipcRenderer.invoke('recommend:users', params) as Promise<RecommendUsersResult>,
  suggestTags: (word: string) =>
    ipcRenderer.invoke('tags:suggest', word) as Promise<TagSuggestion[]>,
  searchWorks: (params: WorkSearchParams) =>
    ipcRenderer.invoke('search:works', params) as Promise<WorkSearchResult>,
  searchUsers: (params: UserSearchParams) =>
    ipcRenderer.invoke('search:users', params) as Promise<UserSearchResult>,
  getUserProfile: (userId: string) =>
    ipcRenderer.invoke('user:profile', userId) as Promise<UserProfile>,
  getUserContent: (params: UserContentParams) =>
    ipcRenderer.invoke('user:content', params) as Promise<UserContentResult>,
  searchNovels: (params: NovelSearchParams) =>
    ipcRenderer.invoke('novel:search', params) as Promise<NovelSearchResult>,
  getNovelDetail: (novelId: string) =>
    ipcRenderer.invoke('novel:detail', novelId) as Promise<NovelDetail>,
  getNovelSeries: (seriesId: string) =>
    ipcRenderer.invoke('novel:series', seriesId) as Promise<NovelSeriesDetail>,
  downloadNovel: (params: NovelDownloadParams) =>
    ipcRenderer.invoke('novel:download', params) as Promise<NovelDownloadResult>,
  onNovelDownloadProgress: (callback: (progress: NovelDownloadProgress) => void) =>
    subscribe('novel:download-progress', callback),
  listNovelLibrary: (force?: boolean) =>
    ipcRenderer.invoke('novel:library', Boolean(force)) as Promise<NovelLibraryResult>,
  searchNovelLibrary: (keyword: string) =>
    ipcRenderer.invoke('novel:library-search', keyword) as Promise<NovelTextSearchResult>,
  readNovelLibraryFile: (filePath: string) =>
    ipcRenderer.invoke('novel:library-read', filePath) as Promise<string>,
  listLibrary: (force?: boolean) =>
    ipcRenderer.invoke('library:list', Boolean(force)) as Promise<LibraryResult>,
  openLibraryDir: (dir: string) => ipcRenderer.invoke('library:open-dir', dir) as Promise<void>,
  deleteLibraryFiles: (paths: string[]) =>
    ipcRenderer.invoke('library:delete', paths) as Promise<LibraryResult>,
  listViewHistory: () => ipcRenderer.invoke('viewHistory:list') as Promise<ViewHistoryEntry[]>,
  recordView: (entry: ViewRecordInput) =>
    ipcRenderer.invoke('viewHistory:record', entry) as Promise<void>,
  clearViewHistory: () => ipcRenderer.invoke('viewHistory:clear') as Promise<ViewHistoryEntry[]>,
  getBookmarkState: (workId: string) =>
    ipcRenderer.invoke('write:bookmarkState', workId) as Promise<BookmarkState>,
  setBookmark: (workId: string, input: BookmarkInput) =>
    ipcRenderer.invoke('write:setBookmark', workId, input) as Promise<BookmarkState>,
  getFollowState: (userId: string) =>
    ipcRenderer.invoke('write:followState', userId) as Promise<boolean>,
  setFollow: (userId: string, input: FollowInput) =>
    ipcRenderer.invoke('write:setFollow', userId, input) as Promise<boolean>,
  checkDownloaded: (params: DownloadedParams) =>
    ipcRenderer.invoke('works:downloaded', params) as Promise<string[]>,
  enqueueDownload: (params: DownloadParams) =>
    ipcRenderer.invoke('download:enqueue', params) as Promise<QueueSummary[]>,
  batchSync: (params: BatchSyncParams) =>
    ipcRenderer.invoke('batch:sync', params) as Promise<BatchSyncSummary>,
  cancelDownload: () => ipcRenderer.invoke('download:cancel') as Promise<boolean>,
  listQueue: () => ipcRenderer.invoke('queue:list') as Promise<QueueSummary[]>,
  resumeQueue: (id: string) => ipcRenderer.invoke('queue:resume', id) as Promise<QueueSummary[]>,
  pauseQueue: (id: string) => ipcRenderer.invoke('queue:pause', id) as Promise<QueueSummary[]>,
  removeQueue: (id: string) => ipcRenderer.invoke('queue:remove', id) as Promise<QueueSummary[]>,
  listFailures: (id: string) => ipcRenderer.invoke('queue:failures', id) as Promise<FailureItem[]>,
  retryFailure: (id: string, item: FailureItem) =>
    ipcRenderer.invoke('queue:retry-item', id, item) as Promise<QueueSummary[]>,
  exportFailures: (id: string) =>
    ipcRenderer.invoke('queue:export-failures', id) as Promise<string | null>,
  getThrottle: () => ipcRenderer.invoke('throttle:get') as Promise<ThrottleState[]>,
  getProxy: () => ipcRenderer.invoke('proxy:get') as Promise<ProxyState>,
  setProxy: (patch: Partial<ProxyConfig>, password?: string) =>
    ipcRenderer.invoke('proxy:set', patch, password) as Promise<ProxyState>,
  testProxy: () => ipcRenderer.invoke('proxy:test') as Promise<ProxyTestResult>,
  getVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  getUpdateStatus: () => ipcRenderer.invoke('update:status') as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke('update:check') as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke('update:install') as Promise<boolean>,
  onUpdateStatus: (callback: (status: UpdateStatus) => void) =>
    subscribe('update:status', callback),
  onQueueChanged: (callback: (jobs: QueueSummary[]) => void) =>
    subscribe('queue:changed', callback),
  onQueueError: (callback: (message: string) => void) =>
    subscribe('queue:error', callback),
  onThrottle: (callback: (state: ThrottleState) => void) => subscribe('throttle:state', callback),
  onLibraryChanged: (callback: () => void) =>
    subscribe<unknown>('library:changed', () => callback()),
  onCollectProgress: (callback: (progress: CollectProgress) => void) =>
    subscribe('collect:progress', callback),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) =>
    subscribe('download:progress', callback),
  onDownloadItem: (callback: (item: DownloadItemEvent) => void) =>
    subscribe('download:item', callback),
  onDownloadDone: (callback: (summary: DownloadSummary) => void) =>
    subscribe('download:done', callback),
  onBatchProgress: (callback: (progress: BatchSyncProgress) => void) =>
    subscribe('batch:progress', callback)
}

contextBridge.exposeInMainWorld('pixiv', api)
