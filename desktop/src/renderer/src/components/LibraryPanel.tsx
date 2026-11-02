import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  ImageOff,
  Images,
  Loader2,
  PlayCircle,
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
import { useNavigate } from 'react-router-dom'
import type {
  LibraryResult,
  LibraryWork,
  NovelLibraryItem,
  NovelTextSearchResult
} from '@shared/types'
import type { LocalContent } from '@shared/layout'
import { dirOf, formatBytes, toLocalUrl } from '@renderer/lib/files'
import { cn } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { useImagePreview } from './ImagePreview'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'

/** 能直接交给图片预览的扩展名；动图成品另走 openUgoira */
const PREVIEW_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
function isPreviewable(ext: string): boolean {
  return PREVIEW_EXTS.has(ext.toLowerCase())
}

/** 本地动图成品：mp4 / webm 走 <video>，其余交给 <img> 或播放器 */
const UGOIRA_VIDEO_EXTS = new Set(['.mp4', '.webm'])
/**
 * 同一件作品残留多种成品时的取用顺序：
 * zip 里是原始帧（时长最准、画质无损），其次视频，最后 gif。
 */
const UGOIRA_PRIORITY = ['.zip', '.mp4', '.webm', '.gif'] as const

/** 找到一件动图作品里真正能播的那个文件 */
function ugoiraFileOf(work: LibraryWork): { path: string; ext: string } | null {
  for (const ext of UGOIRA_PRIORITY) {
    const file = work.files.find((item) => item.ext.toLowerCase() === ext)
    if (file) return { path: file.path, ext }
  }
  return null
}

/** 卡片之间与网格的间距，虚拟滚动按此推算行高 */
const GAP = 12
/** 卡片最小宽度，决定一排放几个 */
const CARD_MIN = 168
/** 卡片下半部分（标题/ID/统计）的固定高度 */
const TEXT_HEIGHT = 86

type LibrarySort = 'updated' | 'files' | 'size' | 'id'

/** 选择键：同一作品在插画 / 漫画目录下是两条记录，必须带内容类型 */
function keyOf(work: LibraryWork): string {
  return `${work.content}\u0000${work.id}`
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

/** 作品所在目录：{作者目录}/{illustration|manga} */
function workDirOf(work: LibraryWork): string {
  return dirOf(work.cover || work.files[0]?.path || '')
}

interface AuthorGroup {
  /** 作者目录绝对路径，同时作为分组键 */
  key: string
  userId: string
  userName: string
  illustration: LibraryWork[]
  manga: LibraryWork[]
  novels: NovelLibraryItem[]
  files: number
  bytes: number
  updatedAt: number
  cover: string
}

/**
 * 按作者目录把插画 / 漫画 / 小说归到一起。
 * 三类内容共用 `{作者ID}_{作者名}` 这一层目录，图库才能先选作者再选栏目。
 */
function groupAuthors(works: LibraryWork[], novels: NovelLibraryItem[]): AuthorGroup[] {
  const map = new Map<string, AuthorGroup>()
  const ensure = (key: string, userId: string, userName: string): AuthorGroup => {
    const group = map.get(key) ?? {
      key,
      userId,
      userName,
      illustration: [],
      manga: [],
      novels: [],
      files: 0,
      bytes: 0,
      updatedAt: 0,
      cover: ''
    }
    if (!group.userId) group.userId = userId
    if (!group.userName) group.userName = userName
    map.set(key, group)
    return group
  }

  works.forEach((work) => {
    const group = ensure(work.authorPath, work.userId, work.userName)
    if (work.content === 'manga') group.manga.push(work)
    else group.illustration.push(work)
    group.files += work.files.length
    group.bytes += work.totalBytes
    group.updatedAt = Math.max(group.updatedAt, work.updatedAt)
    if (!group.cover && work.cover) group.cover = work.cover
  })

  novels.forEach((novel) => {
    const group = ensure(novel.authorPath, novel.userId, novel.author)
    group.novels.push(novel)
    group.files += 1
    group.bytes += novel.size
    group.updatedAt = Math.max(group.updatedAt, Date.parse(novel.updatedAt) || 0)
  })

  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 动图作品的封面。
 *
 * 扫描时只有静态图才会被当成封面，动图成品（zip / mp4 / gif）没有封面可用，
 * 卡片上就只剩一个播放图标。这里向主进程要首帧缩略图：主进程解出第一帧并缓存到
 * userData，渲染层拿到的只是一个图片路径，图库滚动时不会有多个解码器在跑。
 * 取不到（成品损坏、ffmpeg 缺失）时返回空串，卡片继续显示占位图标。
 */
function useUgoiraCover(work: LibraryWork | null): string {
  const fallback = work?.cover || ''
  const source = work && work.ugoira && !fallback ? ugoiraFileOf(work)?.path || '' : ''
  const [generated, setGenerated] = useState<{ source: string; path: string } | null>(null)

  useEffect(() => {
    if (!source) return
    let alive = true
    void window.pixiv
      .getUgoiraCover(source)
      .then((path) => {
        if (alive && path) setGenerated({ source, path })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [source])

  // 记住了来源路径：换作品（虚拟列表复用）时不会拿上一件的图顶上
  return fallback || (generated && generated.source === source ? generated.path : '')
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
  // 动图作品没有静态封面，退回它的首帧缩略图
  const cover = useUgoiraCover(work)

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
          onClick={() => (imageCount > 0 || work.ugoira) && onOpen(work, 0)}
          className="block h-full w-full"
          title={
            work.ugoira
              ? t('library.playUgoira')
              : imageCount > 0
                ? t('library.previewInApp')
                : t('library.noPreviewUgoira')
          }
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
              {work.ugoira ? (
                <PlayCircle className="h-7 w-7 transition-colors group-hover:text-primary" />
              ) : (
                <HardDrive className="h-6 w-6" />
              )}
              <span className="text-[10px]">
                {work.ugoira ? t('library.playUgoira') : t('library.ugoiraFile')}
              </span>
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
          <Check className="h-4 w-4" />
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
          onClick={() => onOpenDir(workDirOf(work))}
          className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-1 text-white/90 opacity-0 backdrop-blur transition-all hover:bg-black/80 group-hover:opacity-100"
          title={t('library.openFolder')}
          aria-label={t('library.openFolder')}
        >
          <FolderOpen className="h-4 w-4" />
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
          <span className="truncate">
            {work.content === 'manga' ? t('library.tabManga') : t('library.tabIllustration')}
          </span>
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
  // 这位作者只有动图作品时分组封面为空，用第一件作品的首帧顶上
  const first = group.illustration[0] ?? group.manga[0] ?? null
  const ugoiraCover = useUgoiraCover(group.cover ? null : first)
  const cover = group.cover || ugoiraCover
  return (
    <button
      type="button"
      onClick={() => onOpen(group.key)}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/40">
        {cover ? (
          <img
            src={toLocalUrl(cover)}
            alt={group.userName}
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
        <p className="truncate text-sm font-medium" title={`${group.userId}_${group.userName}`}>
          {group.userId ? `${group.userName} (${group.userId})` : group.userName}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t('library.authorTypes', {
            illustration: group.illustration.length,
            manga: group.manga.length,
            novel: group.novels.length
          })}
        </p>
        <p className="truncate text-[10px] text-muted-foreground/60">
          {t('library.authorStat', {
            works: group.illustration.length + group.manga.length,
            files: group.files,
            bytes: formatBytes(group.bytes)
          })}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  )
}

/** 小说卡片：封面 + 标题 + 字数 + 话数，点击进本地阅读器 */
function NovelCard(props: {
  item: NovelLibraryItem
  onOpen: (item: NovelLibraryItem) => void
  onOpenDir: (dir: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { item } = props
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => props.onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen(item)
        }
      }}
      className="group flex cursor-pointer gap-3 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/70"
    >
      <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
        {item.cover ? (
          <img
            src={item.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 flex-1 text-xs font-medium leading-5">{item.title}</h3>
          <span className="shrink-0 rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {item.kind === 'series' ? t('novel.series') : t('novelLib.oneshot')}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">{item.author}</p>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {item.characters > 0 ? <span>{t('novel.chars', { count: item.characters })}</span> : null}
          {item.episodes > 1 ? <span>{t('novel.episodes', { count: item.episodes })}</span> : null}
          <span>{item.updatedAt.slice(0, 10)}</span>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              props.onOpenDir(dirOf(item.path))
            }}
          >
            <FolderOpen />
            {t('novel.openDir')}
          </Button>
        </div>
      </div>
    </article>
  )
}

/** 全文检索结果：标题 + 作者 + 命中片段 */
function NovelHitCard(props: {
  hit: NovelTextSearchResult['hits'][number]
  onOpen: (hit: NovelTextSearchResult['hits'][number]) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => props.onOpen(props.hit)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen(props.hit)
        }
      }}
      className="cursor-pointer rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border hover:bg-card/70"
    >
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{props.hit.title}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{props.hit.author}</span>
        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
          {t('novelLib.matches', { count: props.hit.matches })}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {props.hit.snippets.map((snippet, index) => (
          <p key={index} className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">
            {snippet}
          </p>
        ))}
      </div>
    </article>
  )
}

export function LibraryPanel(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const preview = useImagePreview()
  const [data, setData] = useState<LibraryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('updated')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** 当前查看的作者目录；null 表示停留在作者列表 */
  const [authorKey, setAuthorKey] = useState<string | null>(null)
  /** 作者页的栏目：插画 / 漫画 / 小说 */
  const [tab, setTab] = useState<LocalContent>('illustration')
  /** 小说栏目：是否在全库正文里做全文检索 */
  const [deep, setDeep] = useState(false)
  const [deepResult, setDeepResult] = useState<NovelTextSearchResult | null>(null)
  const [deepSearching, setDeepSearching] = useState(false)

  const anchorRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [gridWidth, setGridWidth] = useState(0)

  /**
   * 本地视频预览的 blob 地址。
   * 换了下一个视频 / 关掉页面都要 revoke，否则整段 mp4 会一直留在内存里。
   */
  const videoUrlRef = useRef<string | null>(null)
  const revokeVideoUrl = (): void => {
    if (!videoUrlRef.current) return
    URL.revokeObjectURL(videoUrlRef.current)
    videoUrlRef.current = null
  }
  useEffect(() => revokeVideoUrl, [])

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

  const authors = useMemo(
    () => groupAuthors(data?.works ?? [], data?.novels ?? []),
    [data]
  )
  const currentAuthor = useMemo(
    () => (authorKey ? authors.find((group) => group.key === authorKey) ?? null : null),
    [authors, authorKey]
  )

  // 删除或外部变更后作者目录可能整个消失，自动退回作者列表
  useEffect(() => {
    if (authorKey && data && !currentAuthor) setAuthorKey(null)
  }, [authorKey, data, currentAuthor])

  /**
   * 进入作者：清掉上一位作者的筛选与选择，并落在第一个有内容的栏目。
   * 只由「点击作者」触发——用作者对象做依赖的话，外部文件变动导致重新扫描时
   * 也会把当前栏目和搜索词重置掉。
   */
  const openAuthor = (key: string): void => {
    const group = authors.find((item) => item.key === key)
    setSelected(new Set())
    setConfirmingDelete(false)
    setDeep(false)
    setDeepResult(null)
    setQuery('')
    anchorRef.current = null
    if (group) {
      if (group.illustration.length > 0) setTab('illustration')
      else if (group.manga.length > 0) setTab('manga')
      else setTab('novel')
    }
    setAuthorKey(key)
  }

  const currentWorks = useMemo(() => {
    if (!currentAuthor) return []
    return tab === 'manga' ? currentAuthor.manga : currentAuthor.illustration
  }, [currentAuthor, tab])

  const filtered = useMemo(() => {
    if (tab === 'novel') return []
    const keyword = query.trim().toLowerCase()
    const list = currentWorks.filter((work) => {
      if (!keyword) return true
      // 作者名不参与搜索：作者已在列表页按文件夹区分
      return work.title.toLowerCase().includes(keyword) || work.id.includes(keyword)
    })
    return sortWorks(list, sort)
  }, [currentWorks, query, sort, tab])

  const filteredNovels = useMemo(() => {
    if (!currentAuthor) return []
    const keyword = query.trim().toLowerCase()
    const list = keyword
      ? currentAuthor.novels.filter((item) => item.title.toLowerCase().includes(keyword))
      : currentAuthor.novels
    return [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [currentAuthor, query])

  // 全文检索：输入停顿 350ms 后再发起，避免逐字打盘
  useEffect(() => {
    const word = query.trim()
    if (tab !== 'novel' || !deep || !word) {
      setDeepResult(null)
      setDeepSearching(false)
      return
    }
    let alive = true
    setDeepSearching(true)
    const timer = window.setTimeout(() => {
      void window.pixiv
        .searchNovelLibrary(word)
        .then((result) => {
          if (alive) setDeepResult(result)
        })
        .catch((reason: unknown) => {
          if (alive) {
            setDeepResult(null)
            setError(messageOf(reason))
          }
        })
        .finally(() => {
          if (alive) setDeepSearching(false)
        })
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [tab, deep, query])

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
  }, [authorKey, tab])

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
  }, [query, sort, authorKey, tab])

  // 选择只针对当前可见结果，筛选变化后丢弃已隐藏的选中项，删除范围与界面一致
  useEffect(() => {
    setSelected((previous) => {
      if (previous.size === 0) return previous
      const visible = new Set(filtered.map(keyOf))
      const next = new Set([...previous].filter((key) => visible.has(key)))
      return next.size === previous.size ? previous : next
    })
  }, [filtered])

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

  /**
   * 打开一件动图作品。
   *
   * 三种成品分开走：zip 交给播放器现解帧（每帧时长按作品 ID 找线上元数据），
   * mp4 / webm 读成 blob 交给 <video>（自定义协议对 Range 支持不稳），
   * gif 直接丢给 <img>，浏览器自己就会循环播。
   */
  const openUgoira = async (work: LibraryWork): Promise<void> => {
    const file = ugoiraFileOf(work)
    if (!file) return
    const alt = `${work.title} · ${t('library.ugoira')}`

    if (file.ext === '.zip') {
      preview.open([{ src: '', alt, ugoira: { kind: 'local', path: file.path, id: work.id } }])
      return
    }

    if (UGOIRA_VIDEO_EXTS.has(file.ext)) {
      try {
        const media = await window.pixiv.readLocalMedia(file.path)
        revokeVideoUrl()
        videoUrlRef.current = URL.createObjectURL(
          new Blob([media.bytes as unknown as BlobPart], { type: media.mime })
        )
        preview.open([{ src: '', alt, video: videoUrlRef.current }])
      } catch (reason) {
        setError(messageOf(reason))
      }
      return
    }

    preview.open([{ src: toLocalUrl(file.path), alt }])
  }

  const openWork = (work: LibraryWork, start: number): void => {
    // 动图作品没有可分页的静态图，交给专门的播放分支；
    // 历史索引里标了动图但成品已被删掉时，退回按普通图片预览
    if (work.ugoira && ugoiraFileOf(work)) {
      void openUgoira(work)
      return
    }
    const images = work.files
      .filter((file) => isPreviewable(file.ext))
      .map((file) => ({ src: toLocalUrl(file.path), alt: `${work.title} p${file.page}` }))
    preview.open(images, start)
  }

  const openDir = (dir: string): void => {
    if (!dir) return
    void window.pixiv.openLibraryDir(dir).catch((reason: unknown) => setError(messageOf(reason)))
  }

  const openNovel = (item: { path: string; title: string; author: string }): void => {
    const params = new URLSearchParams({
      path: item.path,
      title: item.title,
      author: item.author
    })
    navigate(`/novel/local?${params.toString()}`)
  }

  /** 批量打开目录：同一作者目录只打开一次 */
  const openSelectedDirs = (): void => {
    const dirs = new Set<string>()
    selectedWorks.forEach((work) => {
      const dir = workDirOf(work)
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

  const tabs: { value: LocalContent; label: string; count: number }[] = currentAuthor
    ? [
        {
          value: 'illustration',
          label: t('library.tabIllustration'),
          count: currentAuthor.illustration.length
        },
        { value: 'manga', label: t('library.tabManga'), count: currentAuthor.manga.length },
        { value: 'novel', label: t('library.tabNovel'), count: currentAuthor.novels.length }
      ]
    : []

  const searchingText = tab === 'novel' && deep && query.trim().length > 0

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
                placeholder={
                  tab === 'novel'
                    ? deep
                      ? t('novelLib.searchPlaceholder')
                      : t('library.novelSearchPlaceholder')
                    : t('library.searchPlaceholder')
                }
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

            {tab === 'novel' ? (
              <Button
                variant={deep ? 'default' : 'outline'}
                size="sm"
                title={t('library.deepSearchHint')}
                onClick={() => setDeep((value) => !value)}
              >
                <FileText />
                {t('library.deepSearch')}
              </Button>
            ) : (
              <div className="w-[130px] shrink-0">
                <Select
                  value={sort}
                  onChange={(value) => setSort(value as LibrarySort)}
                  options={[
                    { value: 'updated', label: t('library.sortUpdated') },
                    { value: 'files', label: t('library.sortFiles') },
                    { value: 'size', label: t('library.sortSize') },
                    { value: 'id', label: t('library.sortId') }
                  ]}
                />
              </div>
            )}

            <Button variant="ghost" size="sm" onClick={() => openDir(currentAuthor.key)}>
              <FolderOpen />
              {t('library.openAuthorDir')}
            </Button>
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

      {/* 栏目：插画 / 漫画 / 小说；空栏目也可点，只是列表为空 */}
      {currentAuthor ? (
        <div className="mb-2 flex shrink-0 items-center gap-1 self-start rounded-lg bg-secondary/50 p-1">
          {tabs.map((item) => {
            const active = tab === item.value
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setTab(item.value)
                  setQuery('')
                  setSelected(new Set())
                  setConfirmingDelete(false)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
                <span className="tabular-nums opacity-70">{item.count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[11px] text-muted-foreground">
        {data ? (
          <>
            {currentAuthor ? (
              <>
                <span className="truncate font-medium text-foreground/80">
                  {currentAuthor.userId
                    ? `${currentAuthor.userName} (${currentAuthor.userId})`
                    : currentAuthor.userName}
                </span>
                {tab === 'novel' ? (
                  <span>{t('library.novelCount', { count: filteredNovels.length })}</span>
                ) : (
                  <span>
                    {filtered.length === currentWorks.length
                      ? t('library.workCount', { count: currentWorks.length })
                      : t('library.workCountFiltered', {
                          shown: filtered.length,
                          total: currentWorks.length
                        })}
                  </span>
                )}
                <span className="tabular-nums">
                  {t('library.fileCount', {
                    count:
                      tab === 'novel'
                        ? filteredNovels.length
                        : filtered.reduce((sum, work) => sum + work.files.length, 0)
                  })}
                </span>
                <span className="tabular-nums">
                  {t('library.totalSize', {
                    size: formatBytes(
                      tab === 'novel'
                        ? filteredNovels.reduce((sum, item) => sum + item.size, 0)
                        : filteredBytes
                    )
                  })}
                </span>
              </>
            ) : (
              <>
                <span>{t('library.authorCount', { count: authors.length })}</span>
                <span>{t('library.workCount', { count: data.works.length })}</span>
                <span>{t('library.novelCount', { count: data.novels.length })}</span>
                <span className="tabular-nums">
                  {t('library.fileCount', { count: data.totalFiles })}
                </span>
                <span className="tabular-nums">
                  {t('library.totalSize', { size: formatBytes(data.totalBytes) })}
                </span>
              </>
            )}
            <span className="truncate opacity-70">{data.outDir}</span>
          </>
        ) : null}
        {loading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('library.scanning')}
          </span>
        ) : null}
      </div>

      {/* 批量操作栏：有选中项时常驻，避免选中后还要滚动找按钮 */}
      {currentAuthor && tab !== 'novel' && selected.size > 0 ? (
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

        {!loading && !error && data && data.works.length === 0 && data.novels.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
              <Images className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">{t('library.empty')}</p>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              {t('library.emptyHint')}
            </p>
          </div>
        ) : null}

        {/* 作者列表：按保存目录里的作者文件夹展示 */}
        {!currentAuthor && !loading && !error && authors.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {authors.map((group) => (
              <AuthorCard key={group.key} group={group} onOpen={openAuthor} />
            ))}
          </div>
        ) : null}

        {/* 小说栏目：默认列该作者的小说，开启全文检索后列全库命中 */}
        {currentAuthor && tab === 'novel' ? (
          <div className="space-y-2">
            {searchingText ? (
              <p className="text-[11px] text-muted-foreground">
                {deepSearching
                  ? t('novelLib.searching')
                  : deepResult
                    ? t('novelLib.hitCount', {
                        count: deepResult.hits.length,
                        scanned: deepResult.scanned
                      })
                    : ''}
              </p>
            ) : null}

            {searchingText ? (
              deepResult && deepResult.hits.length > 0 ? (
                deepResult.hits.map((hit) => (
                  <NovelHitCard key={hit.path} hit={hit} onOpen={openNovel} />
                ))
              ) : !deepSearching && deepResult ? (
                <div className="flex h-42 items-center justify-center text-sm text-muted-foreground">
                  {t('novelLib.noHit')}
                </div>
              ) : null
            ) : filteredNovels.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {filteredNovels.map((item) => (
                  <NovelCard
                    key={item.path}
                    item={item}
                    onOpen={openNovel}
                    onOpenDir={openDir}
                  />
                ))}
              </div>
            ) : currentAuthor.novels.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
                <BookOpen className="h-5 w-5" />
                {t('library.novelEmpty')}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
                <Sparkles className="h-5 w-5" />
                {t('library.noMatch')}
              </div>
            )}
          </div>
        ) : null}

        {currentAuthor && tab !== 'novel' && !loading && !error && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            {t('library.noMatch')}
          </div>
        ) : null}

        {currentAuthor && tab !== 'novel' && filtered.length > 0 ? (
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
