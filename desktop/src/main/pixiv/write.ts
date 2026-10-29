import type { BookmarkInput, BookmarkPrivacy, BookmarkState, FollowInput } from '../../shared/types'
import { appApiGet, appApiPost, ensureAppConnected, explainAppError } from './appApi'

/** `/v2/illust/bookmark/detail` 的响应 */
interface BookmarkDetailResponse {
  bookmark_detail?: { is_bookmarked?: boolean; restrict?: string }
}

/** `/v1/user/detail` 只取关注状态 */
interface SingleUserResponse {
  user?: { is_followed?: boolean }
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
      `/v2/illust/bookmark/detail?illust_id=${encodeURIComponent(id)}`
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
      await appApiPost('/v2/illust/bookmark/add', { illust_id: id, restrict })
    } else {
      await appApiPost('/v1/illust/bookmark/delete', { illust_id: id })
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
      `/v1/user/detail?user_id=${encodeURIComponent(id)}`
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
      await appApiPost('/v1/user/follow/add', {
        user_id: id,
        restrict: privacyOf(input?.restrict)
      })
    } else {
      await appApiPost('/v1/user/follow/delete', { user_id: id })
    }
  } catch (error) {
    throw explainAppError(error)
  }
  return Boolean(input?.followed)
}
