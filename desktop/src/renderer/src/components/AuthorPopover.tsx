import { Loader2, User as UserIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { UserProfile } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

/** 浮层宽度（px），与下方 w-60 保持一致，用于做左右边界收敛 */
const POPUP_WIDTH = 240

/**
 * 主页信息按用户缓存：同一作者的作品卡可能在同一页出现多次，
 * 重复请求既慢又容易触发 pixiv 的频率限制。
 */
const profileCache = new Map<string, Promise<UserProfile>>()

function loadProfile(userId: string): Promise<UserProfile> {
  const cached = profileCache.get(userId)
  if (cached) return cached
  const task = window.pixiv.getUserProfile(userId)
  profileCache.set(userId, task)
  // 失败时清掉坏缓存，下次悬停还能重试
  void task.catch(() => profileCache.delete(userId))
  return task
}

interface AuthorPopoverProps {
  userId: string
  name: string
  avatar: string
}

/**
 * 作品卡上的作者信息：悬停弹出小卡片（头像、昵称、ID、关注数、作品数、简介），
 * 点击作者名直接进入其主页。浮层用 portal + fixed 定位，避免被卡片的 overflow 裁切。
 */
export function AuthorPopover(props: AuthorPopoverProps): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [failed, setFailed] = useState(false)
  const open = anchor !== null

  const clearTimers = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }

  useEffect(() => clearTimers, [])

  /** 以触发元素的位置为基准计算浮层坐标；下方空间不足时翻到上方 */
  const place = (): void => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(
      Math.max(8, rect.left - 8),
      window.innerWidth - POPUP_WIDTH - 8
    )
    const above = rect.bottom + 230 > window.innerHeight
    setAnchor({ left, top: above ? rect.top - 8 : rect.bottom + 8, above })
  }

  /** 悬停 160ms 后再弹，避免划过一整排卡片时连续触发请求 */
  const show = (): void => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (openTimer.current) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      place()
      setFailed(false)
      void loadProfile(props.userId)
        .then((data) => setProfile(data))
        .catch(() => setFailed(true))
    }, 160)
  }

  const scheduleHide = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(() => setAnchor(null), 140)
  }

  /** 鼠标移入浮层时只取消关闭，不重新定位，避免浮层抖动 */
  const keepOpen = (): void => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // 卡片滚动时重新定位，而不是直接关掉，体验更连贯
  useEffect(() => {
    if (!open) return
    const reposition = (): void => place()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  // 点击浮层外部或按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (popup.current?.contains(target) || trigger.current?.contains(target)) return
      setAnchor(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAnchor(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openProfile = (): void => {
    setAnchor(null)
    void navigate(`/user/${props.userId}`)
  }

  const workCount = profile
    ? profile.counts.illust + profile.counts.manga + profile.counts.novel
    : 0

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onClick={openProfile}
        className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
      >
        {props.avatar ? (
          <img
            src={props.avatar}
            alt=""
            loading="lazy"
            className="h-4 w-4 shrink-0 rounded-full border border-border/60 object-cover"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary">
            <UserIcon className="h-2.5 w-2.5" />
          </span>
        )}
        <span className="truncate">{props.name}</span>
      </button>

      {anchor
        ? createPortal(
            <div
              ref={popup}
              onMouseEnter={keepOpen}
              onMouseLeave={scheduleHide}
              style={{
                left: anchor.left,
                top: anchor.top,
                transform: anchor.above ? 'translateY(-100%)' : undefined
              }}
              className="fixed z-[70] w-60 rounded-xl border border-border/70 bg-popover p-3 shadow-xl"
            >
              <div className="flex items-center gap-2.5">
                {(profile?.avatar || props.avatar) ? (
                  <img
                    src={profile?.avatar || props.avatar}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-border/60 bg-secondary object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                    <UserIcon className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{profile?.name || props.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">ID {props.userId}</p>
                </div>
                {profile?.premium ? (
                  <Badge className="shrink-0 bg-amber-500/15 px-1 py-0 text-[10px] text-amber-500">
                    {t('user.premium')}
                  </Badge>
                ) : null}
              </div>

              {profile?.comment ? (
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground/90">
                  {profile.comment}
                </p>
              ) : null}

              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                {failed ? (
                  <span className="text-muted-foreground/70">{t('author.loadFailed')}</span>
                ) : profile ? (
                  <>
                    <span>{t('user.followingCount', { count: profile.following })}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{t('author.workCount', { count: workCount })}</span>
                  </>
                ) : (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('works.loading')}
                  </span>
                )}
              </div>

              <Button variant="outline" size="sm" className="mt-2.5 w-full" onClick={openProfile}>
                {t('author.openProfile')}
              </Button>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
