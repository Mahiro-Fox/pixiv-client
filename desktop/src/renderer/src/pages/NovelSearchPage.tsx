import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Hash,
  ImageOff,
  Loader2,
  Search,
  Sparkles,
  Timer,
  User
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  NovelOrder,
  NovelSearchMode,
  NovelSearchResult,
  NovelSearchTarget,
  NovelWork
} from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { readingMinutes } from '@renderer/lib/novel'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/select'

const ORDERS: NovelOrder[] = ['date_d', 'date', 'popular_d', 'popular_male_d', 'popular_female_d']
const TARGETS: NovelSearchTarget[] = ['s_tag_full', 's_tag', 's_tc']

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function NovelRow(props: { novel: NovelWork; onOpen: (id: string) => void; onSeries: (id: string) => void }): React.JSX.Element {
  const { t } = useI18n()
  const { novel } = props
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => props.onOpen(novel.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen(novel.id)
        }
      }}
      className="group flex cursor-pointer gap-4 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/70"
    >
      <div className="relative h-[7.5rem] w-[5.4rem] shrink-0 overflow-hidden rounded-lg bg-secondary/60">
        {novel.cover ? (
          <img
            src={novel.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
        {novel.xRestrict >= 1 ? (
          <Badge variant="destructive" className="absolute left-1 top-1 bg-red-500/85 text-white">
            R-18
          </Badge>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 flex-1 text-sm font-medium leading-5">{novel.title}</h3>
          {novel.seriesId ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                props.onSeries(novel.seriesId as string)
              }}
              className="shrink-0 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] text-primary transition-colors hover:bg-primary/10"
            >
              {t('novel.series')}
            </button>
          ) : null}
        </div>

        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <User className="h-3 w-3 shrink-0" />
          {novel.userName}
          {novel.seriesTitle ? (
            <span className="truncate">· {novel.seriesTitle}</span>
          ) : null}
        </p>

        {novel.description ? (
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground/90">
            {novel.description.replace(/<br\s*\/?>/gi, ' ')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {novel.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{t('novel.chars', { count: novel.textCount })}</span>
          <span className="flex items-center gap-1">
            <Timer className="h-3 w-3" />
            {t('novel.readTime', { minutes: readingMinutes(novel.readingTime) })}
          </span>
          <span>{t('novel.bookmarks', { count: novel.bookmarkCount })}</span>
          {novel.aiType === 2 ? (
            <Badge className="bg-violet-500/80 px-1 py-0 text-[10px] text-white">AI</Badge>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function NovelSearchPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const word = params.get('word') || ''
  const order = (ORDERS.includes(params.get('order') as NovelOrder) ? params.get('order') : 'date_d') as NovelOrder
  const mode = (params.get('mode') === 'safe' ? 'safe' : 'all') as NovelSearchMode
  const target = (TARGETS.includes(params.get('target') as NovelSearchTarget)
    ? params.get('target')
    : 's_tag_full') as NovelSearchTarget
  const page = Math.max(1, Math.min(10, Number(params.get('page') || 1) || 1))

  const [input, setInput] = useState(word)
  const [result, setResult] = useState<NovelSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setInput(word), [word])

  useEffect(() => {
    if (!word) {
      setResult(null)
      setError('')
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    void window.pixiv
      .searchNovels({ word, order, mode, target, page })
      .then((data) => {
        if (alive) setResult(data)
      })
      .catch((reason: unknown) => {
        if (alive) {
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
  }, [word, order, mode, target, page])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  const submit = (): void => {
    const keyword = input.trim()
    apply({ word: keyword, order, mode, target, page: '1' })
  }

  const relatedTags = useMemo(
    () => (result?.relatedTags || []).filter((tag) => tag && tag !== word).slice(0, 24),
    [result, word]
  )

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            placeholder={t('novel.searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-border/60 bg-secondary/40 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary/60"
          />
        </div>
        <Button size="sm" onClick={submit} disabled={!input.trim() || loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Search />}
          {t('novel.search')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t('novel.target')}</span>
        <Select
          size="sm"
          className="w-[7.5rem]"
          value={target}
          onChange={(value) => apply({ target: value, page: '1' })}
          options={[
            { value: 's_tag_full', label: t('novel.targetTagFull') },
            { value: 's_tag', label: t('novel.targetTag') },
            { value: 's_tc', label: t('novel.targetTitle') }
          ]}
        />
        <span className="ml-2">{t('novel.order')}</span>
        <Select
          size="sm"
          className="w-[8rem]"
          value={order}
          onChange={(value) => apply({ order: value, page: '1' })}
          options={[
            { value: 'date_d', label: t('novel.orderDateDesc') },
            { value: 'date', label: t('novel.orderDateAsc') },
            { value: 'popular_d', label: t('novel.orderPopular') },
            { value: 'popular_male_d', label: t('novel.orderPopularMale') },
            { value: 'popular_female_d', label: t('novel.orderPopularFemale') }
          ]}
        />
        <span className="ml-2">{t('novel.mode')}</span>
        <Select
          size="sm"
          className="w-[8.5rem]"
          value={mode}
          onChange={(value) => apply({ mode: value, page: '1' })}
          options={[
            { value: 'all', label: t('novel.modeAll') },
            { value: 'safe', label: t('novel.modeSafe') }
          ]}
        />
        {result && word ? (
          <span className="ml-auto text-[11px]">{t('novel.total', { total: result.total })}</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!word ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <BookOpen className="h-10 w-10 opacity-40" />
          <p className="text-sm">{t('novel.empty')}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_14rem] gap-4">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('novel.loading')}
                </div>
              ) : null}
              {!loading && result && result.novels.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  {t('novel.noResult')}
                </div>
              ) : null}
              {!loading
                ? result?.novels.map((novel) => (
                    <NovelRow
                      key={novel.id}
                      novel={novel}
                      onOpen={(id) => navigate(`/novel/${id}`)}
                      onSeries={(id) => navigate(`/novel/series/${id}`)}
                    />
                  ))
                : null}
            </div>

            {result && result.lastPage > 1 ? (
              <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-muted-foreground">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => apply({ page: String(page - 1) })}
                >
                  <ChevronLeft />
                  {t('novel.prevPage')}
                </Button>
                <span>{t('novel.page', { page, total: result.lastPage })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= result.lastPage || loading}
                  onClick={() => apply({ page: String(page + 1) })}
                >
                  {t('novel.nextPage')}
                  <ChevronRight />
                </Button>
              </div>
            ) : null}
          </div>

          <aside className="scrollbar-thin min-h-0 overflow-y-auto rounded-xl border border-border/50 bg-card/30 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Hash className="h-3.5 w-3.5" />
              {t('novel.relatedTags')}
            </p>
            {relatedTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {relatedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setInput(tag)
                      apply({ word: tag, target: 's_tag_full', page: '1' })
                    }}
                    className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                <Sparkles className="h-3 w-3" />
                {t('novel.relatedTagsEmpty')}
              </p>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}
