import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Filter,
  Images,
  Tags,
  X
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type * as React from 'react'
import type { PixivWork, WorkSort } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { Button } from './ui/button'
import { buildPageItems } from './ui/pagination'
import { WorkCard } from './WorkCard'

interface WorksGridProps {
  works: PixivWork[]
  selected: Set<string>
  downloaded: Set<string>
  downloadedCount: number
  collecting: boolean
  loaded: number
  total: number
  filteredTotal: number
  filteredOut: number
  onlyNew: boolean
  sort: WorkSort
  /** 已启用的过滤规则数量，用于过滤图标徽标 */
  activeFilterCount: number
  onSortChange: (sort: WorkSort) => void
  onOpenFilter: () => void
  /** 当前按标签筛选的标签；空串表示「全部作品」 */
  activeTag?: string
  /** 打开标签筛选弹窗；不传则不显示入口（收藏栏目列的是收藏夹标签，没有作者标签云可列） */
  onOpenTags?: () => void
  /** 清除标签筛选，回到该作者的全部作品 */
  onClearTag?: () => void
  onExport: () => void
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onToggle: (id: string) => void
  onToggleAll: () => void
  onOpen: (work: PixivWork) => void
  onToggleOnlyNew: () => void
}

export function WorksGrid(props: WorksGridProps): React.JSX.Element {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 翻页后回到列表顶部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [props.page])

  if (props.collecting && props.filteredTotal === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-border/60">
            <div className="aspect-square animate-pulse bg-secondary/60" />
            <div className="space-y-2 p-2.5">
              <div className="h-4 w-4/5 animate-pulse rounded bg-secondary/60" />
              <div className="h-4 w-2/5 animate-pulse rounded bg-secondary/40" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (props.filteredTotal === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
          <Images className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {props.onlyNew ? t('works.emptyOnlyNew') : t('works.empty')}
          </p>
          <p className="text-xs text-muted-foreground">
            {props.onlyNew
              ? t('works.emptyOnlyNewHint')
              : props.filteredOut > 0
                ? t('works.emptyFilteredHint', { count: props.filteredOut })
                : t('works.emptyHint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 换了标签却没有结果时，唯一的出路是再选一个：这里也放一个入口 */}
          {props.onOpenTags ? (
            <Button variant="outline" size="sm" onClick={props.onOpenTags}>
              <Tags />
              {t('works.tagFilter')}
            </Button>
          ) : null}
          {props.filteredOut > 0 ? (
            <Button variant="outline" size="sm" onClick={props.onOpenFilter}>
              <Filter />
              {t('works.adjustFilter')}
            </Button>
          ) : null}
          {props.onlyNew ? (
            <button
              type="button"
              onClick={props.onToggleOnlyNew}
              className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              {t('works.viewAll')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const allSelected =
    props.works.length > 0 && props.works.every((work) => props.selected.has(work.id))
  const selectedOnPage = props.works.filter((work) => props.selected.has(work.id)).length
  const hasPrev = props.page > 1
  const hasNext = props.page < props.pageCount

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 pb-3" data-tour="works-toolbar">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {t('works.totalPrefix')}
          <span className="font-medium text-foreground">{props.filteredTotal}</span>
          {props.onlyNew ? t('works.countSuffixOnlyNew') : t('works.countSuffix')}
          {props.total > props.filteredTotal ? t('works.apiTotal', { total: props.total }) : ''}
          {props.filteredOut > 0 ? t('works.filteredOut', { count: props.filteredOut }) : ''}
          {props.downloadedCount > 0
            ? t('works.downloadedCount', { count: props.downloadedCount })
            : ''}
          {props.selected.size > 0 ? t('works.selectedCount', { count: props.selected.size }) : ''}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {/* 按标签筛选：换的是接口查询条件，与右边「过滤」的本地规则不是一回事 */}
          {props.onOpenTags ? (
            <>
              <button
                type="button"
                onClick={props.onOpenTags}
                title={t('works.tagFilterHint')}
                className={cn(
                  'flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                  props.activeTag
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Tags className="h-4 w-4 shrink-0" />
                <span className="max-w-[9rem] truncate">
                  {props.activeTag || t('works.tagFilter')}
                </span>
              </button>
              {props.activeTag ? (
                <button
                  type="button"
                  onClick={props.onClearTag}
                  title={t('works.tagClear')}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </>
          ) : null}

          <select
            value={props.sort}
            onChange={(event) => props.onSortChange(event.target.value as WorkSort)}
            aria-label={t('works.sortLabel')}
            className="h-6 rounded-md border border-border/60 bg-background px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="default">{t('works.sortDefault')}</option>
            <option value="pages-desc">{t('works.sortPagesDesc')}</option>
            <option value="pages-asc">{t('works.sortPagesAsc')}</option>
            <option value="date-desc">{t('works.sortDateDesc')}</option>
            <option value="date-asc">{t('works.sortDateAsc')}</option>
          </select>
          <button
            type="button"
            onClick={props.onExport}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FileDown className="h-4 w-4" />
            {t('works.export')}
          </button>
          <button
            type="button"
            onClick={props.onToggleOnlyNew}
            className={cn(
              'rounded-md px-2 py-1 text-xs transition-colors',
              props.onlyNew
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            {t('works.onlyNew')}
          </button>
          <button
            type="button"
            onClick={props.onToggleAll}
            className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            {allSelected ? t('works.deselectAll') : t('works.selectPage')}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-2">
        <ul className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {props.works.map((item, index) => (
            <WorkCard
              key={item.id}
              work={item}
              index={index}
              selected={props.selected.has(item.id)}
              downloaded={props.downloaded.has(item.id)}
              onToggle={() => props.onToggle(item.id)}
              footerAction={
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onOpen(item)
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
                >
                  {t('works.detail')}
                </button>
              }
            />
          ))}
        </ul>
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-1 border-t border-border/60 py-3">
        <button
          type="button"
          disabled={!hasPrev}
          aria-label={t('works.prevPage')}
          onClick={() => props.onPageChange(props.page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {buildPageItems(props.page, props.pageCount).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => props.onPageChange(item)}
              aria-current={item === props.page ? 'page' : undefined}
              className={cn(
                'h-7 min-w-7 rounded-md px-1.5 text-xs transition-colors',
                item === props.page
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          disabled={!hasNext}
          aria-label={t('works.nextPage')}
          onClick={() => props.onPageChange(props.page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
          {props.pageSize > 0 && props.filteredTotal > 0
            ? `${(props.page - 1) * props.pageSize + 1}–${Math.min(
                props.page * props.pageSize,
                props.filteredTotal
              )} / ${props.filteredTotal}`
            : ''}
          {selectedOnPage > 0 ? t('works.pageSelected', { count: selectedOnPage }) : ''}
        </span>
      </footer>
    </div>
  )
}
