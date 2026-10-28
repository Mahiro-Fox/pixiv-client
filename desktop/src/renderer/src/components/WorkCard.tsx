import { Bookmark, ExternalLink } from 'lucide-react'
import type * as React from 'react'
import type { SearchWork } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { AuthorPopover } from './AuthorPopover'
import { Badge } from './ui/badge'

/** 搜索结果 / 用户主页共用的作品卡片 */
export function SearchWorkCard(props: {
  work: SearchWork
  /** 点击缩略图在应用内预览；未传时退化为跳 pixiv */
  onPreview?: (work: SearchWork) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const work = props.work
  const webUrl = `https://www.pixiv.net/artworks/${work.id}`

  const openPreview = (): void => {
    if (props.onPreview) props.onPreview(work)
    else window.open(webUrl, '_blank')
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 transition-colors hover:border-primary/50">
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
            src={work.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : null}
        <div className="absolute left-1 top-1 flex gap-1">
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
    </div>
  )
}

export function SearchWorkGrid(props: {
  works: SearchWork[]
  onPreview?: (work: SearchWork) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
      {props.works.map((work) => (
        <SearchWorkCard key={work.id} work={work} onPreview={props.onPreview} />
      ))}
    </div>
  )
}
