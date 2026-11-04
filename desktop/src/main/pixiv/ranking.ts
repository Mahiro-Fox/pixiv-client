import type {
  AppRankingFilter,
  AppRankingMode,
  RankingMode,
  RankingParams,
  RankingResult,
  SearchWork,
  WorkSearchKind,
} from '../../shared/types';
import { appApiGet, explainAppError } from './appApi';
import { appEndpoints, webEndpoints } from './endpoints';
import { fetchJson } from './http';
import { getOAuthStatus } from './oauth';
import { searchWorkBase, thumbUrl } from './workFields';

/** 网页 ranking.php 仍然可用的榜单；未登录只走这几个 */
const WEB_MODES: RankingMode[] = ['daily', 'weekly', 'monthly', 'rookie'];

/** 登录后统一走 App API：网页 mode 折算到 App 的对应榜单 */
const WEB_TO_APP: Record<RankingMode, AppRankingMode> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  rookie: 'week_rookie',
  original: 'week_original',
  male: 'day_male',
  female: 'day_female',
};

/** 漫画栏目下，通用周期榜改用 App 的漫画对应榜 */
const WEB_TO_APP_MANGA: Partial<Record<RankingMode, AppRankingMode>> = {
  daily: 'day_manga',
  weekly: 'week_manga',
  monthly: 'month_manga',
  rookie: 'week_rookie_manga',
};

/** App API 的全部 mode，与 `/v1/illust/ranking` 的取值一致 */
const APP_MODES: AppRankingMode[] = [
  'day',
  'week',
  'month',
  'day_male',
  'day_female',
  'week_original',
  'week_rookie',
  'day_r18',
  'day_male_r18',
  'day_female_r18',
  'week_r18',
  'week_r18g',
  'day_manga',
  'week_manga',
  'month_manga',
  'week_rookie_manga',
  'day_r18_manga',
  'week_r18_manga',
  'week_r18g_manga',
];

/** 网页榜单每页固定 50 件；App 榜单接口每页 30 件 */
const WEB_PAGE_SIZE = 50;
const APP_PAGE_SIZE = 30;
const MAX_PAGE = 10;

/** 网页 ranking.php 返回的作品结构 */
interface RawRankingWork {
  illust_id?: string | number;
  title?: string;
  date?: string;
  tags?: string[];
  url?: string;
  illust_type?: string | number;
  illust_page_count?: string | number;
  user_name?: string;
  user_id?: string | number;
  profile_img?: string;
  width?: number;
  height?: number;
  rank?: number;
  illust_content_type?: { sexual?: number };
}

interface RankingResponse {
  error?: boolean;
  message?: string;
  contents?: RawRankingWork[];
  rank_total?: number;
  page?: number;
  date?: string | number;
  next_date?: string | number | false;
}

/** App API 排行榜返回的作品结构（只取本项目用到的字段） */
interface RawAppRankingIllust {
  id?: string | number;
  title?: string;
  type?: number;
  image_urls?: { square_medium?: string; medium?: string; large?: string };
  user?: {
    id?: string | number;
    name?: string;
    profile_image_urls?: { medium?: string };
  };
  tags?: { name?: string }[];
  create_date?: string;
  page_count?: number;
  width?: number;
  height?: number;
  x_restrict?: number;
  illust_ai_type?: number;
  total_bookmarks?: number;
  bookmark_count?: number;
}

interface AppRankingResponse {
  illusts?: RawAppRankingIllust[];
  next_url?: string | null;
  /** YYYYMMDD */
  ranking_date?: string;
}

function toSearchWork(raw: RawRankingWork): SearchWork {
  return {
    ...searchWorkBase({
      id: raw.illust_id,
      title: raw.title,
      userId: raw.user_id,
      userName: raw.user_name,
      // 榜单给的是 480x960 竖图，列表只要小图
      thumbnail: thumbUrl(raw.url),
      profileImageUrl: raw.profile_img,
      pageCount: raw.illust_page_count,
      width: raw.width,
      height: raw.height,
      // 榜单没有 xRestrict 字段，用内容分级里的 sexual 代替
      xRestrict: raw.illust_content_type?.sexual,
      illustType: raw.illust_type,
      tags: raw.tags,
      createDate: raw.date,
      // 榜单接口不返回收藏数与 AI 标识，留默认值
      bookmarkCount: 0,
      aiType: 0,
    }),
    rank: Number(raw.rank || 0),
  };
}

function toAppSearchWork(raw: RawAppRankingIllust, rank: number): SearchWork {
  const images = raw.image_urls || {};
  return {
    ...searchWorkBase({
      id: raw.id,
      title: raw.title,
      userId: raw.user?.id,
      userName: raw.user?.name,
      thumbnail: thumbUrl(
        images.medium || images.square_medium || images.large
      ),
      profileImageUrl: raw.user?.profile_image_urls?.medium,
      pageCount: raw.page_count,
      width: raw.width,
      height: raw.height,
      xRestrict: raw.x_restrict,
      illustType: raw.type,
      tags: raw.tags,
      createDate: raw.create_date,
      bookmarkCount: raw.total_bookmarks ?? raw.bookmark_count,
      // App 接口给的是 illust_ai_type（1 / 2 才有意义），与网页 aiType 口径一致
      aiType: raw.illust_ai_type,
    }),
    // App 榜单不返回 rank 字段，按 offset + 序号补
    rank,
  };
}

/** 把请求里的 mode 折算成 App 口径：App mode 直接用，网页 mode 查表 */
function toAppMode(mode: string, kind: WorkSearchKind): AppRankingMode {
  const app = APP_MODES.find((item) => item === mode);
  if (app) return app;
  const webMode = WEB_TO_APP[mode as RankingMode]
    ? (mode as RankingMode)
    : 'daily';
  const manga = kind === 'manga' ? WEB_TO_APP_MANGA[webMode] : undefined;
  return manga ?? WEB_TO_APP[webMode];
}

/** 网页 YYYYMMDD 转 App 需要的 YYYY-MM-DD */
function appDate(ymd: string): string {
  return /^\d{8}$/.test(ymd)
    ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
    : '';
}

/** 网页 ranking.php 路径；未登录只拿得到全年龄部分，但比报错好 */
async function fetchWebRanking(
  mode: RankingMode,
  kind: WorkSearchKind,
  page: number,
  date: string,
  cookie: string,
  signal?: AbortSignal
): Promise<RankingResult> {
  const content: WorkSearchKind = kind === 'manga' ? 'manga' : 'illust';
  const url = webEndpoints.ranking({ mode, content, page, date });
  const data = await fetchJson<RankingResponse>(url, cookie, signal);
  if (data.error) throw new Error(data.message || '排行榜接口报错');

  const works = (data.contents || [])
    .map(toSearchWork)
    .filter((work) => work.id);
  const total = Number(data.rank_total || works.length);
  const lastPage = Math.max(
    1,
    Math.min(MAX_PAGE, Math.ceil(total / WEB_PAGE_SIZE))
  );

  return {
    works,
    page: Math.max(1, Number(data.page || page)),
    lastPage,
    total,
    date: String(data.date || date || ''),
    nextDate: data.next_date ? String(data.next_date) : '',
    source: 'web',
  };
}

/** App API 排行榜；需要 App API 凭据，翻页用 offset，lastPage 由 next_url 推断 */
async function fetchAppRanking(
  mode: AppRankingMode,
  filter: AppRankingFilter,
  page: number,
  date: string,
  signal?: AbortSignal
): Promise<RankingResult> {
  const offset = (page - 1) * APP_PAGE_SIZE;
  const path = appEndpoints.rankingIllusts({
    mode,
    filter,
    date: appDate(date),
    offset: offset || undefined,
  });

  let data: AppRankingResponse;
  try {
    data = await appApiGet<AppRankingResponse>(path, signal);
  } catch (error) {
    throw explainAppError(error);
  }

  const works = (data.illusts || [])
    .map((raw, index) => toAppSearchWork(raw, offset + index + 1))
    .filter((work) => work.id);

  return {
    works,
    page,
    // App 接口只给 next_url，不告诉总页数：有 next_url 就视为还能往后翻一页
    lastPage: data.next_url ? Math.min(MAX_PAGE, page + 1) : page,
    // App 接口不返回榜单总数，这里退化为本页条数
    total: works.length,
    date: String(data.ranking_date || date || ''),
    // App 榜单没有「下一期」概念，日期只能手动指定
    nextDate: '',
    source: 'app',
  };
}

/**
 * pixiv 官方排行榜，按凭据状态分两套：
 * - 未登录：网页 `ranking.php?format=json`，只支持 daily / weekly / monthly / rookie；
 * - 已连接 App API：`/v1/illust/ranking`，19 个 mode 全部可用，数据更完整。
 */
export async function fetchRanking(
  params: RankingParams,
  cookie = '',
  signal?: AbortSignal
): Promise<RankingResult> {
  const page = Math.max(
    1,
    Math.min(MAX_PAGE, Math.round(Number(params.page) || 1))
  );

  // 日期只接受 YYYYMMDD，其它输入交给 pixiv 报错反而更难懂
  const rawDate = String(params.date || '').trim();
  const date = /^\d{8}$/.test(rawDate) ? rawDate : '';

  const status = await getOAuthStatus();
  const filter: AppRankingFilter =
    params.filter === 'for_ios' ? 'for_ios' : 'for_android';

  if (status.connected) {
    return fetchAppRanking(
      toAppMode(String(params.mode || ''), params.kind),
      filter,
      page,
      date,
      signal
    );
  }

  // 未登录：App 专有 mode 与已失效的网页 mode 都退回网页日榜
  const webMode = WEB_MODES.find((item) => item === params.mode) ?? 'daily';
  return fetchWebRanking(webMode, params.kind, page, date, cookie, signal);
}
