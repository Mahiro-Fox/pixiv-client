import {
  FolderOpen,
  HardDrive,
  Images,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import type { LibraryResult, LibraryWork } from '@shared/types'
import { dirOf, formatBytes, toLocalUrl } from '@renderer/lib/files'
import { useImagePreview } from './ImagePreview'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/field'

const PAGE_SIZE = 48

type LibrarySort = 'updated' | 'files' | 'size' | 'id'

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

function sortWorks(works: LibraryWork[], sort: LibrarySort): LibraryWork[] {
  const list = [...works]
  if (sort === 'files') return list.sort((a, b) => b.pageCount - a.pageCount)
  if (sort === 'size') return list.sort((a, b) => b.totalBytes - a.totalBytes)
  if (sort === 'id') return list.sort((a, b) => a.id.localeCompare(b.id))
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

interface LibraryCardProps {
  work: LibraryWork
  imageCount: number
  onOpen: (work: LibraryWork, index: number) => void
  onOpenDir: (dir: string) => void
}

function LibraryCard({ work, imageCount, onOpen, onOpenDir }: LibraryCardProps): React.JSX.Element {
  const cover = work.cover && work.cover.toLowerCase().endsWith('.zip') ? '' : work.cover

  return (
    <div className="group overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-primary/40">
      <div className="relative aspect-square w-full overflow-hidden bg-secondary/40">
        <button
          type="button"
          onClick={() => imageCount > 0 && onOpen(work, 0)}
          className="block h-full w-full"
          title={imageCount > 0 ? '在应用内预览' : '该作品只有压缩包，无法预览'}
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
              <span className="text-[10px]">压缩包</span>
            </span>
          )}
        </button>
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] tabular-nums text-white backdrop-blur">
          {work.pageCount} 个文件
        </span>
        {work.ugoira ? (
          <Badge className="pointer-events-none absolute right-1.5 top-1.5 bg-amber-500/80 text-white backdrop-blur">
            动图
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenDir(dirOf(work.cover))}
          className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-1 text-white/90 opacity-0 backdrop-blur transition-all hover:bg-black/80 group-hover:opacity-100"
          title="打开所在文件夹"
          aria-label="打开所在文件夹"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1 p-2.5">
        <p className="truncate text-xs font-medium" title={work.title}>
          {work.title}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {work.userName}
          {work.userId ? ` · ${work.userId}` : ''}
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

export function LibraryPanel(): React.JSX.Element {
  const preview = useImagePreview()
  const [data, setData] = useState<LibraryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('all')
  const [sort, setSort] = useState<LibrarySort>('updated')
  const [page, setPage] = useState(1)

  const load = async (force = false): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setData(await window.pixiv.listLibrary(force))
    } catch (reason) {
      setError(messageOf(reason))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    if (!data) return []
    const keyword = query.trim().toLowerCase()
    const list = data.works.filter((work) => {
      if (tag !== 'all' && work.tag !== tag) return false
      if (!keyword) return true
      return (
        work.title.toLowerCase().includes(keyword) ||
        work.userName.toLowerCase().includes(keyword) ||
        work.id.includes(keyword)
      )
    })
    return sortWorks(list, sort)
  }, [data, query, tag, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  )
  const filteredBytes = useMemo(
    () => filtered.reduce((sum, work) => sum + work.totalBytes, 0),
    [filtered]
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const openWork = (work: LibraryWork, start: number): void => {
    const images = work.files
      .filter((file) => file.ext !== '.zip')
      .map((file) => ({ src: toLocalUrl(file.path), alt: `${work.title} p${file.page}` }))
    preview.open(images, start)
  }

  const openDir = (dir: string): void => {
    if (!dir) return
    void window.pixiv.openLibraryDir(dir).catch((reason: unknown) => setError(messageOf(reason)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="搜索标题、作者或作品 ID"
            className="pl-8"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setPage(1)
              }}
              aria-label="清空搜索"
              className="absolute right-2 top-2.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="w-[150px] shrink-0">
          <Select
            value={tag}
            onChange={(value) => {
              setTag(value)
              setPage(1)
            }}
          >
            <option value="all">全部标签</option>
            {(data?.tags ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-[130px] shrink-0">
          <Select value={sort} onChange={(value) => setSort(value as LibrarySort)}>
            <option value="updated">最近更新</option>
            <option value="files">文件数</option>
            <option value="size">占用空间</option>
            <option value="id">作品 ID</option>
          </Select>
        </div>

        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(true)}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          重新扫描
        </Button>
        {data ? (
          <Button variant="ghost" size="sm" onClick={() => openDir(data.outDir)}>
            <FolderOpen />
            打开图库
          </Button>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[11px] text-muted-foreground">
        {data ? (
          <>
            <span>
              {filtered.length === data.works.length
                ? `${data.works.length} 个作品`
                : `${filtered.length} / ${data.works.length} 个作品`}
            </span>
            <span className="tabular-nums">{data.totalFiles} 个文件</span>
            <span className="tabular-nums">共 {formatBytes(filteredBytes)}</span>
            <span className="truncate opacity-70">{data.outDir}</span>
          </>
        ) : null}
        {loading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在扫描保存目录…
          </span>
        ) : null}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-3">
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
            <p className="text-sm font-medium">保存目录里还没有可识别的作品文件</p>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              先抓取并下载一些作品；文件名需符合当前模板（默认 {'{id}_p{page}_{title}{ext}'}）才能被图库识别
            </p>
          </div>
        ) : null}

        {!loading && !error && data && data.works.length > 0 && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            没有匹配的作品，试试更换关键词或标签
          </div>
        ) : null}

        {paged.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {paged.map((work) => (
              <LibraryCard
                key={`${work.tag}-${work.id}`}
                work={work}
                imageCount={work.files.filter((file) => file.ext !== '.zip').length}
                onOpen={openWork}
                onOpenDir={openDir}
              />
            ))}
          </div>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="flex shrink-0 items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <span>
            第 {currentPage} / {pageCount} 页 · 每页 {PAGE_SIZE} 个
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
