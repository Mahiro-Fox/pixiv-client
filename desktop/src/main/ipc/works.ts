import { app, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  BookmarkInput,
  BookmarkRest,
  CollectParams,
  CollectProgress,
  DownloadedParams,
  FailureItem,
  FollowingParams,
  FollowInput,
  PixivWork,
  RankingParams,
  RecommendUsersParams,
  RecommendWorksParams,
  UserContentParams,
  UserSearchParams,
  WorkExportParams,
  WorkSearchParams,
  WorkSeriesParams
} from '../../shared/types'
import { loadConfig, resolveCookie } from '../config'
import {
  collectWorks,
  fetchFollowing,
  fetchSelfUser,
  fetchUserTags
} from '../pixiv/api'
import { findDownloadedIds, safeName } from '../pixiv/files'
import { fetchRanking } from '../pixiv/ranking'
import { fetchRecommendedUsers, fetchRecommendedWorks } from '../pixiv/recommend'
import { fetchTrendingTags, searchWorks } from '../pixiv/search'
import { fetchWorkSeries, setSeriesWatch } from '../pixiv/series'
import { fetchUserContent, fetchUserProfile, searchUsers } from '../pixiv/user'
import {
  getBookmarkState,
  getFollowState,
  getNovelBookmarkState,
  setBookmark,
  setFollow,
  setNovelBookmark
} from '../pixiv/write'
import {
  filterBlockedUsers,
  toAuthorContent,
  toContentKind,
  toInt,
  withoutBlocked
} from './runtime'

export function registerWorksHandlers(): void {
  ipcMain.handle('works:collect', async (event, params: CollectParams) => {
    const config = await loadConfig()
    const { cookie } = await resolveCookie()
    const sender = event.sender
    const contentKind = toContentKind(params.contentKind ?? config.contentKind)
    const bookmarkRest: BookmarkRest = params.bookmarkRest === 'hide' ? 'hide' : 'show'
    const common = {
      tag: (params.tag ?? config.tag).trim(),
      contentKind,
      // 收藏栏目：公开 / 私密；其它栏目忽略这个字段
      bookmarkRest,
      tagExtra: params.extraTag ?? config.tagExtra,
      tagExclude: params.excludeTag ?? config.tagExclude,
      tagMode: params.tagMode ?? config.tagMode,
      offset: toInt(params.offset, config.offset, 0, 1_000_000),
      limit: toInt(params.limit, config.limit, 1, 100),
      workers: toInt(params.workers, config.workers, 1, 4),
      cookie,
      onProgress: (progress: CollectProgress) => {
        if (!sender.isDestroyed()) sender.send('collect:progress', progress)
      }
    }

    /**
     * 收藏栏目要知道「谁的收藏」：用户 ID 留空就用当前登录账号。
     * 私密收藏只有本人可见——界面在「他人」时已经把选项锁成公开，这里再兜一层：
     * 手改配置、或从旧版本带过来的 hide 值，不应该把 pixiv 的「没有权限。」原样抛给用户。
     * 两种判断都依赖「自己是谁」，所以一次取到、共用。
     */
    let userId = (params.userId || config.userId).trim()
    const needsSelf = contentKind === 'bookmarks' && (!userId || bookmarkRest === 'hide')
    const self = needsSelf ? await fetchSelfUser(cookie) : null

    if (contentKind === 'bookmarks' && !userId) {
      if (!self) throw new Error('无法识别当前登录账号：请配置 Cookie，或填写用户 ID')
      userId = self.id
    }
    if (contentKind === 'bookmarks' && bookmarkRest === 'hide' && self?.id !== userId) {
      throw new Error('私密收藏只有本人可见：请把收藏类型改为公开，或换成自己的用户 ID')
    }

    const collected = await collectWorks({
      ...common,
      userId,
      tag: common.tag || config.tag
    })
    return { ...collected, works: withoutBlocked(collected.works, config) }
  })

  ipcMain.handle('user:self', async () => {
    const { cookie } = await resolveCookie()
    if (!cookie) return null
    try {
      return await fetchSelfUser(cookie)
    } catch {
      return null
    }
  })

  ipcMain.handle('user:following', async (_event, params: FollowingParams) => {
    const config = await loadConfig()
    const { cookie } = await resolveCookie()
    const result = await fetchFollowing(
      (params?.userId ?? '').trim(),
      toInt(params?.offset, 0, 0, 100_000),
      toInt(params?.limit, 48, 1, 100),
      cookie
    )
    // 被屏蔽的画师不该再出现在关注列表里（用户卡没有渲染层过滤）
    return { ...result, users: filterBlockedUsers(result.users, config) }
  })

  // 插画 / 漫画搜索：只做参数清洗，排序与分级由 API 层再白名单校验
  ipcMain.handle('search:works', async (_event, params: WorkSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) {
      return {
        works: [],
        total: 0,
        lastPage: 1,
        relatedTags: [],
        tagTranslation: {},
        chips: [],
        bookmarkRanges: []
      }
    }
    const { cookie } = await resolveCookie()
    const result = await searchWorks(
      {
        kind: params?.kind === 'manga' ? 'manga' : 'illust',
        word,
        order: params?.order ?? 'date_d',
        mode:
          params?.mode === 'safe' || params?.mode === 'r18' ? params.mode : 'all',
        page: toInt(params?.page, 1, 1, 1000),
        csw: Boolean(params?.csw),
        blt: toInt(params?.blt, 0, 0, 100000),
        scope: params?.scope === 'tag_tc' ? 'tag_tc' : 'tag',
        includeManga: Boolean(params?.includeManga)
      },
      cookie
    )
    const config = await loadConfig()
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  ipcMain.handle('search:users', async (_event, params: UserSearchParams) => {
    const word = String(params?.word || '').trim().slice(0, 100)
    if (!word) return { users: [], total: 0 }
    const { cookie } = await resolveCookie()
    const result = await searchUsers(
      {
        word,
        page: toInt(params?.page, 1, 1, 1000),
        postedOnly: params?.postedOnly !== false
      },
      cookie
    )
    const config = await loadConfig()
    return { ...result, users: filterBlockedUsers(result.users, config) }
  })

  ipcMain.handle('user:profile', async (_event, userId: string) => {
    const id = String(userId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('用户 ID 无效')
    const { cookie } = await resolveCookie()
    return fetchUserProfile(id, cookie)
  })

  ipcMain.handle('user:content', async (_event, params: UserContentParams) => {
    const id = String(params?.userId || '').trim()
    if (!/^\d+$/.test(id)) throw new Error('用户 ID 无效')
    const tab = params?.tab
    if (!['illust', 'manga', 'novel', 'bookmarks'].includes(tab)) throw new Error('栏目无效')
    const { cookie } = await resolveCookie()
    const config = await loadConfig()
    const result = await fetchUserContent(
      {
        userId: id,
        tab,
        page: toInt(params?.page, 1, 1, 1000),
        limit: toInt(params?.limit, 48, 1, 100),
        bookmarkRest: params?.bookmarkRest === 'hide' ? 'hide' : 'show',
        bookmarkTag: params?.bookmarkTag
      },
      cookie
    )
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 官方排行榜：网页端接口，未登录也能取到全年龄榜单
  ipcMain.handle('ranking:list', async (_event, params: RankingParams) => {
    const { cookie } = await resolveCookie()
    const config = await loadConfig()
    const result = await fetchRanking(
      {
        kind: params?.kind === 'manga' ? 'manga' : 'illust',
        mode: params?.mode ?? 'daily',
        page: toInt(params?.page, 1, 1, 10),
        date: String(params?.date || '').trim()
      },
      cookie
    )
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 推荐作品：已连接 App API 时个性化推荐，否则网页发现兜底
  ipcMain.handle('recommend:works', async (_event, params: RecommendWorksParams) => {
    const config = await loadConfig()
    const result = await fetchRecommendedWorks({
      kind: params?.kind === 'manga' ? 'manga' : 'illust',
      nextUrl: typeof params?.nextUrl === 'string' ? params.nextUrl.slice(0, 2000) : '',
      mode: params?.mode === 'safe' || params?.mode === 'r18' ? params.mode : 'all'
    })
    return { ...result, works: withoutBlocked(result.works, config) }
  })

  // 推荐画师：只走 App API；未连接时前端会提前提示，不会走到这里
  ipcMain.handle('recommend:users', async (_event, params: RecommendUsersParams) => {
    const config = await loadConfig()
    const result = await fetchRecommendedUsers({
      nextUrl: typeof params?.nextUrl === 'string' ? params.nextUrl.slice(0, 2000) : ''
    })
    return { ...result, users: filterBlockedUsers(result.users, config) }
  })

  // 写操作：收藏 / 关注都走 App API，凭据缺失时在 write.ts 里统一报错
  ipcMain.handle('write:bookmarkState', async (_event, workId: string) =>
    getBookmarkState(workId)
  )
  ipcMain.handle('write:setBookmark', async (_event, workId: string, input: BookmarkInput) =>
    setBookmark(workId, input)
  )
  ipcMain.handle('write:followState', async (_event, userId: string) =>
    getFollowState(userId)
  )
  ipcMain.handle('write:setFollow', async (_event, userId: string, input: FollowInput) =>
    setFollow(userId, input)
  )
  ipcMain.handle('write:novelBookmarkState', async (_event, novelId: string) =>
    getNovelBookmarkState(novelId)
  )
  ipcMain.handle('write:setNovelBookmark', async (_event, novelId: string, input: BookmarkInput) =>
    setNovelBookmark(novelId, input)
  )

  // 系列聚合浏览：已连接 App API 时取完整列表，否则用网页作品页信息兜底
  ipcMain.handle('series:detail', async (_event, params: WorkSeriesParams) => {
    const { cookie } = await resolveCookie()
    return fetchWorkSeries(params, cookie)
  })
  ipcMain.handle('series:watch', async (_event, seriesId: string, watch: boolean) =>
    setSeriesWatch(seriesId, watch)
  )

  // 搜索框下拉里的热门标签（首页推荐作品聚合）
  ipcMain.handle('search:trendingTags', async () => {
    const { cookie } = await resolveCookie()
    return fetchTrendingTags(cookie)
  })

  // 作者主页「高级搜索」的标签云：工作台的标签筛选弹窗用它列候选。
  // content 决定只列插画 / 只列漫画 / 两者合并，与作品列表当前栏目保持一致
  ipcMain.handle('user:tags', async (_event, userId: string, content?: string) => {
    const id = String(userId || '').trim()
    // 只接受纯数字 ID：拼进路径前先挡住奇怪输入，避免打到别的接口
    if (!/^\d+$/.test(id)) return []
    const { cookie } = await resolveCookie()
    // 标签云只服务作者的作品，收藏栏目按「全部」列（界面本来也不给收藏栏开标签弹窗）
    return fetchUserTags(id, toAuthorContent(content), cookie)
  })

  ipcMain.handle('works:downloaded', async (_event, params: DownloadedParams) => {
    const config = await loadConfig()
    const outDir = (params?.outDir || config.outDir).trim()
    if (!outDir || !path.isAbsolute(outDir)) return []
    return findDownloadedIds(
      outDir,
      params?.works || [],
      config.fileNameTemplate,
      config.imageQuality
    )
  })

  ipcMain.handle('works:export', async (_event, params: WorkExportParams) => {
    const works = Array.isArray(params?.works) ? params.works : []
    if (works.length === 0) throw new Error('没有可导出的作品')

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const safeTag = safeName(params.tag || 'pixiv', 'pixiv')
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), `pixiv-works-${safeTag}-${stamp}.csv`),
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    if (result.canceled || !result.filePath) return null

    const downloaded = new Set(params.downloaded || [])
    const isJson = result.filePath.toLowerCase().endsWith('.json')
    const content = isJson
      ? toWorksJson(works, downloaded)
      : toWorksCsv(works, downloaded)

    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })
}

function workRow(work: PixivWork, downloaded: Set<string>): (string | number)[] {
  return [
    work.id,
    work.title,
    work.userId,
    work.userName,
    work.pageCount,
    work.width,
    work.height,
    Number(work.xRestrict || 0) >= 1 ? 'R-18' : '',
    Number(work.aiType || 0) === 2 ? 'AI' : '',
    work.createDate || '',
    (work.tags || []).join(' '),
    downloaded.has(work.id) ? '是' : '否',
    `https://www.pixiv.net/artworks/${work.id}`,
    work.url
  ]
}

const WORK_HEADER = [
  '作品ID',
  '标题',
  '作者ID',
  '作者',
  '页数',
  '宽',
  '高',
  '分级',
  'AI',
  '发布时间',
  '标签',
  '已下载',
  '作品链接',
  '封面地址'
]

function toWorksCsv(works: PixivWork[], downloaded: Set<string>): string {
  const rows = works.map((work) => workRow(work, downloaded).map(csvCell).join(','))
  return `\ufeff${[WORK_HEADER.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`
}

function toWorksJson(works: PixivWork[], downloaded: Set<string>): string {
  const rows = works.map((work) => {
    const row = workRow(work, downloaded)
    return Object.fromEntries(WORK_HEADER.map((key, index) => [key, row[index]]))
  })
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** CSV 单元格转义：引号加倍并整体包裹，避免逗号/换行破坏列结构 */
function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** 导出失败清单；开头加 BOM 以便 Excel 正确识别中文 */
export function toFailureCsv(items: FailureItem[]): string {
  const rows = items.map((item) =>
    [
      item.kind === 'work' ? '作品解析' : '图片下载',
      item.illustId,
      item.label,
      item.url || '',
      item.error
    ]
      .map(csvCell)
      .join(',')
  )
  return `\ufeff${['类型,作品ID,文件/作品,图片地址,错误原因', ...rows].join('\r\n')}\r\n`
}
