import { ArrowLeft, Loader2 } from 'lucide-react'
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
import { NovelReaderSettings } from '@renderer/components/NovelReaderSettings'

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

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
        <NovelReaderSettings
          settings={settings}
          onChange={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
        />
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
            className="mx-auto whitespace-pre-wrap break-words px-10 py-10"
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              maxWidth: `${settings.maxWidth}px`
            }}
          >
            {text}
          </article>
        )}
      </div>
    </main>
  )
}
