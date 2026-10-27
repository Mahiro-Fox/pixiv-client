import {
  ArrowLeft,
  Check,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Images,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LibraryResult, LibraryWork } from '@shared/types'
import { dirOf, formatBytes, toLocalUrl } from '@renderer/lib/files'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useImagePreview } from './ImagePreview'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/field'

/** 能直接交给图片预览的扩展名；动图成品（zip / mp4 / gif）不参与预览 */
const PREVIEW_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
function isPreviewable(ext: string): boolean {
  return PREVIEW_EXTS.has(ext.toLowerCase())
}

/** 卡片之间与网格的间距，虚拟滚动按此推算行高 */
const GAP = 12
/** 卡片最小宽度，决定一排放几个 */
const CARD_MIN = 168
/** 卡片下半部分（标题/ID/统计）的固定高度 */
const TEXT_HEIGHT = 86

type LibrarySort = 'updated' | 'files' | 'size' | 'id'

/** 选择键：同一作品 ID 可能出现在不同标签目录，必须带标签 */
function keyOf(work: LibraryWork): string {
  return `${work.tag}\u0000${work.id}`
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function formatTime(value: number): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** 作品所在目录即作者文件夹 */
function authorPathOf(work: LibraryWork): string {
  return dirOf(work.cover || work.files[0]?.path || '')
}

/** 取路径最后一段作为作者名 */
function dirNameOf(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || dir
}

interface AuthorGroup {
  key: string
  name: string
  works: LibraryWork[]
  files: number
  bytes: number
  updatedAt: number
  cover: string
  tags: string[]
}

/** 按作者目录分组；作者页的排序与统计都在这里一次算好 */
function groupAuthors(works: LibraryWork[]): AuthorGroup[] {
  const map = new Map<string, AuthorGroup>()
  works.forEach((work) => {
    const key = authorPathOf(work)
    const group = map.get(key) ?? {
      key,
      name: dirNameOf(key),
      works: [],
      files: 0,
      bytes: 0,
      updatedAt: 0,
      cover: '',
      tags: []
    }
    group.works.push(work)
    group.files += work.files.length
    group.bytes += work.totalBytes
    group.updatedAt = Math.max(group.updatedAt, work.updatedAt)
    if (!group.cover && work.cover) group.cover = work.cover
    if (!group.tags.includes(work.tag)) group.tags.push(work.tag)
    map.set(key, group)
  })
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function sortWorks(works: LibraryWork[], sort: LibrarySort): LibraryWork[] {
  const list = [...works]
  if (sort === 'files') return list.sort((a, b) => b.files.length - a.files.length)
  if (sort === 'size') return list.sort((a, b) => b.totalBytes - a.totalBytes)
  if (sort === 'id') return list.sort((a, b) => a.id.localeCompare(b.id))
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

interface LibraryCardProps {
  work: LibraryWork
  imageCount: number
  selected: boolean
  onToggleSelect: (shiftKey: boolean) => void
  onOpen: (work: LibraryWork, index: number) => void
  onOpenDir: (dir: string) => void
}

function LibraryCard({
  work,
  imageCount,
  selected,
  onToggleSelect,
  onOpen,
  onOpenDir
}: LibraryCardProps): React.JSX.Element {
  const { t } = useI18n()
  const cover = work.cover

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-xl border bg-card transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border/60 hover:border-primary/40'
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-secondary/40">
        <button
          type="button"
          onClick={() => imageCount > 0 && onOpen(work, 0)}
          className="block h-full w-full"
          title={imageCount > 0 ? t('library.previewInApp') : t('library.noPreviewUgoira')}
        >
          {cover ? (
            <img
              src={toLocalUrl(cover)}
              alt={work.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <HardDrive className="h-6 w-6" />
              <span className="text-[10px]">{t('library.ugoiraFile')}</span>
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelect(event.shiftKey)
          }}
          aria-label={selected ? t('library.deselect') : t('library.selectWork')}
          title={t('library.selectHint')}
          className={cn(
            'absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border backdrop-blur transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-white/60 bg-black/40 text-transparent hover:bg-black/60'
          )}
        >
          <Check className="h-3 w-3" />
        </button>

        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white backdrop-blur">
          {t('library.fileCount', { count: work.files.length })}
        </span>
        {work.ugoira ? (
          <Badge className="pointer-events-none absolute right-1.5 top-1.5 bg-amber-500/80 text-white backdrop-blur">
            {t('library.ugoira')}
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenDir(authorPathOf(work))}
          className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-1 text-white/90 opacity-0 backdrop-blur transition-all hover:bg-black/80 group-hover:opacity-100"
          title={t('library.openFolder')}
          aria-label={t('library.openFolder')}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1 p-2.5">
        <p className="truncate text-xs font-medium" title={work.title}>
          {work.title}
        </p>
        <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground" title={work.id}>
          #{work.id}
        </p>
        <div className="flex items-center justify-between pt-0.5 text-[10px] text-muted-foreground/70">
          <span className="truncate">{work.tag}</span>
          <span className="shrink-0 tabular-nums">{formatBytes(work.totalBytes)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/60 tabular-nums">
          {formatTime(work.updatedAt)}
        </p>
      </div>
    </div>
  )
}

interface AuthorCardProps {
  group: AuthorGroup
  onOpen: (key: string) => void
}

function AuthorCard({ group, onOpen }: AuthorCardProps): React.JSX.Element {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => onOpen(group.key)}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/40">
        {group.cover ? (
          <img
            src={toLocalUrl(group.cover)}
            alt={group.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Users className="h-5 w-5" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium" title={group.name}>
          {group.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t('library.authorStat', {
            works: group.works.length,
            files: group.files,
            bytes: formatBytes(group.bytes)
          })}
        </p>
        <p className="truncate text-[10px] text-muted-foreground/60">
          {group.tags.slice(0, 2).join(' / ')}
          {group.tags.length > 2 ? ' …' : ''}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  )
}

export function LibraryPanel(): React.JSX.Element {
  const { t } = useI18n()
  const preview = useImagePreview()
  const [data, setData] = useState<LibraryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState<LibrarySort>('updated')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** 当前查看的作者目录；null 表示停留在作者列表 */
  const [authorKey, setAuthorKey] = useState<string | null>(null)

  const anchorRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  const load = async (force = false, silent = false): Promise<void> => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const result = await window.pixiv.listLibrary(force)
      setData(result)
      // 文件可能已在外部变化，选中项只在仍然存在的作品里保留
      const alive = new Set(result.works.map((work) => keyOf(work)))
      setSelected((previous) => new Set([...previous].filter((key) => alive.has(key))))
    } catch (reason) {
      setError(messageOf(reason))
      setData(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // 保存目录被外部增删文件时静默刷新，不必手动点「重新扫描」
  useEffect(() => {
    let timer: number | null = null
    const off = window.pixiv.onLibraryChanged(() => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void load(true, true)
      }, 400)
    })
    return () => {
      off()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const authors = useMemo(() => groupAuthors(data?.works ?? []), [data])
  const currentAuthor = useMemo(
    () => (authorKey ? authors.find((group) => group.key === authorKey) ?? null : null),
    [authors, authorKey]
  )

  // 删除或外部变更后作者目录可能整个消失，自动退回作者列表
  useEffect(() => {
    if (authorKey && data && !currentAuthor) setAuthorKey(null)
  }, [authorKey, data, currentAuthor])

  const authorTags = useMemo(
    () => (currentAuthor ? currentAuthor.tags : []),
    [currentAuthor]
  )

  // 标签筛选只针对当前作者，切作者时重置为全部
  useEffect(() => {
    if (tag !== 'all' && !authorTags.includes(tag)) setTag('all')
  }, [tag, authorTags])

  const filtered = useMemo(() => {
    if (!currentAuthor) return []
    const keyword = query.trim().toLowerCase()
    const list = currentAuthor.works.filter((work) => {
      if (tag !== 'all' && work.tag !== tag) return false
      if (!keyword) return true
      // 作者名不参与搜索：作者已在列表页按文件夹区分
      return work.title.toLowerCase().includes(keyword) || work.id.includes(keyword)
    })
    return sortWorks(list, sort)
  }, [currentAuthor, query, tag, sort])

  const filteredBytes = useMemo(
    () => filtered.reduce((sum, work) => sum + work.totalBytes, 0),
    [filtered]
  )

  const selectedWorks = useMemo(
    () => filtered.filter((work) => selected.has(keyOf(work))),
    [filtered, selected]
  )

  // 容器宽度变化时重新计算列数，虚拟滚动的行高随之变化
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = (): void => setGridWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [authorKey])

  const columns = Math.max(1, Math.floor((gridWidth + GAP) / (CARD_MIN + GAP)))
  const cardWidth = Math.max(1, (gridWidth - GAP * (columns - 1)) / columns)
  const rowHeight = Math.round(cardWidth + TEXT_HEIGHT + GAP)
  const rowCount = Math.ceil(filtered.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  })

  // 列数或尺寸变化后丢弃旧的测量值
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, columns, virtualizer])

  // 条件变化后回到列表顶部，避免停在旧滚动位置看到空白
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [query, tag, sort, authorKey])

  // 选择只针对当前可见结果，筛选变化后丢弃已隐藏的选中项，删除范围与界面一致
  useEffect(() => {
    setSelected((previous) => {
      if (previous.size === 0) return previous
      const visible = new Set(filtered.map(keyOf))
      const next = new Set([...previous].filter((key) => visible.has(key)))
      return next.size === previous.size ? previous : next
    })
  }, [filtered])

  // 进入另一个作者时清空选择与标签筛选，避免把上一个作者的作品带进批量操作
  useEffect(() => {
    setSelected(new Set())
    setTag('all')
    setConfirmingDelete(false)
    anchorRef.current = null
  }, [authorKey])

  const toggleSelect = (index: number, shiftKey: boolean): void => {
    const target = filtered[index]
    if (!target) return
    const key = keyOf(target)
    const anchor = anchorRef.current

    setSelected((previous) => {
      const next = new Set(previous)
      if (shiftKey && anchor !== null && anchor !== index) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
        // Shift 连选：以锚点的选择状态决定这一整段是选中还是取消
        const shouldSelect = !previous.has(key)
        for (let cursor = from; cursor <= to; cursor += 1) {
          const item = filtered[cursor]
          if (!item) continue
          if (shouldSelect) next.add(keyOf(item))
          else next.delete(keyOf(item))
        }
      } else if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    setConfirmingDelete(false)
    anchorRef.current = index
  }

  const toggleSelectAll = (): void => {
    setConfirmingDelete(false)
    setSelected((previous) => {
      if (previous.size >= filtered.length) return new Set()
      return new Set(filtered.map((work) => keyOf(work)))
    })
    anchorRef.current = null
  }

  const openWork = (work: LibraryWork, start: number): void => {
    const images = work.files
      .filter((file) => isPreviewable(file.ext))
      .map((file) => ({ src: toLocalUrl(file.path), alt: `${work.title} p${file.page}` }))
    preview.open(images, start)
  }

  const openDir = (dir: string): void => {
    if (!dir) return
    void window.pixiv.openLibraryDir(dir).catch((reason: unknown) => setError(messageOf(reason)))
  }

  /** 批量打开目录：同一作者目录只打开一次 */
  const openSelectedDirs = (): void => {
    const dirs = new Set<string>()
    selectedWorks.forEach((work) => {
      const dir = authorPathOf(work)
      if (dir) dirs.add(dir)
    })
    void Promise.all(
      [...dirs].map((dir) => window.pixiv.openLibraryDir(dir).catch(() => undefined))
    )
  }

  const deleteSelected = async (): Promise<void> => {
    if (selectedWorks.length === 0) return
    setDeleting(true)
    setError('')
    try {
      const paths = selectedWorks.flatMap((work) => work.files.map((file) => file.path))
      const result = await window.pixiv.deleteLibraryFiles(paths)
      setData(result)
      setSelected(new Set())
      setConfirmingDelete(false)
      anchorRef.current = null
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        {currentAuthor ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setAuthorKey(null)}>
              <ArrowLeft />
              {t('library.allAuthors')}
            </Button>
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('library.searchPlaceholder')}
                className="pl-8"
                spellCheck={false}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('library.clearSearch')}
                  className="absolute right-2 top-2.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="w-[130px] shrink-0">
              <Select value={tag} onChange={(value) => setTag(value)}>
                <option value="all">{t('library.allTags')}</option>
                {authorTags.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-[130px] shrink-0">
              <Select value={sort} onChange={(value) => setSort(value as LibrarySort)}>
                <option value="updated">{t('library.sortUpdated')}</option>
                <option value="files">{t('library.sortFiles')}</option>
                <option value="size">{t('library.sortSize')}</option>
                <option value="id">{t('library.sortId')}</option>
              </Select>
            </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-medium">{t('library.authors')}</span>
            <span className="text-[11px] text-muted-foreground">
              {t('library.authorsHint', { count: authors.length })}
            </span>
          </div>
        )}

        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t('library.rescan')}
        </Button>
        {data ? (
          <Button variant="ghost" size="sm" onClick={() => openDir(data.outDir)}>
            <FolderOpen />
            {t('library.openLibrary')}
          </Button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[11px] text-muted-foreground">
        {data ? (
          <>
            {currentAuthor ? (
              <>
                <span className="truncate font-medium text-foreground/80">{currentAuthor.name}</span>
                <span>
                  {filtered.length === currentAuthor.works.length
                    ? t('library.workCount', { count: currentAuthor.works.length })
                    : t('library.workCountFiltered', {
                        shown: filtered.length,
                        total: currentAuthor.works.length
                      })}
                </span>
                <span className="tabular-nums">
                  {t('library.fileCount', {
                    count: filtered.reduce((sum, work) => sum + work.files.length, 0)
                  })}
                </span>
              </>
            ) : (
              <>
                <span>{t('library.authorCount', { count: authors.length })}</span>
                <span>{t('library.workCount', { count: data.works.length })}</span>
                <span className="tabular-nums">
                  {t('library.fileCount', { count: data.totalFiles })}
                </span>
              </>
            )}
            <span className="tabular-nums">
              {t('library.totalSize', {
                size: formatBytes(currentAuthor ? filteredBytes : data.totalBytes)
              })}
            </span>
            <span className="truncate opacity-70">{data.outDir}</span>
          </>
        ) : null}
        {loading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('library.scanning')}
          </span>
        ) : null}
      </div>

      {/* 批量操作栏：有选中项时常驻，避免选中后还要滚动找按钮 */}
      {currentAuthor && selected.size > 0 ? (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-[11px]">
          <span className="font-medium text-primary">
            {t('library.selectedWorks', { count: selectedWorks.length })}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatBytes(selectedWorks.reduce((sum, work) => sum + work.totalBytes, 0))}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
              {selected.size >= filtered.length && filtered.length > 0
                ? t('library.deselectAll')
                : t('library.selectAll')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('library.clearSelection')}
            </Button>
            <Button variant="outline" size="sm" onClick={openSelectedDirs}>
              <FolderOpen />
              {t('library.openDir')}
            </Button>
            {confirmingDelete ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void deleteSelected()}
                >
                  {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {t('library.confirmDelete', {
                    count: selectedWorks.reduce((sum, work) => sum + work.files.length, 0)
                  })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  {t('library.cancel')}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 />
                {t('library.deleteFiles')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-3">
        {error ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
            <p className="flex-1 break-all leading-5">{error}</p>
          </div>
        ) : null}

        {!loading && !error && data && data.works.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
              <Images className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">{t('library.empty')}</p>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              {t('library.emptyHint', { template: '{id}_p{page}_{title}{ext}' })}
            </p>
          </div>
        ) : null}

        {/* 作者列表：按保存目录里的作者文件夹展示 */}
        {!currentAuthor && !loading && !error && authors.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {authors.map((group) => (
              <AuthorCard key={group.key} group={group} onOpen={setAuthorKey} />
            ))}
          </div>
        ) : null}

        {currentAuthor && !loading && !error && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            {t('library.noMatch')}
          </div>
        ) : null}

        {currentAuthor && filtered.length > 0 ? (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const start = virtualRow.index * columns
              const rowWorks = filtered.slice(start, start + columns)
              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-0 top-0 grid w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    gap: GAP,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
                  }}
                >
                  {rowWorks.map((work, offset) => {
                    const index = start + offset
                    return (
                      <LibraryCard
                        key={keyOf(work)}
                        work={work}
                        imageCount={work.files.filter((file) => isPreviewable(file.ext)).length}
                        selected={selected.has(keyOf(work))}
                        onToggleSelect={(shiftKey) => toggleSelect(index, shiftKey)}
                        onOpen={openWork}
                        onOpenDir={openDir}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
