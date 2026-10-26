import { Check, ChevronLeft, ChevronRight, FileDown, Filter, ImageOff, Images } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type * as React from 'react'
import type { PixivWork, WorkSort } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

interface WorkCardProps {
  work: PixivWork
  selected: boolean
  downloaded: boolean
  onToggle: (id: string) => void
  onOpen: (work: PixivWork) => void
}

export function WorkCard({
  work,
  selected,
  downloaded,
  onToggle,
  onOpen
}: WorkCardProps): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(work)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(work)
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-card/60 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]'
          : 'border-border/60 hover:border-border'
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-secondary/60">
        {work.url ? (
          <img
            src={work.url}
            alt={work.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageOff className="h-6 w-6" />
          </div>
        )}

        <button
          type="button"
          aria-label={selected ? '取消选择' : '选择作品'}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(work.id)
          }}
          className={cn(
            'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-white/40 bg-black/35 text-transparent backdrop-blur hover:border-white/70'
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>

        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {work.pageCount > 1 ? (
            <Badge variant="outline" className="bg-black/45 backdrop-blur text-white">
              {work.pageCount} 张
            </Badge>
          ) : null}
          {Number(work.illustType) === 2 ? (
            <Badge className="bg-amber-500/80 text-white backdrop-blur">动图</Badge>
          ) : null}
          {Number(work.xRestrict || 0) >= 1 ? (
            <Badge variant="destructive" className="bg-red-500/80 text-white backdrop-blur">
              R-18
            </Badge>
          ) : null}
          {Number(work.aiType || 0) === 2 ? (
            <Badge className="bg-violet-500/80 text-white backdrop-blur">AI</Badge>
          ) : null}
        </div>

        {downloaded ? (
          <Badge variant="success" className="absolute bottom-2 left-2 bg-black/45 backdrop-blur">
            已下载
          </Badge>
        ) : null}
      </div>

      <div className="space-y-1 p-2.5">
        <p className="line-clamp-2 min-h-[2rem] text-xs font-medium leading-4">{work.title}</p>
        <p className="truncate text-[11px] text-muted-foreground">{work.userName}</p>
      </div>
    </div>
  )
}

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

/** 生成带省略号的页码序列，例如 1 … 4 5 6 … 12 */
function pageNumbers(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value))
  if (page >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => pages.add(value))
  }

  const sorted = Array.from(pages)
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b)

  const result: (number | 'gap')[] = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) result.push('gap')
    result.push(value)
  })
  return result
}

export function WorksGrid(props: WorksGridProps): React.JSX.Element {
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
              <div className="h-3 w-4/5 animate-pulse rounded bg-secondary/60" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-secondary/40" />
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
            {props.onlyNew ? '没有未下载的作品' : '还没有作品'}
          </p>
          <p className="text-xs text-muted-foreground">
            {props.onlyNew
              ? '当前结果都已下载过，可关闭筛选查看全部'
              : props.filteredOut > 0
                ? `有 ${props.filteredOut} 个作品被过滤规则排除，可调整规则后查看`
                : '在左侧填写用户 ID 与标签，点击「抓取作品列表」开始'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {props.filteredOut > 0 ? (
            <Button variant="outline" size="sm" onClick={props.onOpenFilter}>
              <Filter />
              调整过滤规则
            </Button>
          ) : null}
          {props.onlyNew ? (
            <button
              type="button"
              onClick={props.onToggleOnlyNew}
              className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              查看全部作品
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
      <div className="flex items-center justify-between gap-2 pb-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          共 <span className="font-medium text-foreground">{props.filteredTotal}</span>
          {props.onlyNew ? ' 个未下载作品' : ' 个作品'}
          {props.total > props.filteredTotal ? `（接口总计 ${props.total}）` : ''}
          {props.filteredOut > 0 ? ` · 规则过滤 ${props.filteredOut}` : ''}
          {props.downloadedCount > 0 ? ` · 已下载 ${props.downloadedCount}` : ''}
          {props.selected.size > 0 ? ` · 已选 ${props.selected.size}` : ''}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={props.onOpenFilter}
            title="过滤规则"
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              props.activeFilterCount > 0
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            过滤
            {props.activeFilterCount > 0 ? (
              <span className="rounded-full bg-primary/20 px-1.5 text-[10px] tabular-nums text-primary">
                {props.activeFilterCount}
              </span>
            ) : null}
          </button>
          <select
            value={props.sort}
            onChange={(event) => props.onSortChange(event.target.value as WorkSort)}
            aria-label="排序方式"
            className="h-6 rounded-md border border-border/60 bg-background px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="default">默认顺序</option>
            <option value="pages-desc">页数最多</option>
            <option value="pages-asc">页数最少</option>
            <option value="date-desc">最新发布</option>
            <option value="date-asc">最早发布</option>
          </select>
          <button
            type="button"
            onClick={props.onExport}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FileDown className="h-3.5 w-3.5" />
            导出
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
            只看未下载
          </button>
          <button
            type="button"
            onClick={props.onToggleAll}
            className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
          >
            {allSelected ? '取消全选' : '全选本页'}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-2">
        <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {props.works.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              selected={props.selected.has(work.id)}
              downloaded={props.downloaded.has(work.id)}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-1 border-t border-border/60 py-3">
        <button
          type="button"
          disabled={!hasPrev}
          aria-label="上一页"
          onClick={() => props.onPageChange(props.page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pageNumbers(props.page, props.pageCount).map((item, index) =>
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
          aria-label="下一页"
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
          {selectedOnPage > 0 ? ` · 本页已选 ${selectedOnPage}` : ''}
        </span>
      </footer>
    </div>
  )
}
