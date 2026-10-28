import { Minus, Plus, Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useI18n } from '@renderer/i18n'
import { READER_WIDTHS, type ReaderSettings } from '@renderer/lib/novel'

interface NovelReaderSettingsProps {
  settings: ReaderSettings
  onChange: (patch: Partial<ReaderSettings>) => void
}

const THEMES: ReaderSettings['theme'][] = ['light', 'sepia', 'dark']

const THEME_SWATCH: Record<ReaderSettings['theme'], string> = {
  light: 'border-black/15 bg-[#fbfbfa]',
  sepia: 'border-black/15 bg-[#f4ecd8]',
  dark: 'border-white/20 bg-[#15161a]'
}

/** 在线阅读与本地阅读共用的阅读设置浮层：字号 / 行高 / 宽度 / 主题 */
export function NovelReaderSettings({
  settings,
  onChange
}: NovelReaderSettingsProps): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  // 点浮层外部关闭，避免在正文里点一下就误触
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const step = (key: 'fontSize' | 'lineHeight', delta: number): void => {
    if (key === 'fontSize') {
      onChange({ fontSize: Math.max(14, Math.min(26, settings.fontSize + delta)) })
      return
    }
    const next = Math.round((settings.lineHeight + delta) * 10) / 10
    onChange({ lineHeight: Math.max(1.4, Math.min(2.6, next)) })
  }

  const stepper = (
    key: 'fontSize' | 'lineHeight',
    label: string,
    value: string,
    decrease: string,
    increase: string
  ): React.JSX.Element => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5 rounded-md border border-border/70">
        <button
          type="button"
          aria-label={decrease}
          onClick={() => step(key, -1 * (key === 'lineHeight' ? 0.1 : 1))}
          className="px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="min-w-[2.2rem] text-center text-[11px] tabular-nums">{value}</span>
        <button
          type="button"
          aria-label={increase}
          onClick={() => step(key, key === 'lineHeight' ? 0.1 : 1)}
          className="px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        title={t('novel.readerSettings')}
        aria-label={t('novel.readerSettings')}
        className={`rounded-md border px-1.5 py-1 transition-colors ${
          open
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border/60 text-muted-foreground hover:text-foreground'
        }`}
      >
        <Type className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 space-y-3 rounded-lg border border-border/70 bg-popover p-3 shadow-lg">
          {stepper(
            'fontSize',
            t('novel.fontSize'),
            String(settings.fontSize),
            t('novel.fontSmaller'),
            t('novel.fontBigger')
          )}
          {stepper(
            'lineHeight',
            t('novel.lineHeight'),
            settings.lineHeight.toFixed(1),
            t('novel.lineHeightSmaller'),
            t('novel.lineHeightBigger')
          )}

          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('novel.width')}</span>
            <div className="flex overflow-hidden rounded-md border border-border/70">
              {READER_WIDTHS.map((width, index) => (
                <button
                  key={width}
                  type="button"
                  onClick={() => onChange({ maxWidth: width })}
                  className={`flex-1 py-1 text-[11px] transition-colors ${
                    settings.maxWidth === width
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-secondary/50'
                  }`}
                >
                  {[t('novel.widthNarrow'), t('novel.widthStandard'), t('novel.widthWide')][index]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('novel.theme')}</span>
            <div className="flex items-center gap-1">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => onChange({ theme })}
                  title={t(`novel.theme.${theme}` as const)}
                  aria-label={t(`novel.theme.${theme}` as const)}
                  className={`h-5 w-5 rounded-sm border ${THEME_SWATCH[theme]} ${
                    settings.theme === theme ? 'ring-1 ring-primary' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
