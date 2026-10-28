import { ArrowLeft, Loader2, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@renderer/i18n'
import {
  loadReaderSettings,
  loadReadingProgress,
  saveReaderSettings,
  saveReadingProgress,
  type ReaderSettings
} from '@renderer/lib/novel'
import { Button } from '@renderer/components/ui/button'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const THEMES: ReaderSettings['theme'][] = ['light', 'sepia', 'dark']

/** 本地 TXT 阅读：与在线阅读器共用字号、主题和进度记忆，只是正文不做标记解析 */
export function NovelLocalReaderPage(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const filePath = params.get('path') || ''
  const title = params.get('title') || ''
  const author = params.get('author') || ''

  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings())
  const [percent, setPercent] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (!filePath) {
      setLoading(false)
      setError(t('novel.loadFailed'))
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    restoredRef.current = false
    void window.pixiv
      .readNovelLibraryFile(filePath)
      .then((data) => {
        if (alive) setText(data)
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [filePath])

  useEffect(() => {
    if (loading || restoredRef.current) return
    const el = scrollRef.current
    if (!el) return
    restoredRef.current = true
    const saved = loadReadingProgress(filePath)
    if (saved <= 0) return
    requestAnimationFrame(() => {
      el.scrollTop = saved * Math.max(0, el.scrollHeight - el.clientHeight)
      setPercent(Math.round(saved * 100))
    })
  }, [loading, filePath])

  useEffect(() => {
    if (!filePath || loading) return
    const timer = window.setTimeout(() => {
      saveReadingProgress(filePath, percent / 100)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [filePath, loading, percent])

  useEffect(() => {
    saveReaderSettings(settings)
  }, [settings])

  const changeFont = (delta: number): void => {
    setSettings((previous) => ({
      ...previous,
      fontSize: Math.max(14, Math.min(26, previous.fontSize + delta))
    }))
  }

  const themeClass =
    settings.theme === 'dark'
      ? 'bg-[#15161a] text-[#c8c8d0]'
      : settings.theme === 'light'
        ? 'bg-[#fbfbfa] text-[#232323]'
        : 'bg-[#f4ecd8] text-[#3a3128]'

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
          <ArrowLeft />
          {t('novelLib.title')}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {title}
          {author ? ` · ${author}` : ''}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('novel.progress', { percent })}
        </span>
        <div className="flex items-center gap-0.5 rounded-md border border-border/60">
          <button
            type="button"
            onClick={() => changeFont(-1)}
            className="px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('novel.fontSmaller')}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[1.6rem] text-center text-[10px] text-muted-foreground">
            {settings.fontSize}
          </span>
          <button
            type="button"
            onClick={() => changeFont(1)}
            className="px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('novel.fontBigger')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => setSettings((previous) => ({ ...previous, theme }))}
              title={t(`novel.theme.${theme}` as const)}
              className={`h-4 w-4 rounded-sm border ${
                theme === 'light'
                  ? 'border-black/15 bg-[#fbfbfa]'
                  : theme === 'sepia'
                    ? 'border-black/15 bg-[#f4ecd8]'
                    : 'border-white/20 bg-[#15161a]'
              } ${settings.theme === theme ? 'ring-1 ring-primary' : ''}`}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
            void window.pixiv.openDir(index > 0 ? filePath.slice(0, index) : filePath)
          }}
        >
          {t('novel.openDir')}
        </Button>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          const max = el.scrollHeight - el.clientHeight
          setPercent(max > 0 ? Math.round((el.scrollTop / max) * 100) : 100)
        }}
        className={`scrollbar-thin min-h-0 flex-1 overflow-y-auto ${themeClass}`}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm opacity-60">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('novel.loading')}
          </div>
        ) : (
          <article
            className="mx-auto max-w-3xl whitespace-pre-wrap break-words px-10 py-10"
            style={{ fontSize: `${settings.fontSize}px`, lineHeight: 2 }}
          >
            {text}
          </article>
        )}
      </div>
    </main>
  )
}
