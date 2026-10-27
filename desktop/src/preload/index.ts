import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppConfig,
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
  LibraryResult,
  PixivApi,
  QueueSummary,
  SelfUser,
  TagSuggestion,
  ThrottleState,
  WorkExportParams,
  WorkPage
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
  suggestTags: (word: string) =>
    ipcRenderer.invoke('tags:suggest', word) as Promise<TagSuggestion[]>,
  listLibrary: (force?: boolean) =>
    ipcRenderer.invoke('library:list', Boolean(force)) as Promise<LibraryResult>,
  openLibraryDir: (dir: string) => ipcRenderer.invoke('library:open-dir', dir) as Promise<void>,
  deleteLibraryFiles: (paths: string[]) =>
    ipcRenderer.invoke('library:delete', paths) as Promise<LibraryResult>,
  checkDownloaded: (params: DownloadedParams) =>
    ipcRenderer.invoke('works:downloaded', params) as Promise<string[]>,
  startDownload: (params: DownloadParams) =>
    ipcRenderer.invoke('download:start', params) as Promise<DownloadSummary>,
  cancelDownload: () => ipcRenderer.invoke('download:cancel') as Promise<boolean>,
  listQueue: () => ipcRenderer.invoke('queue:list') as Promise<QueueSummary[]>,
  resumeQueue: (id: string) => ipcRenderer.invoke('queue:resume', id) as Promise<DownloadSummary>,
  removeQueue: (id: string) => ipcRenderer.invoke('queue:remove', id) as Promise<QueueSummary[]>,
  listFailures: (id: string) => ipcRenderer.invoke('queue:failures', id) as Promise<FailureItem[]>,
  exportFailures: (id: string) =>
    ipcRenderer.invoke('queue:export-failures', id) as Promise<string | null>,
  getThrottle: () => ipcRenderer.invoke('throttle:get') as Promise<ThrottleState[]>,
  onQueueChanged: (callback: (jobs: QueueSummary[]) => void) =>
    subscribe('queue:changed', callback),
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
    subscribe('download:done', callback)
}

contextBridge.exposeInMainWorld('pixiv', api)
