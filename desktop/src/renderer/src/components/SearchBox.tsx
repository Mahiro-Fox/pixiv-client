import { Clock, Flame, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type { TagSuggestion } from '@shared/types'
import { useI18n } from '@renderer/i18n'

const HISTORY_KEY = 'pixiv.searchHistory'
const HISTORY_LIMIT = 8

/** 本地搜索历史：读写都要容错，存坏了也不该影响搜索 */
function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(list)) return []
    return list
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeHistory(list: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式等场景写不进去就退化为仅内存 */
  }
}

/** 热门标签在一次会话内共用，避免每次展开都请求 */
let hotCache: TagSuggestion[] = []

/**
 * 顶栏全局搜索框。
 * 展开时：没有关键词 → 搜索历史 + 热门标签；有关键词 → pixiv 联想补全。
 */
export function SearchBox(props: {
  value: string
  onChange: (value: string) => void
  onSubmit: (word: string) => void
  placeholder: string
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(readHistory)
  const [hot, setHot] = useState<TagSuggestion[]>(hotCache)
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const word = props.value.trim()

  // 点外部关闭下拉
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 热门标签：首次展开时拉一次
  useEffect(() => {
    if (!open || hot.length > 0) return
    let alive = true
    setLoading(true)
    void window.pixiv
      .getTrendingTags()
      .then((tags) => {
        hotCache = tags
        if (alive) setHot(tags)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, hot.length])

  // 联想补全：至少 2 个字符才请求，输入停顿 250ms 后发出
  useEffect(() => {
    if (!open || word.length < 2) {
      setSuggestions([])
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      void window.pixiv
        .suggestTags(word)
        .then((tags) => {
          if (alive) setSuggestions(tags.slice(0, 8))
        })
        .catch(() => {
          if (alive) setSuggestions([])
        })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, word])

  /** 提交搜索：写历史、同步关键词、跳转都由外部处理 */
  const commit = (next: string): void => {
    const value = next.trim()
    if (!value) return
    const list = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_LIMIT)
    setHistory(list)
    writeHistory(list)
    props.onChange(value)
    props.onSubmit(value)
    setOpen(false)
  }

  const removeHistory = (item: string): void => {
    const list = history.filter((entry) => entry !== item)
    setHistory(list)
    writeHistory(list)
  }

  const hasPanel = word.length >= 2 || history.length > 0 || hot.length > 0 || loading

  return (
    <div ref={boxRef} className="relative ml-auto w-full min-w-[9rem] max-w-[24rem]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(props.value)
          else if (event.key === 'Escape') setOpen(false)
        }}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        className="h-8 w-full rounded-full border border-border/60 bg-secondary/30 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
      />

      {open && hasPanel ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[22rem] overflow-y-auto rounded-xl border border-border/70 bg-card p-1.5 shadow-xl">
          {word.length >= 2 ? (
            <div>
              <p className="px-2 py-1 text-[10px] text-muted-foreground">{t('search.suggest')}</p>
              {suggestions.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => commit(item.tag)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-secondary/60"
                >
                  <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.tag}</span>
                  {item.translation ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {item.translation}
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => commit(word)}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-border/40 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <Search className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {t('search.submitHint', { word })}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {history.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {t('search.history')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHistory([])
                        writeHistory([])
                      }}
                      className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('search.clear')}
                    </button>
                  </div>
                  {history.map((item) => (
                    <div key={item} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => commit(item)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-secondary/60"
                      >
                        <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{item}</span>
                      </button>
                      <button
                        type="button"
                        title={t('search.remove')}
                        onClick={() => removeHistory(item)}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {hot.length > 0 ? (
                <div className="px-2 pb-1">
                  <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Flame className="h-3 w-3" />
                    {t('search.hot')}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {hot.map((item) => (
                      <button
                        key={item.tag}
                        type="button"
                        onClick={() => commit(item.tag)}
                        className="rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60 hover:text-primary"
                      >
                        {item.tag}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {loading ? (
                <p className="px-2 py-1 text-[10px] text-muted-foreground">{t('search.loading')}</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
