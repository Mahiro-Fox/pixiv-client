import { Users } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { UserWorkThumb } from '@shared/types'
import { Badge } from './ui/badge'

export interface UserCardData {
  id: string
  name: string
  comment: string
  avatar: string
  /** 前四个作品缩略图；关注列表没有该字段 */
  works?: UserWorkThumb[]
}

/** 头像加载失败时退回占位图标，避免留下空白 */
function UserAvatar(props: { src: string; name: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  if (!props.src || failed) {
    return (
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Users className="h-6 w-6" />
      </span>
    )
  }

  return (
    <img
      src={props.src}
      alt={props.name}
      loading="lazy"
      className="h-16 w-16 shrink-0 rounded-full border border-border/60 object-cover"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * 用户卡片：与 pixiv web 的用户列表一致 —— 头像、昵称 + ID + 简介，右侧横向四张作品缩略图。
 * 点击卡片进用户主页；点击缩略图只做图片预览，不跳转。
 */
export function UserCard(props: {
  user: UserCardData
  /** 点击四张作品缩略图时触发应用内预览 */
  onPreview?: (thumb: UserWorkThumb) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const user = props.user
  const works = user.works || []

  const open = (): void => {
    void navigate(`/user/${user.id}`)
  }

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3 transition-colors hover:border-primary/50 hover:bg-secondary/40"
    >
      <UserAvatar src={user.avatar} name={user.name} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 truncate text-sm font-medium">{user.name}</p>
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
            ID {user.id}
          </Badge>
        </div>
        <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {user.comment}
        </p>
      </div>

      {works.length > 0 ? (
        <div className="flex shrink-0 gap-1.5">
          {works.slice(0, 4).map((thumb) => (
            <button
              key={thumb.id}
              type="button"
              title={thumb.id}
              onClick={(event) => {
                // 缩略图只做预览，点击不应跳进用户主页
                event.stopPropagation()
                props.onPreview?.(thumb)
              }}
              className="h-24 w-24 overflow-hidden rounded-md bg-secondary/60 ring-1 ring-inset ring-border/40 transition-shadow hover:ring-primary/60"
            >
              {thumb.url ? (
                <img
                  src={thumb.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden'
                  }}
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  )
}
