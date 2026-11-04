import { Bookmark, Check, ExternalLink, ImageOff } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SearchWork } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { useWorkContextMenu } from '@renderer/hooks/useCardMenu'
import { useFilteredWorks } from '@renderer/hooks/useFilterContext'
import { openPreview } from '@renderer/hooks/useWorkPreview'
import { cn } from '@renderer/utils/ui'
import { AuthorPopover } from './AuthorPopover'
import { FilteredHint } from './FilteredHint'
import { Badge } from './ui/badge'

/**
 * 一张作品卡需要的最小字段。
 *
 * 搜索结果（`thumbnail`）、工作台作品（`url`）、浏览记录 / 稍后看（`thumbnail`）
 * 都能直接喂进来，页面不必各自搭一套卡片骨架。
 */
export interface WorkCardData {
  id: string
  title: string
  /** 列表缩略图（约 250px） */
  thumbnail?: string
  /** 工作台的 PixivWork 用 url 装同一张图 */
  url?: string
  userId?: string
  userName?: string
  /** 作者头像；没有时作者行显示占位圆点 */
  profileImageUrl?: string
  pageCount?: number
  /** 传数字才显示收藏数，本地记录类列表没有这个字段 */
  bookmarkCount?: number
  xRestrict?: number
  illustType?: number
  aiType?: number
  /** 排行榜名次 */
  rank?: number
}

export interface WorkCardProps {
  work: WorkCardData
  /** 在当前列表里的序号：用来做入场错峰，避免上百张卡片同时放大招 */
  index?: number
  /** 点卡片打开作品（预览弹窗 / 详情）。与 onToggle 同时传时，整卡点击优先走 onToggle */
  onOpen?: () => void
  /** 整卡点击切换选中：工作台的多选卡片 */
  onToggle?: () => void
  selected?: boolean
  downloaded?: boolean
  /** 封面左上角追加角标（如系列话序号） */
  badge?: React.ReactNode
  /** 封面右上角操作按钮（去 pixiv / 移出稍后看），样式由调用方给 */
  action?: React.ReactNode
  /** 标题下方追加一行（浏览时间等） */
  meta?: React.ReactNode
  /** 作者行右侧的操作（工作台的「详情」）；不传时按收藏数占位 */
  footerAction?: React.ReactNode
  /** 作者名悬停弹出资料卡：搜索类列表用，本地记录列表保持纯文本 */
  authorHover?: boolean
  showAuthor?: boolean
  /** 封面右上角的「在 pixiv 打开」图标（搜索类列表默认开） */
  showWebLink?: boolean
  /** 封面比例：插画按方图，漫画系列按 3:4 */
  aspect?: 'square' | 'poster'
  onContextMenu?: (event: React.MouseEvent) => void
  /** 卡片内的附加节点（右键菜单的 portal 等） */
  children?: React.ReactNode
  className?: string
}

/**
 * 作品卡基础组件。
 *
 * 搜索 / 排行 / 推荐 / 收藏 / 作者主页 / 工作台 / 浏览记录 / 稍后看 / 系列
 * 全部走这一份模板：封面、角标、作者行、页数、选中框、右上角操作都做成槽位，
 * 各页面只决定「点击做什么」和「右下角放什么」，不再重复写卡片骨架。
 */
export function WorkCard(props: WorkCardProps): React.JSX.Element {
  const { t } = useI18n()
  const work = props.work
  const reduce = useReducedMotion()
  const cover = (work.thumbnail || work.url || '').trim()
  const selectable = typeof props.onToggle === 'function'
  const showAuthor = props.showAuthor !== false && Boolean(work.userName || work.userId)
  const showBookmarks = typeof work.bookmarkCount === 'number' && props.footerAction == null
  const pageCount = Number(work.pageCount || 0)

  /** 缩略图解码完成后再淡入，避免占位底色上一块块「啪」地出现 */
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const thumbRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    // 命中缓存时 onLoad 可能早于 React 挂载，直接看 complete 补齐首帧
    if (thumbRef.current?.complete) setThumbLoaded(true)
  }, [cover])

  /** 工作台的整卡点击是「选中」，其余页面是「打开」 */
  const activate = (): void => {
    if (props.onToggle) props.onToggle()
    else props.onOpen?.()
  }

  /** 键盘 Enter / Space 等同点击（详情按钮与勾选框自行 stopPropagation） */
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <motion.li
      // 入场 / 退场只动 opacity 与 transform，交给合成器，不影响卡片内的图片布局。
      // 系统开启「减少动态效果」时直接不播放（reduce 为 true 时 initial 必须显式设为 false）
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
      transition={{
        duration: 0.18,
        ease: 'easeOut',
        // 错峰上限 0.18s：翻页一次 50 张也只在半秒内铺完，不会让人等
        delay: reduce ? 0 : Math.min((props.index ?? 0) * 0.012, 0.18)
      }}
      // 可多选的卡片整张都是点击区（与工作台原来的「点任意位置切换选中」一致）；
      // 其余页面的点击区只在封面上，避免选中文字时误触
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? activate : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      onContextMenu={props.onContextMenu}
      data-tour="work-card"
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 transition-colors hover:border-primary/50',
        // 可多选的卡片（工作台）把选中态画在边框上，勾选框只做辅助
        selectable && props.selected
          ? 'border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]'
          : null,
        selectable ? 'cursor-pointer' : null,
        props.className
      )}
    >
      {/* 点击封面打开作品；右上角图标才是「去 pixiv」 */}
      <div
        role={!selectable && props.onOpen ? 'button' : undefined}
        tabIndex={!selectable && props.onOpen ? 0 : undefined}
        title={work.title}
        onClick={selectable ? undefined : activate}
        onKeyDown={selectable ? undefined : onKeyDown}
        className={cn(
          'relative block overflow-hidden bg-secondary/60',
          props.onOpen && !selectable ? 'cursor-zoom-in' : 'cursor-pointer',
          props.aspect === 'poster' ? 'aspect-[3/4]' : 'aspect-square'
        )}
      >
        {cover ? (
          <img
            ref={thumbRef}
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setThumbLoaded(true)}
            className={cn(
              'h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.04]',
              thumbLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageOff className="h-6 w-6" />
          </span>
        )}

        {selectable ? (
          <button
            type="button"
            aria-label={props.selected ? t('works.deselect') : t('works.select')}
            onClick={(event) => {
              event.stopPropagation()
              props.onToggle?.()
            }}
            className={cn(
              'absolute left-2 top-1.5 flex h-5 w-5 items-center justify-center rounded-md border transition-colors',
              props.selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white/40 bg-black/35 text-transparent backdrop-blur hover:border-white/70'
            )}
          >
            <Check className="h-4 w-4" />
          </button>
        ) : null}

        <div
          className={cn(
            'absolute top-1 flex flex-wrap items-center gap-1',
            // 选中框占住左上角，角标往右让一格
            selectable ? 'left-9' : 'left-1'
          )}
        >
          {work.rank && work.rank > 0 ? (
            <Badge className="bg-primary/90 px-1 py-0 text-[10px] text-primary-foreground">
              #{work.rank}
            </Badge>
          ) : null}
          {Number(work.illustType) === 2 ? (
            <Badge className="bg-amber-500/80 px-1 py-0 text-[10px] text-white">
              {t('works.ugoira')}
            </Badge>
          ) : null}
          {Number(work.xRestrict || 0) >= 1 ? (
            <Badge variant="destructive" className="bg-red-500/85 px-1 py-0 text-[10px] text-white">
              R-18
            </Badge>
          ) : null}
          {Number(work.aiType || 0) === 2 ? (
            <Badge className="bg-violet-500/80 px-1 py-0 text-[10px] text-white">AI</Badge>
          ) : null}
          {props.badge}
        </div>

        <div className="absolute right-1 top-1 flex flex-col items-end gap-1">
          {props.action}
          {props.showWebLink ? (
            <a
              href={`https://www.pixiv.net/artworks/${work.id}`}
              target="_blank"
              rel="noreferrer"
              title={t('works.openWeb')}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="rounded bg-black/55 p-1 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>

        {props.downloaded ? (
          <Badge variant="success" className="absolute bottom-2 left-2 bg-black/45 backdrop-blur">
            {t('works.downloaded')}
          </Badge>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
        <p className="line-clamp-2 text-xs font-medium leading-4">{work.title}</p>
        {showAuthor || showBookmarks || props.footerAction ? (
          <div className="flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {showAuthor ? (
                props.authorHover && work.userId ? (
                  // 作者名悬停弹出迷你资料卡，点击直接进主页
                  <AuthorPopover
                    userId={work.userId}
                    name={work.userName || work.userId}
                    avatar={work.profileImageUrl || ''}
                  />
                ) : (
                  <span className="truncate">{work.userName || work.userId}</span>
                )
              ) : null}
            </span>
            {props.footerAction ??
              (showBookmarks ? (
                <span
                  className="flex shrink-0 items-center gap-0.5"
                  title={t('works.bookmarks', { count: work.bookmarkCount ?? 0 })}
                >
                  <Bookmark className="h-4 w-4" />
                  {work.bookmarkCount}
                </span>
              ) : null)}
          </div>
        ) : null}
        {pageCount > 1 ? (
          <p className="text-[10px] text-muted-foreground/70">
            {t('works.pages', { count: pageCount })}
          </p>
        ) : null}
        {props.meta}
      </div>

      {props.children}
    </motion.li>
  )
}

/** 搜索结果 / 用户主页共用的作品卡片：自带右键菜单与「去 pixiv」入口 */
export function SearchWorkCard(props: {
  work: SearchWork
  /** 在当前列表里的序号，用于入场错峰 */
  index?: number
}): React.JSX.Element {
  const work = props.work
  /** 右键菜单：下载 / 稍后看 / 复制 / 屏蔽作者 */
  const menu = useWorkContextMenu({ onPreview: openPreview })

  return (
    <WorkCard
      work={work}
      index={props.index}
      onOpen={() => openPreview(work)}
      authorHover
      showWebLink
      onContextMenu={(event) => menu.onContextMenu(event, work)}
    >
      {menu.menuNode}
    </WorkCard>
  )
}

export function SearchWorkGrid(props: {
  works: SearchWork[]
  /** 滚动容器末尾的附加内容（如触底加载哨兵），必须放在滚动区内才会随滚动进入视口 */
  footer?: React.ReactNode
  /** 滚动容器本身就是这个 div，滚动位置记忆要挂在这里 */
  ref?: React.Ref<HTMLDivElement>
  /** 数据源没有分级维度时（推荐页）忽略「内容分级」规则 */
  ignoreRating?: boolean
}): React.JSX.Element {
  // 过滤在这里统一做：搜索 / 排行 / 推荐 / 收藏 / 用户主页都用这个网格，
  // 接一次就等于全站列表都按顶栏那套规则走，页面不必各自接线
  const { items, hidden } = useFilteredWorks(props.works, {
    ignoreRating: props.ignoreRating
  })

  return (
    <div className="scrollbar-thin overflow-y-auto" ref={props.ref}>
      {hidden > 0 && items.length === 0 ? <FilteredHint count={hidden} /> : null}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
        {/* 列表项自身带入场 / 退场动效，这里只管把「被过滤掉的卡片」留住播完退场动画 */}
        <AnimatePresence>
          {items.map((work, index) => (
            <SearchWorkCard key={work.id} work={work} index={index} />
          ))}
        </AnimatePresence>
      </ul>
      {props.footer}
    </div>
  )
}
