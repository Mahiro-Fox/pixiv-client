import { Loader2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { FollowUser } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Pagination } from '@renderer/components/ui/pagination'
import { UserCard } from '@renderer/components/UserCard'
import { useWorkPreview } from '@renderer/lib/workPreview'

const PAGE_SIZE = 48

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 我的关注：用户列表页面形式，复用用户卡片，点击进入用户主页 */
export function UsersFollowingPage(): React.JSX.Element {
  const { t } = useI18n()
  /** 关注列表与搜索用户页共用同一套四图预览 */
  const { openPreview, previewNode } = useWorkPreview()
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<FollowUser[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .getFollowing({ userId: '', offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE })
      .then((result) => {
        if (!alive) return
        setUsers(result.users)
        setTotal(result.total)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setUsers([])
        setTotal(0)
        setError(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [page])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            {t('users.followingTitle')}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('users.followingHint')}</p>
        </div>
        {total > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {t('users.total', { total })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('users.loading')}
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="h-6 w-6" />
            {t('users.followingEmpty')}
          </div>
        ) : (
          <div className="grid gap-2">
            {users.map((user) => (
              <UserCard key={user.id} user={user} onPreview={openPreview} />
            ))}
          </div>
        )}
      </div>

      {pageCount > 1 ? (
        <Pagination page={page} lastPage={pageCount} onChange={setPage} disabled={loading} />
      ) : null}

      {previewNode}
    </main>
  )
}
