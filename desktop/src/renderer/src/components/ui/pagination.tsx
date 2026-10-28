import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type * as React from 'react'
import { useI18n } from '@renderer/i18n'
import { Button } from './button'

type PageItem = number | 'gap'

/** 页数较多时折叠成「首页 … 当前页附近 … 末页」 */
function buildItems(page: number, lastPage: number): PageItem[] {
  if (lastPage <= 7) return Array.from({ length: lastPage }, (_, index) => index + 1)

  const start = Math.max(2, Math.min(page - 1, lastPage - 4))
  const end = Math.min(lastPage - 1, Math.max(page + 1, 5))
  const items: PageItem[] = [1]
  if (start > 2) items.push('gap')
  for (let item = start; item <= end; item += 1) items.push(item)
  if (end < lastPage - 1) items.push('gap')
  items.push(lastPage)
  return items
}

/**
 * 通用分页：首 / 末页、上一页 / 下一页、页码省略、直接输入页码跳转。
 * 页码与跳转都做了边界收敛，越界的输入不会把页面带出范围。
 */
export function Pagination(props: {
  page: number
  lastPage: number
  onChange: (page: number) => void
  /** 加载中禁止交互，避免重复请求 */
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const lastPage = Math.max(1, props.lastPage)
  const page = Math.min(lastPage, Math.max(1, props.page))
  const [draft, setDraft] = useState('')
  const disabled = Boolean(props.disabled)

  // 页码变化（含外部切换 tab 重置）后清空输入框
  useEffect(() => {
    setDraft('')
  }, [page])

  const go = (next: number): void => {
    const target = Math.min(lastPage, Math.max(1, Math.round(next)))
    if (target !== page) props.onChange(target)
  }

  const jump = (): void => {
    const value = Math.round(Number(draft))
    if (!Number.isFinite(value)) {
      setDraft('')
      return
    }
    go(value)
    setDraft('')
  }

  const pageButton = (item: number): React.JSX.Element => (
    <button
      key={item}
      type="button"
      disabled={disabled}
      onClick={() => go(item)}
      aria-current={item === page ? 'page' : undefined}
      className={`h-7 min-w-7 rounded-md border px-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        item === page
          ? 'border-primary/60 bg-primary/15 font-medium text-primary'
          : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      {item}
    </button>
  )

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="sm"
        title={t('pager.first')}
        disabled={disabled || page <= 1}
        onClick={() => go(1)}
      >
        <ChevronsLeft />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft />
        {t('pager.prev')}
      </Button>

      <div className="flex items-center gap-0.5">
        {buildItems(page, lastPage).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground/70"
            >
              …
            </span>
          ) : (
            pageButton(item)
          )
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || page >= lastPage}
        onClick={() => go(page + 1)}
      >
        {t('pager.next')}
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title={t('pager.last')}
        disabled={disabled || page >= lastPage}
        onClick={() => go(lastPage)}
      >
        <ChevronsRight />
      </Button>

      <span className="ml-1">{t('pager.total', { total: lastPage })}</span>

      <div className="flex items-center gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') jump()
          }}
          inputMode="numeric"
          placeholder={t('pager.jumpPlaceholder')}
          aria-label={t('pager.jumpPlaceholder')}
          className="h-7 w-14 rounded-md border border-border/60 bg-secondary/30 px-2 text-center text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
        />
        <Button variant="ghost" size="sm" disabled={disabled || !draft} onClick={jump}>
          {t('pager.go')}
        </Button>
      </div>
    </div>
  )
}
