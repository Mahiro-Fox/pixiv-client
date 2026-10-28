import {
  BookOpen,
  FileText,
  FolderOpen,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { NovelLibraryItem, NovelTextSearchResult } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Button } from '@renderer/components/ui/button'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function dirOf(file: string): string {
  const index = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'))
  return index > 0 ? file.slice(0, index) : file
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 检索结果片段高亮；split 带捕获组，匹配项会保留在数组里 */
function Highlight(props: { text: string; keyword: string }): React.JSX.Element {
  if (!props.keyword) return <>{props.text}</>
  const parts = props.text.split(new RegExp(`(${escapeRegExp(props.keyword)})`, 'gi'))
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === props.keyword.toLowerCase() ? (
          <mark key={index} className="rounded bg-amber-400/50 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

function openReader(
  navigate: ReturnType<typeof useNavigate>,
  item: { path: string; title: string; author: string }
): void {
  const params = new URLSearchParams({
    path: item.path,
    title: item.title,
    author: item.author
  })
  navigate(`/novel/local?${params.toString()}`)
}

export function NovelLibraryPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [items, setItems] = useState<NovelLibraryItem[]>([])
  const [root, setRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<NovelTextSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  const load = async (force: boolean): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const data = await window.pixiv.listNovelLibrary(force)
      setItems(data.items)
      setRoot(data.root)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
  }, [])

  // 正文检索有延迟落盘的成本，输入停顿 350ms 后再发起
  useEffect(() => {
    const word = keyword.trim()
    if (!word) {
      setResult(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    setError('')
    const timer = window.setTimeout(() => {
      void window.pixiv
        .searchNovelLibrary(word)
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
          if (alive) setSearching(false)
        })
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [keyword])

  const searchingMode = keyword.trim().length > 0

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t('novelLib.title')}</h2>
          <span className="text-[11px] text-muted-foreground">
            {t('novelLib.count', { count: items.length })}
          </span>
        </div>

        <div className="relative ml-auto min-w-[16rem] max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('novelLib.searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-border/60 bg-secondary/40 pl-9 pr-8 text-sm outline-none transition-colors focus:border-primary/60"
          />
          {keyword ? (
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={t('novel.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t('novelLib.rescan')}
        </Button>
        {root ? (
          <Button variant="ghost" size="sm" onClick={() => void window.pixiv.openDir(root)}>
            <FolderOpen />
            {t('novel.openDir')}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {searchingMode ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            {searching
              ? t('novelLib.searching')
              : result
                ? t('novelLib.hitCount', { count: result.hits.length, scanned: result.scanned })
                : ''}
          </p>
          <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {result?.hits.map((hit) => (
              <article
                key={hit.path}
                role="button"
                tabIndex={0}
                onClick={() => openReader(navigate, hit)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openReader(navigate, hit)
                  }
                }}
                className="cursor-pointer rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/70"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{hit.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{hit.author}</span>
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('novelLib.matches', { count: hit.matches })}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {hit.snippets.map((snippet, index) => (
                    <p
                      key={index}
                      className="line-clamp-2 text-[11px] leading-5 text-muted-foreground"
                    >
                      <Highlight text={snippet} keyword={keyword.trim()} />
                    </p>
                  ))}
                </div>
              </article>
            ))}
            {!searching && result && result.hits.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {t('novelLib.noHit')}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('novelLib.loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <BookOpen className="h-10 w-10 opacity-40" />
              <p className="text-sm">{t('novelLib.empty')}</p>
              <p className="text-[11px] opacity-70">{t('novelLib.emptyHint')}</p>
              <Button variant="outline" size="sm" onClick={() => navigate('/novel')}>
                <Search />
                {t('nav.novel')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {items.map((item) => (
                <article
                  key={item.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => openReader(navigate, item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openReader(navigate, item)
                    }
                  }}
                  className="group flex cursor-pointer gap-3 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/70"
                >
                  <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <h3 className="line-clamp-2 flex-1 text-xs font-medium leading-5">
                        {item.title}
                      </h3>
                      <span className="shrink-0 rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {item.kind === 'series' ? t('novel.series') : t('novelLib.oneshot')}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{item.author}</p>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {item.characters > 0 ? (
                        <span>{t('novel.chars', { count: item.characters })}</span>
                      ) : null}
                      {item.episodes > 1 ? (
                        <span>{t('novel.episodes', { count: item.episodes })}</span>
                      ) : null}
                      <span>{item.updatedAt.slice(0, 10)}</span>
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void window.pixiv.openDir(dirOf(item.path))
                        }}
                      >
                        <FolderOpen />
                        {t('novel.openDir')}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  )
}
