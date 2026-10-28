import { Check, ExternalLink, Gem, Image as ImageIcon, ImageOff, Loader2, Plus, X } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { ImageQuality, PixivWork, WorkPage } from '@shared/types'
import { readWorkPages, writeWorkPages } from '@renderer/lib/dialogCache'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { useImagePreview } from './ImagePreview'

interface WorkDetailDialogProps {
  work: PixivWork
  /** 初始预览质量，来自全局下载质量设置 */
  quality: ImageQuality
  selected: boolean
  onToggle: (id: string) => void
  onClose: () => void
  /** 搜索结果只做预览，不提供「加入下载」，默认显示 */
  showSelection?: boolean
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function WorkDetailDialog(props: WorkDetailDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const { work } = props
  const preview = useImagePreview()
  const [pages, setPages] = useState<WorkPage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quality, setQuality] = useState<ImageQuality>(props.quality)

  // 详情弹窗的预览质量默认跟随全局设置，切换作品时重置
  useEffect(() => {
    setQuality(props.quality)
  }, [props.quality, work.id])

  const srcOf = (page: WorkPage): string => {
    if (quality === 'original') return page.original || page.regular || page.url
    return page.regular || page.url
  }

  // 点击图片在应用内全屏预览，不再跳浏览器
  const openPreview = (start: number): void => {
    preview.open(
      pages.map((page, index) => ({
        src: srcOf(page),
        alt: t('detail.pageAlt', { title: work.title, page: index + 1 })
      })),
      start
    )
  }

  const isUgoira = Number(work.illustType) === 2

  useEffect(() => {
    let alive = true
    setError('')

    // 同一个作品短时间内再次打开时直接用缓存，避免重复请求分页接口
    const cached = readWorkPages(work.id)
    if (cached) {
      setPages(cached)
      setLoading(false)
      return () => {
        alive = false
      }
    }

    setPages([])
    setLoading(true)

    void window.pixiv
      .getWorkPages(work.id)
      .then((result) => {
        if (!alive) return
        setPages(result)
        writeWorkPages(work.id, result)
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
  }, [work.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('detail.ariaLabel', { title: work.title })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-base font-semibold">{work.title}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {work.userName} · ID {work.id}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Badge variant="outline">
                {t('detail.pageCount', { count: work.pageCount || pages.length })}
              </Badge>
              {isUgoira ? (
                <Badge className="bg-amber-500/80 text-white backdrop-blur">{t('detail.ugoira')}</Badge>
              ) : null}
              {work.width > 0 && work.height > 0 ? (
                <Badge variant="outline">
                  {work.width} × {work.height}
                </Badge>
              ) : null}
              {pages[0]?.width ? (
                <Badge variant="outline">
                  {t('detail.singlePage', { width: pages[0].width, height: pages[0].height })}
                </Badge>
              ) : null}
              <div className="ml-1 flex items-center gap-0.5 rounded-md bg-secondary/60 p-0.5">
                {(
                  [
                    { value: 'regular', labelKey: 'detail.qualityRegular', icon: <ImageIcon className="h-3 w-3" /> },
                    { value: 'original', labelKey: 'detail.qualityOriginal', icon: <Gem className="h-3 w-3" /> }
                  ] as {
                      value: ImageQuality
                      labelKey: 'detail.qualityRegular' | 'detail.qualityOriginal'
                      icon: React.JSX.Element
                    }[]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setQuality(option.value)}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                      quality === option.value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {option.icon}
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <a
                href={`https://www.pixiv.net/artworks/${work.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary transition-colors hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t('detail.openOnPixiv')}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={t('detail.close')}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isUgoira ? (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-600">
              {t('detail.ugoiraNotice')}
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('detail.resolving')}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <ImageOff className="h-6 w-6" />
              {t('detail.noPreview')}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {pages.map((page, index) => {
                const src = srcOf(page)
                return (
                  <button
                    key={`${page.url}-${index}`}
                    type="button"
                    onClick={() => openPreview(index)}
                    className="group relative overflow-hidden rounded-lg border border-border/60 bg-secondary/50 text-left"
                  >
                    <img
                      src={src}
                      alt={t('detail.pageAlt', { title: work.title, page: index + 1 })}
                      loading="lazy"
                      className="aspect-[3/4] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                      p{index}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <p className="truncate text-[11px] text-muted-foreground">
            {t('detail.authorDir', { id: work.userId, name: work.userName })}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t('detail.close')}
            </Button>
            {props.showSelection === false ? null : (
              <Button
                variant={props.selected ? 'outline' : 'default'}
                size="sm"
                onClick={() => props.onToggle(work.id)}
              >
                {props.selected ? <Check /> : <Plus />}
                {props.selected ? t('detail.selected') : t('detail.addToDownload')}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
