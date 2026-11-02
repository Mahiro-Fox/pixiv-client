import { Check, Loader2, RefreshCw, Search, Tags } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import type { UserTag, WorkContent } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { messageOf } from '@renderer/lib/errors'
import { readUserTags, writeUserTags } from '@renderer/lib/dialogCache'
import { useI18n } from '@renderer/i18n'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input } from './ui/input'

interface UserTagDialogProps {
  /** 当前抓取的作者；为空时提示先填 ID */
  userId: string
  /** 作品列表当前栏目：决定标签只取插画 / 只取漫画 / 两者合并 */
  content: WorkContent
  /** 已在生效的标签，空串表示「全部作品」 */
  activeTag: string
  /** 正在抓取：此时切换标签不会生效，先挡住点击 */
  busy?: boolean
  /** 选中某个标签；传 null 表示回到「全部作品」 */
  onSelect: (tag: string | null) => void
  onClose: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; tags: UserTag[] }

/**
 * 按标签筛选作品（对齐 pixiv 作者主页的「高级搜索」）。
 *
 * 列出该作者全部作品用过的标签，选中后按该标签重新抓取；
 * 与顶部过滤弹窗（本地规则过滤）是两回事：这里换的是接口查询条件。
 * pixiv 本身一次只支持一个标签，所以这里也是单选。
 */
export function UserTagDialog(props: UserTagDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const userId = props.userId.trim()
  const content = props.content
  // 首次打开优先命中缓存：直接渲染标签，不再闪一次 loading
  const [state, setState] = useState<LoadState>(() => {
    const cached = userId ? readUserTags(userId, content) : null
    return cached ? { phase: 'ready', tags: cached } : { phase: 'loading' }
  })
  const [keyword, setKeyword] = useState('')
  /** 每次手动刷新 +1；0 表示首次加载（允许读缓存） */
  const [reloadTick, setReloadTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  /** 手动刷新失败时保留旧列表，只在顶部提示一行 */
  const [refreshError, setRefreshError] = useState('')
  const hasTags = useRef(false)
  hasTags.current = state.phase === 'ready'

  useEffect(() => {
    if (!userId) {
      setState({ phase: 'error', message: t('tags.needUser') })
      return
    }
    let alive = true
    // 手动刷新走强制请求；首次打开才读缓存
    const cached = reloadTick > 0 ? null : readUserTags(userId, content)
    if (cached) {
      setState({ phase: 'ready', tags: cached })
      return
    }
    // 已有数据时刷新不清空列表，只转小圈；没有数据（首次加载 / 重试）才走 loading
    if (hasTags.current) setRefreshing(true)
    else setState({ phase: 'loading' })
    setRefreshError('')

    window.pixiv
      .userTags(userId, content)
      .then((tags) => {
        if (!alive) return
        writeUserTags(userId, tags, content)
        setState({ phase: 'ready', tags })
        setRefreshing(false)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setRefreshing(false)
        const message = messageOf(reason)
        // 刷新失败不该把已经拿到的标签弄丢
        if (hasTags.current) setRefreshError(message)
        else setState({ phase: 'error', message })
      })
    return () => {
      alive = false
    }
  }, [userId, content, reloadTick, t])

  const visible = useMemo(() => {
    if (state.phase !== 'ready') return []
    const word = keyword.trim().toLowerCase()
    if (!word) return state.tags
    return state.tags.filter(
      (item) =>
        item.tag.toLowerCase().includes(word) ||
        (item.translation || '').toLowerCase().includes(word) ||
        (item.reading || '').toLowerCase().includes(word)
    )
  }, [state, keyword])

  return (
    <Dialog
      title={t('tags.title')}
      description={t('tags.description')}
      icon={<Tags className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted-foreground">
            {t('tags.singleHint')}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={props.busy}
            onClick={() => props.onSelect(null)}
          >
            {t('tags.allWorks')}
          </Button>
          <Button size="sm" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="flex h-[56vh] min-h-0 flex-col gap-3">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('tags.search')}
            className="pl-8"
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span>
              {state.phase === 'ready'
                ? t('tags.total', { count: state.tags.length })
                : t('tags.loading')}
            </span>
            <button
              type="button"
              disabled={!userId || refreshing || state.phase === 'loading'}
              onClick={() => setReloadTick((value) => value + 1)}
              title={t('tags.refresh')}
              aria-label={t('tags.refresh')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                refreshing ? 'text-primary' : ''
              )}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing ? 'animate-spin' : '')} />
              {t('tags.refresh')}
            </button>
          </span>
          {props.activeTag ? (
            <span className="max-w-[55%] truncate rounded-full bg-primary/15 px-2 py-0.5 text-primary">
              {t('tags.current', { tag: props.activeTag })}
            </span>
          ) : null}
        </div>

        {refreshError ? (
          <p className="-mt-1 shrink-0 truncate text-[11px] text-destructive">
            {t('tags.refreshFailed', { message: refreshError })}
          </p>
        ) : null}

        <div className="scrollbar-thin -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          {state.phase === 'loading' ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('tags.loading')}
            </div>
          ) : null}

          {state.phase === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-xs text-muted-foreground">{state.message}</p>
              {userId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadTick((value) => value + 1)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t('tags.retry')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {state.phase === 'ready' && state.tags.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('tags.empty')}</p>
          ) : null}

          {state.phase === 'ready' && state.tags.length > 0 && visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">{t('tags.noMatch')}</p>
          ) : null}

          <div className="space-y-0.5">
            {visible.map((item) => {
              const active = item.tag === props.activeTag
              const subtitle = item.translation || item.reading || ''
              return (
                <button
                  key={item.tag}
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onSelect(item.tag)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors',
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-foreground hover:bg-secondary/70',
                    props.busy ? 'cursor-not-allowed opacity-60' : ''
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.tag}</span>
                    {subtitle && subtitle !== item.tag ? (
                      <span className="block truncate text-[11px] text-muted-foreground/70">
                        {subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {t('tags.count', { count: item.count })}
                  </span>
                  {active ? <Check className="h-4 w-4 shrink-0" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
