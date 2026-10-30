import { Bookmark, ExternalLink } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SearchWork } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { useWorkContextMenu } from '@renderer/lib/cardMenu'
import { useFilteredWorks } from '@renderer/lib/filterContext'
import { AuthorPopover } from './AuthorPopover'
import { FilteredHint } from './FilteredHint'
import { Badge } from './ui/badge'

/** 搜索结果 / 用户主页共用的作品卡片 */
export function SearchWorkCard(props: {
  work: SearchWork
  /** 点击缩略图在应用内预览；未传时退化为跳 pixiv */
  onPreview?: (work: SearchWork) => void
  /** 在当前列表里的序号：用来做入场错峰，避免上百张卡片同时放大招 */
  index?: number
}): React.JSX.Element {
  const { t } = useI18n()
  const work = props.work
  const reduce = useReducedMotion()
  const webUrl = `https://www.pixiv.net/artworks/${work.id}`
  /** 右键菜单：下载 / 稍后看 / 复制 / 屏蔽作者，卡片右上角的常驻图标因此可以只留「去 pixiv」 */
  const menu = useWorkContextMenu({ onPreview: props.onPreview })

  /** 缩略图解码完成后再淡入，避免占位底色上一块块「啪」地出现 */
  const [thumbLoaded, setThumbLoaded] = useState(false)
  const thumbRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    // 命中缓存时 onLoad 可能早于 React 挂载，直接看 complete 补齐首帧
    if (thumbRef.current?.complete) setThumbLoaded(true)
  }, [work.thumbnail])

  const openPreview = (): void => {
    if (props.onPreview) props.onPreview(work)
    else window.open(webUrl, '_blank')
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
      onContextMenu={(event) => menu.onContextMenu(event, work)}
      data-tour="work-card"
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 transition-colors hover:border-primary/50"
    >
      {/* 点击图片只做应用内预览，右上角图标才是「去 pixiv」 */}
      <div
        role="button"
        tabIndex={0}
        title={work.title}
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPreview()
          }
        }}
        className="relative block aspect-square cursor-zoom-in overflow-hidden bg-secondary/60"
      >
        {work.thumbnail ? (
          <img
            ref={thumbRef}
            src={work.thumbnail}
            alt=""
            loading="lazy"
            onLoad={() => setThumbLoaded(true)}
            className={`h-full w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.04] ${
              thumbLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : null}
        <div className="absolute left-1 top-1 flex gap-1">
          {work.rank && work.rank > 0 ? (
            <Badge className="bg-primary/90 px-1 py-0 text-[10px] text-primary-foreground">
              #{work.rank}
            </Badge>
          ) : null}
          {work.xRestrict >= 1 ? (
            <Badge variant="destructive" className="bg-red-500/85 px-1 py-0 text-[10px] text-white">
              R-18
            </Badge>
          ) : null}
          {work.aiType === 2 ? (
            <Badge className="bg-violet-500/80 px-1 py-0 text-[10px] text-white">AI</Badge>
          ) : null}
        </div>
        <a
          href={webUrl}
          target="_blank"
          rel="noreferrer"
          title={t('works.openWeb')}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
        <p className="line-clamp-2 text-xs font-medium leading-4">{work.title}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {/* 作者名悬停弹出迷你资料卡，点击直接进主页 */}
          <AuthorPopover
            userId={work.userId}
            name={work.userName}
            avatar={work.profileImageUrl}
          />
          <span className="flex shrink-0 items-center gap-0.5" title={t('works.bookmarks', { count: work.bookmarkCount })}>
            <Bookmark className="h-3 w-3" />
            {work.bookmarkCount}
          </span>
        </div>
        {work.pageCount > 1 ? (
          <p className="text-[10px] text-muted-foreground/70">
            {t('works.pages', { count: work.pageCount })}
          </p>
        ) : null}
      </div>
      {menu.menuNode}
    </motion.li>
  )
}

export function SearchWorkGrid(props: {
  works: SearchWork[]
  onPreview?: (work: SearchWork) => void
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
            <SearchWorkCard
              key={work.id}
              work={work}
              index={index}
              onPreview={props.onPreview}
            />
          ))}
        </AnimatePresence>
      </ul>
      {props.footer}
    </div>
  )
}
