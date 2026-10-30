import type { BookmarkInput, BookmarkPrivacy, BookmarkState, FollowInput } from '../../shared/types'
import { appApiGet, appApiPost, ensureAppConnected, explainAppError } from './appApi'
import { appEndpoints } from './endpoints'

/** `/v2/illust/bookmark/detail` 的响应 */
interface BookmarkDetailResponse {
  bookmark_detail?: { is_bookmarked?: boolean; restrict?: string }
}

/** `/v1/user/detail` 只取关注状态 */
interface SingleUserResponse {
  user?: { is_followed?: boolean }
}

/** `/v1/novel/detail` 只取收藏状态 */
interface NovelDetailResponse {
  novel?: { is_bookmarked?: boolean; bookmark_restrict?: string }
}

/**
 * pixiv 的 App API 写操作。
 * 「必须已连接凭据」的前置检查与 401 / 403 的提示统一放在 appApi.ts。
 */
function privacyOf(value: BookmarkPrivacy | undefined): BookmarkPrivacy {
  return value === 'private' ? 'private' : 'public'
}

export async function getBookmarkState(workId: string): Promise<BookmarkState> {
  const id = String(workId || '').trim()
  if (!id) throw new Error('缺少作品 ID')
  await ensureAppConnected()
  try {
    const data = await appApiGet<BookmarkDetailResponse>(
      appEndpoints.illustBookmarkDetail(id)
    )
    const detail = data.bookmark_detail || {}
    return {
      bookmarked: Boolean(detail.is_bookmarked),
      restrict: privacyOf(detail.restrict as BookmarkPrivacy | undefined)
    }
  } catch (error) {
    throw explainAppError(error)
  }
}

export async function setBookmark(workId: string, input: BookmarkInput): Promise<BookmarkState> {
  const id = String(workId || '').trim()
  if (!id) throw new Error('缺少作品 ID')
  await ensureAppConnected()
  const restrict = privacyOf(input?.restrict)
  try {
    if (input?.bookmarked) {
      await appApiPost(appEndpoints.illustBookmark(true), { illust_id: id, restrict })
    } else {
      await appApiPost(appEndpoints.illustBookmark(false), { illust_id: id })
    }
  } catch (error) {
    throw explainAppError(error)
  }
  return { bookmarked: Boolean(input?.bookmarked), restrict }
}

/** 读取小说收藏状态；`/v2/novel/bookmark/detail` 不可用时退回小说详情里的 is_bookmarked */
export async function getNovelBookmarkState(novelId: string): Promise<BookmarkState> {
  const id = String(novelId || '').trim()
  if (!id) throw new Error('缺少小说 ID')
  await ensureAppConnected()
  try {
    const data = await appApiGet<BookmarkDetailResponse>(
      appEndpoints.novelBookmarkDetail(id)
    )
    const detail = data?.bookmark_detail || {}
    return {
      bookmarked: Boolean(detail.is_bookmarked),
      restrict: privacyOf(detail.restrict as BookmarkPrivacy | undefined)
    }
  } catch (primary) {
    try {
      const data = await appApiGet<NovelDetailResponse>(
        appEndpoints.novelDetail(id)
      )
      const novel = data?.novel || {}
      return {
        bookmarked: Boolean(novel.is_bookmarked),
        restrict: privacyOf(novel.bookmark_restrict as BookmarkPrivacy | undefined)
      }
    } catch {
      throw explainAppError(primary)
    }
  }
}

export async function setNovelBookmark(
  novelId: string,
  input: BookmarkInput
): Promise<BookmarkState> {
  const id = String(novelId || '').trim()
  if (!id) throw new Error('缺少小说 ID')
  await ensureAppConnected()
  const restrict = privacyOf(input?.restrict)
  try {
    if (input?.bookmarked) {
      await appApiPost(appEndpoints.novelBookmark(true), { novel_id: id, restrict })
    } else {
      await appApiPost(appEndpoints.novelBookmark(false), { novel_id: id })
    }
  } catch (error) {
    throw explainAppError(error)
  }
  return { bookmarked: Boolean(input?.bookmarked), restrict }
}

export async function getFollowState(userId: string): Promise<boolean> {
  const id = String(userId || '').trim()
  if (!id) throw new Error('缺少用户 ID')
  await ensureAppConnected()
  try {
    const data = await appApiGet<SingleUserResponse>(
      appEndpoints.userDetail(id)
    )
    return Boolean(data.user?.is_followed)
  } catch (error) {
    throw explainAppError(error)
  }
}

export async function setFollow(userId: string, input: FollowInput): Promise<boolean> {
  const id = String(userId || '').trim()
  if (!id) throw new Error('缺少用户 ID')
  await ensureAppConnected()
  try {
    if (input?.followed) {
      await appApiPost(appEndpoints.follow(true), {
        user_id: id,
        restrict: privacyOf(input?.restrict)
      })
    } else {
      await appApiPost(appEndpoints.follow(false), { user_id: id })
    }
  } catch (error) {
    throw explainAppError(error)
  }
  return Boolean(input?.followed)
}
