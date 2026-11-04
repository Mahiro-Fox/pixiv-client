import { Loader2, RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import type { FollowingResult } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Button } from '@renderer/components/ui/button'
import { Pager } from '@renderer/components/shared/Pager'
import { UserCard } from '@renderer/components/shared/UserCard'
import { useKeepAliveScroll } from '@renderer/hooks/useScrollMemory'
import { usePagedQuery } from '@renderer/hooks/usePagedQuery'

const PAGE_SIZE = 48

/** 我的关注：用户列表页面形式，复用用户卡片，点击进入用户主页 */
export function UsersFollowingPage(): React.JSX.Element {
  const { t } = useI18n()
  /** 关注列表与搜索用户页共用同一套四图预览 */
  const [page, setPage] = useState(1)
  /** 本页在 keep-alive 里，进用户主页再回来要停在原来的位置 */
  const scroll = useKeepAliveScroll<HTMLDivElement>('users:following')

  const { data, loading, reload } = usePagedQuery<FollowingResult>({
    page,
    signature: '',
    scroll,
    query: (next) =>
      window.pixiv.getFollowing({ userId: '', offset: (next - 1) * PAGE_SIZE, limit: PAGE_SIZE })
  })

  const users = data?.users ?? []
  const total = data?.total ?? 0
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
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <span className="text-[11px] text-muted-foreground">{t('users.total', { total })}</span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('users.refresh')}
          </Button>
        </div>
      </div>

      <div ref={scroll.ref} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-42 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('users.loading')}
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-42 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="h-6 w-6" />
            {t('users.followingEmpty')}
          </div>
        ) : (
          <div className="grid gap-2">
            {users.map((user) => (
              <UserCard key={user.id} user={user} />
            ))}
          </div>
        )}
      </div>

      {pageCount > 1 ? (
        <Pager page={page} lastPage={pageCount} onChange={setPage} disabled={loading} />
      ) : null}
    </main>
  )
}
