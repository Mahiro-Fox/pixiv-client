import type { BookmarkInput, BookmarkPrivacy, BookmarkState, FollowInput } from '../../shared/types'
import { appApiGet, appApiPost } from './appApi'
import { getOAuthStatus } from './oauth'

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
 * 统一在这里做「必须已连接凭据」的前置检查，并把 401 / 403 翻成能看懂的提示，
 * 避免界面层直接暴露 `HTTP 401`。
 */
function explain(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error)
  if (/HTTP 401/.test(text)) {
    return new Error('App API 凭据已失效，请在设置中重新连接')
  }
  if (/HTTP 403/.test(text)) {
    return new Error('没有权限执行该操作，请确认账号状态')
  }
  return error instanceof Error ? error : new Error(text)
}

async function ensureConnected(): Promise<void> {
  const status = await getOAuthStatus()
  if (!status.connected) {
    throw new Error('写操作需要先连接 App API 凭据（设置 → App API 凭据）')
  }
}

function privacyOf(value: BookmarkPrivacy | undefined): BookmarkPrivacy {
  return value === 'private' ? 'private' : 'public'
}

export async function getBookmarkState(workId: string): Promise<BookmarkState> {
  const id = String(workId || '').trim()
  if (!id) throw new Error('缺少作品 ID')
  await ensureConnected()
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
    throw explain(error)
  }
}

export async function setBookmark(workId: string, input: BookmarkInput): Promise<BookmarkState> {
  const id = String(workId || '').trim()
  if (!id) throw new Error('缺少作品 ID')
  await ensureConnected()
  const restrict = privacyOf(input?.restrict)
  try {
    if (input?.bookmarked) {
      await appApiPost('/v2/illust/bookmark/add', { illust_id: id, restrict })
    } else {
      await appApiPost('/v1/illust/bookmark/delete', { illust_id: id })
    }
  } catch (error) {
    throw explain(error)
  }
  return { bookmarked: Boolean(input?.bookmarked), restrict }
}

export async function getFollowState(userId: string): Promise<boolean> {
  const id = String(userId || '').trim()
  if (!id) throw new Error('缺少用户 ID')
  await ensureConnected()
  try {
    const data = await appApiGet<SingleUserResponse>(
      `/v1/user/detail?user_id=${encodeURIComponent(id)}`
    )
    return Boolean(data.user?.is_followed)
  } catch (error) {
    throw explain(error)
  }
}

export async function setFollow(userId: string, input: FollowInput): Promise<boolean> {
  const id = String(userId || '').trim()
  if (!id) throw new Error('缺少用户 ID')
  await ensureConnected()
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
    throw explain(error)
  }
  return Boolean(input?.followed)
}
