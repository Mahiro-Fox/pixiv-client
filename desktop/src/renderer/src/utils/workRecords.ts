import type {
  SearchWork,
  ViewHistoryEntry,
  WatchLaterEntry,
} from '@shared/types';

/**
 * 本地记录（浏览历史 / 稍后看）转成预览弹窗需要的 `SearchWork`。
 *
 * 两者字段同构，只存了展示信息：尺寸、标签、收藏数等列表接口才有的字段补默认值，
 * 详情弹窗自己会按 id 取分页与收藏状态。
 */
export function recordToSearchWork(
  entry: ViewHistoryEntry | WatchLaterEntry
): SearchWork {
  return {
    id: entry.id,
    title: entry.title,
    userId: entry.userId,
    userName: entry.userName,
    thumbnail: entry.thumbnail,
    profileImageUrl: '',
    pageCount: entry.pageCount,
    width: 0,
    height: 0,
    xRestrict: entry.xRestrict,
    illustType: entry.illustType,
    tags: [],
    createDate: '',
    bookmarkCount: 0,
    aiType: 0,
  };
}
