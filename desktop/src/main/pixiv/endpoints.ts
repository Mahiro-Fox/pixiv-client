/**
 * pixiv 接口地址的唯一出处。
 *
 * 之前每个功能模块各自在文件顶部拼 URL 模板、再在调用点 `.replace()` 逐项填充，
 * 于是「有哪些接口」「某个参数叫什么」散落在 8 个文件里，改一个参数要跟着改模板和
 * 调用点两处，漏一个就得到 400。这里把所有**地址**集中起来，功能模块只负责取数、
 * 解析和业务逻辑：
 *
 *   const data = await fetchJson(webEndpoints.userInfo(id), cookie, signal)
 *
 * 约定：
 * - 网页接口（`www.pixiv.net`）用 `web()`，返回完整地址；`lang` 由它统一附在末尾，
 *   占位符 `{lang}` 交给 `http.ts` 的 requestJson 在发请求前替换（那里是所有请求的
 *   唯一出口，不会漏）。
 * - App API（`app-api.pixiv.net`）用 `app()`，只返回相对路径与查询串，域名补全与
 *   白名单校验仍由 `appApi.ts` 负责；`next_url` 续拉这种原样回传的地址不经过这里。
 * - 单参数用位置参数，三个及以上用对象参数，调用点自带参数名。
 * - 这里只描述「地址长什么样」，不放翻页、合并、重试等逻辑：小说系列目录逐页累加、
 *   系列聚合的多页拉取、动图转码、OAuth 与登录窗口都留在各自模块里。
 */
import { BASE } from './http'

type Param = string | number | boolean | null | undefined

/** 路径片段编码；与原先逐处 encodeURIComponent 的行为一致 */
function seg(value: string): string {
  return encodeURIComponent(value)
}

/** 丢掉 undefined / null，其余交给 URLSearchParams：编码与 `ratio=` 这类空值都由它处理 */
function queryOf(params: Record<string, Param>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }
  return search.toString()
}

/** 网页接口完整地址；`lang` 固定排在最后，占位符由 http.ts 统一替换 */
function web(path: string, params: Record<string, Param> = {}): string {
  const head = queryOf(params)
  return `${BASE}${path}?${head ? `${head}&` : ''}lang={lang}`
}

/** App API 相对地址（可能带查询串），域名由 appApi.ts 补全 */
function app(path: string, params: Record<string, Param> = {}): string {
  const qs = queryOf(params)
  return qs ? `${path}?${qs}` : path
}

/**
 * `profile/illusts` 与 `profile/novels` 的 id 列表要写成重复键 `ids[]=1&ids[]=2`。
 * URLSearchParams 会把方括号转义成 `ids%5B%5D`，pixiv 侧是否照常解析没法离线验证，
 * 所以这两处保持原来的字面写法。
 */
function idsQuery(ids: string[]): string {
  return ids.map((id) => `ids[]=${seg(id)}`).join('&')
}

type IllustKind = 'illust' | 'manga'

export const webEndpoints = {
  // ---- 作品列表 / 关注 / 收藏 -------------------------------------------------
  /** 某位作者按标签筛选的作品列表（工作台抓取用） */
  userTagWorks(userId: string, params: { tag: string; offset: number; limit: number }): string {
    return web(`/ajax/user/${seg(userId)}/illustmanga/tag`, {
      tag: params.tag,
      offset: params.offset,
      limit: params.limit,
      sensitiveFilterMode: 'userSetting'
    })
  },

  /** 某位作者的收藏夹；rest=show 公开、hide 私密 */
  userBookmarks(
    userId: string,
    params: { tag: string; offset: number; limit: number; rest: string }
  ): string {
    return web(`/ajax/user/${seg(userId)}/illusts/bookmarks`, params)
  },

  /** 关注列表：返回画师与其最近作品缩略图 */
  following(userId: string, params: { offset: number; limit: number }): string {
    return web(`/ajax/user/${seg(userId)}/following`, { ...params, rest: 'show' })
  },

  // ---- 当前登录账号 -----------------------------------------------------------
  /**
   * 自省接口；pixiv 没有公开版本，候选依次尝试，见 api.ts 的 fetchSelfUser。
   * 这两个接口不接受 `lang`，保持原先的裸地址。
   */
  self(): string {
    return `${BASE}/ajax/user/self`
  },

  selfAlt(): string {
    return `${BASE}/ajax/user/extra`
  },

  // ---- 作品详情 ---------------------------------------------------------------
  /** 作品分页（多页作品的每页地址） */
  illustPages(illustId: string): string {
    return web(`/ajax/illust/${seg(illustId)}/pages`)
  },

  /** 动图元信息：zip 地址与每帧延迟 */
  ugoiraMeta(illustId: string): string {
    return web(`/ajax/illust/${seg(illustId)}/ugoira_meta`)
  },

  /** 作品详情；搜索结果与系列网页兜底共用 */
  workDetail(illustId: string): string {
    return web(`/ajax/illust/${seg(illustId)}`)
  },

  // ---- 搜索 -------------------------------------------------------------------
  tagSuggest(word: string): string {
    return web(`/ajax/search/tags/${seg(word)}`)
  },

  /**
   * 作品搜索。illust 与 manga 是两个不同路径，参数也有差异：
   * 只有 illust 带 `type=illust_and_ugoira`，`blt` 仅在有值时出现。
   */
  searchWorks(params: {
    kind: IllustKind
    word: string
    order: string
    mode: string
    page: number
    csw: boolean
    blt: number
    scope: 'tag' | 'tag_tc'
  }): string {
    const path = params.kind === 'illust' ? 'illustrations' : 'manga'
    return web(`/ajax/search/${path}/${seg(params.word)}`, {
      order: params.order,
      mode: params.mode,
      p: params.page,
      ai_type: 0,
      csw: params.csw ? 1 : 0,
      s_mode: params.scope === 'tag_tc' ? 's_tag_tc' : 's_tag',
      ratio: '',
      blt: params.blt > 0 ? params.blt : undefined,
      type: params.kind === 'illust' ? 'illust_and_ugoira' : undefined
    })
  },

  /** 发现（首页推荐）作品；未连接 App API 时的网页兜底 */
  discovery(mode: string): string {
    return web('/ajax/illust/discovery', { mode })
  },

  /** 用户搜索；postedOnly 对应 i=1（只搜投稿过的用户） */
  userSearch(params: { word: string; page: number; postedOnly: boolean }): string {
    return web('/ajax/search/users', {
      nick: params.word,
      s_mode: 's_usr',
      p: params.page,
      i: params.postedOnly ? 1 : 0
    })
  },

  // ---- 用户主页 ---------------------------------------------------------------
  userInfo(userId: string): string {
    return web(`/ajax/user/${seg(userId)}`, { full: 1 })
  },

  /** 该用户全部作品 id（插画 / 漫画 / 小说三组），用于分页取子集 */
  userProfileAll(userId: string): string {
    return web(`/ajax/user/${seg(userId)}/profile/all`)
  },

  userProfileIllusts(userId: string, ids: string[]): string {
    return `${BASE}/ajax/user/${seg(userId)}/profile/illusts?${idsQuery(ids)}` +
      `&work_category=illustManga&is_first_page=1&lang={lang}`
  },

  userProfileNovels(userId: string, ids: string[]): string {
    return `${BASE}/ajax/user/${seg(userId)}/profile/novels?${idsQuery(ids)}` +
      `&work_category=novel&is_first_page=1&lang={lang}`
  },

  // ---- 小说 -------------------------------------------------------------------
  novelSearch(params: {
    word: string
    order: string
    mode: string
    target: string
    page: number
  }): string {
    return web(`/ajax/search/novels/${seg(params.word)}`, {
      word: params.word,
      order: params.order,
      mode: params.mode,
      s_mode: params.target,
      p: params.page,
      gs: 0
    })
  },

  novelDetail(novelId: string): string {
    return web(`/ajax/novel/${seg(novelId)}`)
  },

  novelSeries(seriesId: string): string {
    return web(`/ajax/novel/series/${seg(seriesId)}`)
  },

  /** 小说系列目录；limit 超过 30 会直接返回 HTTP 400 */
  novelSeriesContent(seriesId: string, lastOrder: number, limit: number): string {
    return web(`/ajax/novel/series_content/${seg(seriesId)}`, {
      limit,
      last_order: lastOrder,
      order_by: 'asc'
    })
  },

  // ---- 排行榜 -----------------------------------------------------------------
  /** 排行榜走网页 ranking.php 的 JSON 输出；date 仅接受 YYYYMMDD */
  ranking(params: { mode: string; content: string; page: number; date?: string }): string {
    return web('/ranking.php', {
      mode: params.mode,
      content: params.content,
      p: params.page,
      format: 'json',
      date: params.date || undefined
    })
  }
}

/**
 * App API 端点。
 * 读接口带查询串（id 直接拼好），写接口只给路径：参数以表单 POST，
 * 由 `appApi.ts` 的 appApiPost 负责编码。
 */
export const appEndpoints = {
  // ---- 推荐 -------------------------------------------------------------------
  /** 个性化推荐作品；content_type 决定插画还是漫画 */
  recommendedIllusts(contentType: IllustKind): string {
    return app('/v1/illust/recommended', {
      filter: 'for_android',
      include_ranking_illusts: true,
      include_privacy_policy: true,
      content_type: contentType
    })
  },

  recommendedUsers(): string {
    return app('/v1/user/recommended', { filter: 'for_android' })
  },

  // ---- 系列 -------------------------------------------------------------------
  /** 插画 / 漫画系列的作品列表（分页靠响应里的 next_url） */
  illustSeries(seriesId: string): string {
    return app('/v1/illust/series', { illust_series_id: seriesId, filter: 'for_android' })
  },

  novelSeries(seriesId: string): string {
    return app('/v1/novel/series', { series_id: seriesId, filter: 'for_android' })
  },

  /** 系列追更；kind 选漫画或小说，watch 选加入或退出 */
  seriesWatchlist(kind: 'manga' | 'novel', watch: boolean): string {
    return `/v1/watchlist/${kind}/${watch ? 'add' : 'delete'}`
  },

  // ---- 收藏 / 关注状态 ---------------------------------------------------------
  illustBookmarkDetail(illustId: string): string {
    return app('/v2/illust/bookmark/detail', { illust_id: illustId })
  },

  novelBookmarkDetail(novelId: string): string {
    return app('/v2/novel/bookmark/detail', { novel_id: novelId })
  },

  /** 小说详情；`v2/novel/bookmark/detail` 不可用时从这里的 is_bookmarked 兜底 */
  novelDetail(novelId: string): string {
    return app('/v1/novel/detail', { novel_id: novelId })
  },

  userDetail(userId: string): string {
    return app('/v1/user/detail', { user_id: userId })
  },

  // ---- 写操作（参数走表单） ----------------------------------------------------
  illustBookmark(bookmarked: boolean): string {
    return bookmarked ? '/v2/illust/bookmark/add' : '/v1/illust/bookmark/delete'
  },

  novelBookmark(bookmarked: boolean): string {
    return bookmarked ? '/v2/novel/bookmark/add' : '/v1/novel/bookmark/delete'
  },

  follow(followed: boolean): string {
    return followed ? '/v1/user/follow/add' : '/v1/user/follow/delete'
  }
}
