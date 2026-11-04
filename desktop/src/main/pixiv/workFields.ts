/**
 * 作品字段的归一化。
 *
 * pixiv 各个接口给的作品结构互不相同：网页搜索用 `illustTitle` / `url`，
 * 排行榜用 `illust_page_count` / `rank`，App API 用 `user.name` / `image_urls`，
 * 作者主页又只给 id。以前每个接口各写一份 `toSearchWork`，默认值抄了五遍，
 * 已经开始漂移（同一张图在排行榜是 250 方图、在搜索页是原样地址）。
 *
 * 这里只做两件事：把缺省值 / 数字强转 / 标签结构收敛到一处；把 pximg 地址
 * 统一成列表用的 250 方图。各接口自己的字段名差异留在各自的 mapper 里。
 */
import type { PixivWork, SearchWork } from '../../shared/types';

/** 接口没给标题 / 作者时的兜底；pixiv 正常不会为空，只有残缺数据才会用到 */
export const UNTITLED = '无题';
export const UNKNOWN_AUTHOR = '未知作者';

/** 列表缩略图尺寸：与网页端卡片一致，避免列表拉原图 */
export const THUMB_SIZE = '250x250_80_a2';

/**
 * 把任意尺寸的 pximg 地址收敛成 250px 方图。
 *
 * 两种形态都要认：`/c/240x480/img-master/…` 与 `/img-master/…`（原图）。
 * 非 pximg 地址（本地预览、空串）原样返回。
 */
export function thumbUrl(url: unknown): string {
  const text = String(url ?? '').trim();
  if (!text) return '';
  const match =
    /^(https?:\/\/i\.pximg\.net)(?:\/c\/[^/]+)?(\/img-master\/.+)$/i.exec(text);
  return match ? `${match[1]}/c/${THUMB_SIZE}${match[2]}` : text;
}

/** 标签可能是 `['tag']`、`[{ tag }]` 或 `[{ name }]`，统一取展示名 */
export function tagNames(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const result: string[] = [];
  for (const item of tags as Array<
    string | { tag?: unknown; name?: unknown } | null
  >) {
    let raw = '';
    if (typeof item === 'string') raw = item;
    else if (item && typeof item === 'object')
      raw = String(item.name ?? item.tag ?? '');
    const value = raw.trim();
    if (value) result.push(value);
  }
  return result;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function count(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** 各接口归一化之后共有的字段（`PixivWork` 去掉 `url` 就是这一组） */
export interface WorkSeed {
  id?: string | number | null;
  title?: string | null;
  userId?: string | number | null;
  userName?: string | null;
  /** 数值字段统一收 `string | number`：排行榜与网页详情会把数字给成字符串 */
  pageCount?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  xRestrict?: string | number | null;
  illustType?: string | number | null;
  tags?: unknown;
  createDate?: string | null;
  aiType?: string | number | null;
}

export type WorkBase = Required<
  Pick<
    PixivWork,
    | 'id'
    | 'title'
    | 'userId'
    | 'userName'
    | 'pageCount'
    | 'width'
    | 'height'
    | 'xRestrict'
    | 'illustType'
    | 'tags'
    | 'createDate'
    | 'aiType'
  >
>;

/** 缺省值 / 强转的唯一实现：`PixivWork` 与 `SearchWork` 都从这里长出公共部分 */
export function workBase(seed: WorkSeed): WorkBase {
  return {
    id: text(seed.id),
    title: text(seed.title) || UNTITLED,
    userId: text(seed.userId),
    userName: text(seed.userName) || UNKNOWN_AUTHOR,
    pageCount: count(seed.pageCount),
    width: count(seed.width),
    height: count(seed.height),
    xRestrict: count(seed.xRestrict),
    illustType: count(seed.illustType),
    tags: tagNames(seed.tags),
    createDate: text(seed.createDate),
    aiType: count(seed.aiType),
  };
}

/** 搜索结果比 `PixivWork` 多了封面、头像与收藏数，其余字段复用 workBase */
export function searchWorkBase(
  seed: WorkSeed & {
    thumbnail?: string | null;
    profileImageUrl?: string | null;
    bookmarkCount?: string | number | null;
  }
): Omit<SearchWork, 'rank' | 'series'> {
  return {
    ...workBase(seed),
    thumbnail: text(seed.thumbnail),
    profileImageUrl: text(seed.profileImageUrl),
    bookmarkCount: count(seed.bookmarkCount),
  };
}
