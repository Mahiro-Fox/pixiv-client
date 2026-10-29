import { Loader2, Search, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import type { UserSearchResult } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Pagination } from '@renderer/components/ui/pagination'
import { UserCard } from '@renderer/components/UserCard'
import { useSearchSubmitVersion } from '@renderer/lib/searchSubmit'
import { usePageActive } from '@renderer/lib/pageActive'
import { useKeepAliveScroll } from '@renderer/lib/scrollMemory'
import { useWorkPreview } from '@renderer/lib/workPreview'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 用户搜索页：关键词来自顶栏搜索框，筛选「只看投稿过作品的用户」 */
export function UsersPage(): React.JSX.Element {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  /** 用户卡片右侧的四张作品缩略图共用同一套应用内预览 */
  const { openPreview, previewNode } = useWorkPreview()

  const word = params.get('word') || ''
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))
  const postedOnly = params.get('mode') !== 'all'

  const [result, setResult] = useState<UserSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 接口未给出每页条数，用第一页结果条数推算总页数（避免按最后一页的少量结果算错） */
  const [pageSize, setPageSize] = useState(48)

  /** 顶栏回车提交的序号：同一个关键词再提交一次也要刷新 */
  const submitVersion = useSearchSubmitVersion()
  /** 滚动位置记忆：挂到真正的滚动容器上，keep-alive 激活时由 hook 拨回原位 */
  const scroll = useKeepAliveScroll<HTMLDivElement>('users')
  /** 后台时不读全局 URL 参数（进详情页会被算成空值），effect 里直接忽略 */
  const active = usePageActive()
  /** 已取到数据的条件签名：一致就不再请求，从详情页回来才不会被重取 */
  const loadedSig = useRef('')

  useEffect(() => {
    if (!active) return
    if (!word) {
      setResult(null)
      setError('')
      loadedSig.current = ''
      return
    }
    const sig = [word, page, postedOnly ? 1 : 0, submitVersion].join('|')
    if (loadedSig.current === sig) return

    let alive = true
    // 参数变了就是换了内容，位置回顶
    scroll.reset()
    setLoading(true)
    setError('')
    void window.pixiv
      .searchUsers({ word, page, postedOnly })
      .then((data) => {
        if (!alive) return
        loadedSig.current = sig
        setResult(data)
        if (page === 1 && data.users.length > 0) setPageSize(data.users.length)
      })
      .catch((reason: unknown) => {
        if (alive) {
          // 失败就清掉签名，下次激活（或下次参数变化）允许重新请求
          loadedSig.current = ''
          setResult(null)
          setError(messageOf(reason))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [active, word, page, postedOnly, submitVersion])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  const lastPage = Math.max(1, Math.ceil((result?.total || 0) / pageSize))
  const chipClass = (active: boolean): string =>
    `rounded-full border px-2.5 py-1 text-xs transition-colors ${
      active
        ? 'border-primary/60 bg-primary/15 text-primary'
        : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'
    }`

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => apply({ mode: '', page: '1' })}
          className={chipClass(postedOnly)}
        >
          {t('users.postedOnly')}
        </button>
        <button
          type="button"
          onClick={() => apply({ mode: 'all', page: '1' })}
          className={chipClass(!postedOnly)}
        >
          {t('users.all')}
        </button>
        {result && word ? (
          <span className="ml-auto text-[11px]">{t('users.total', { total: result.total })}</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!word ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Users className="h-10 w-10 opacity-40" />
          <p className="text-sm">{t('users.empty')}</p>
          <p className="text-[11px] text-muted-foreground/70">{t('users.searchHint')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div ref={scroll.ref} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('users.loading')}
              </div>
            ) : null}
            {!loading && result && result.users.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Search className="h-6 w-6" />
                {t('users.noResult')}
              </div>
            ) : null}
            {!loading && result && result.users.length > 0 ? (
              <div className="grid gap-2">
                {result.users.map((user) => (
                  <UserCard key={user.id} user={user} onPreview={openPreview} />
                ))}
              </div>
            ) : null}
          </div>

          {result && lastPage > 1 ? (
            <Pagination
              page={page}
              lastPage={lastPage}
              onChange={(next) => apply({ page: String(next) })}
              disabled={loading}
            />
          ) : null}
        </div>
      )}

      {previewNode}
    </main>
  )
}
