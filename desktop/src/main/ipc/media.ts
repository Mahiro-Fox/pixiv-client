import { ipcMain } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type {
  NovelDownloadParams,
  NovelSearchParams,
  UgoiraFrame,
  UgoiraFrames
} from '../../shared/types'
import { loadConfig, resolveCookie } from '../config'
import { fetchUgoiraMeta, fetchWorkPages, suggestTags } from '../pixiv/api'
import { downloadFile } from '../pixiv/http'
import {
  downloadNovel,
  fetchNovelDetail,
  fetchNovelSeries,
  searchNovels
} from '../pixiv/novels'
import {
  readNovelText,
  searchNovelLibraryText
} from '../pixiv/novelLibrary'
import { fetchWorkDetail } from '../pixiv/search'
import { getNovelSeriesWatchState, setNovelSeriesWatch } from '../pixiv/series'
import { readUgoiraFrames } from '../pixiv/ugoira'
import { ensureUgoiraCover } from '../pixiv/ugoiraCover'
import { blockRulesOf, isBlocked } from '../../shared/block'
import {
  MEDIA_MIME,
  rememberUgoiraFrames,
  resolveInsideOutDir,
  toInt,
  ugoiraFrameCache
} from './runtime'

export function registerMediaHandlers(): void {
  ipcMain.handle('work:pages', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('作品 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchWorkPages(id, cookie)
  })

  // 只带 id 的缩略图（用户列表四图）按 id 补全详情
  ipcMain.handle('work:detail', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) return null
    const { cookie } = await resolveCookie()
    return fetchWorkDetail(id, cookie)
  })

  /**
   * 动图预览：把 zip 解成帧交给渲染层按 delay 自己播。
   *
   * 预览不做转码 —— 不落临时产物、不依赖 ffmpeg、画质是原始帧；
   * 代价是每帧都要过一次 IPC，所以按 id 缓存最近两份。
   */
  ipcMain.handle('ugoira:frames', async (_event, illustId: string) => {
    const id = String(illustId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('作品 ID 无效')
    const cached = ugoiraFrameCache.get(id)
    if (cached) return cached

    const { cookie } = await resolveCookie()
    const meta = await fetchUgoiraMeta(id, cookie)
    const zipPath = path.join(os.tmpdir(), `pixiv-ugoira-${id}-${randomUUID().slice(0, 8)}.zip`)
    try {
      await downloadFile(meta.zipUrl, zipPath, cookie)
      return rememberUgoiraFrames(id, { frames: await readUgoiraFrames(zipPath, meta.frames) })
    } finally {
      await rm(zipPath, { force: true }).catch(() => undefined)
      await rm(`${zipPath}.part`, { force: true }).catch(() => undefined)
    }
  })

  /**
   * 本地已下载的动图 zip。
   * 每帧时长只存在线上的 ugoira_meta 里，拿不到就按默认 100ms 播——
   * 顺序仍然按文件名排，和下载时的转码结果一致。
   */
  ipcMain.handle('ugoira:local', async (_event, filePath: string, illustId?: string) => {
    const target = await resolveInsideOutDir(filePath)
    const id = String(illustId || '').trim()
    const valid = /^\d+$/.test(id)
    const cached = valid ? ugoiraFrameCache.get(id) : undefined
    if (cached) return cached

    let frames: UgoiraFrame[] = []
    if (valid) {
      try {
        const { cookie } = await resolveCookie()
        frames = (await fetchUgoiraMeta(id, cookie)).frames
      } catch {
        frames = []
      }
    }
    const value: UgoiraFrames = { frames: await readUgoiraFrames(target, frames) }
    return valid ? rememberUgoiraFrames(id, value) : value
  })

  /**
   * 动图作品的首帧缩略图。
   * 卡片只显示静态图，所以主进程把首帧落成缓存文件返回路径，渲染层直接用 pixivfile:// 取。
   */
  ipcMain.handle('ugoira:cover', async (_event, filePath: string) => {
    const target = await resolveInsideOutDir(filePath)
    return ensureUgoiraCover(target)
  })

  /**
   * 媒体文件字节：mp4 / webm 交给渲染层做 Blob URL 再喂给 <video>。
   * 走自定义协议时对 Range 请求支持不稳，转码产物又只有几 MB，直接整份传更省心。
   */
  ipcMain.handle('media:local', async (_event, filePath: string) => {
    const target = await resolveInsideOutDir(filePath)
    const mime = MEDIA_MIME[path.extname(target).toLowerCase()] || 'application/octet-stream'
    const bytes = await readFile(target)
    return { bytes: new Uint8Array(bytes), mime }
  })

  // 小说搜索：只做入口参数清洗，排序/分级/匹配方式由 API 层再白名单校验一次
  ipcMain.handle('novel:search', async (_event, params: NovelSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) return { novels: [], total: 0, lastPage: 1, relatedTags: [] }
    const { cookie } = await resolveCookie()
    const result = await searchNovels(
      {
        word,
        order: params?.order ?? 'date_d',
        mode: params?.mode ?? 'all',
        target: params?.target ?? 's_tag_full',
        page: toInt(params?.page, 1, 1, 10)
      },
      cookie
    )
    // 屏蔽规则对小说同样成立（分级 / 标签 / 关键词在渲染层再筛一遍）
    const config = await loadConfig()
    const rules = blockRulesOf(config)
    return {
      ...result,
      novels: result.novels.filter(
        (novel) => !isBlocked({ userId: novel.userId, userName: novel.userName }, rules)
      )
    }
  })

  ipcMain.handle('novel:detail', async (_event, novelId: string) => {
    const id = String(novelId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('小说 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchNovelDetail(id, cookie)
  })

  ipcMain.handle('novel:series', async (_event, seriesId: string) => {
    const id = String(seriesId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('系列 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchNovelSeries(id, cookie)
  })

  // 保存 TXT：整部系列由主进程逐话拉取，进度实时推给发起窗口
  ipcMain.handle('novel:download', async (event, params: NovelDownloadParams) => {
    const config = await loadConfig()
    const outDir = (params?.outDir || config.outDir || '').trim()
    if (!outDir) throw new Error('未设置保存目录')
    if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径')

    const novelId = String(params?.novelId || '').trim()
    const seriesId = String(params?.seriesId || '').trim()
    if (!novelId && !seriesId) throw new Error('缺少小说 ID')
    if (novelId && !/^\d+$/.test(novelId)) throw new Error('小说 ID 无效')
    if (seriesId && !/^\d+$/.test(seriesId)) throw new Error('系列 ID 无效')

    const { cookie } = await resolveCookie()
    const sender = event.sender
    return downloadNovel({
      novelId: novelId || undefined,
      seriesId: seriesId || undefined,
      outDir,
      cookie,
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('novel:download-progress', progress)
      }
    })
  })

  // 小说全文检索与应用内阅读：列表已并入 library:list（图库的小说栏目），这里只留检索与读取
  ipcMain.handle('novel:library-search', async (_event, keyword: string) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效')
    const word = String(keyword || '').trim().slice(0, 100)
    if (!word) return { hits: [], scanned: 0 }
    return searchNovelLibraryText(outDir, word)
  })

  ipcMain.handle('novel:library-read', async (_event, filePath: string) => {
    const config = await loadConfig()
    const outDir = (config.outDir || '').trim()
    if (!outDir || !path.isAbsolute(outDir)) throw new Error('保存目录无效')
    return readNovelText(outDir, String(filePath || ''))
  })

  // 小说系列的追更：网页接口不返回追更状态，单独读一次 App API
  ipcMain.handle('novelSeries:watchState', async (_event, seriesId: string) =>
    getNovelSeriesWatchState(seriesId)
  )
  ipcMain.handle('novelSeries:watch', async (_event, seriesId: string, watch: boolean) =>
    setNovelSeriesWatch(seriesId, watch)
  )

  ipcMain.handle('tags:suggest', async (_event, word: string) => {
    const keyword = String(word || '').slice(0, 50)
    if (keyword.trim().length < 2) return []
    const { cookie } = await resolveCookie()
    return suggestTags(keyword, cookie)
  })
}
