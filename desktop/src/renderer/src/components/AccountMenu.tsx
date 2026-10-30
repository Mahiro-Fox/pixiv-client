import {
  Bookmark,
  ChevronRight,
  Clock3,
  Loader2,
  LogIn,
  Settings2,
  User,
  Users
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type { SelfUser } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Button } from './ui/button'

interface AccountMenuProps {
  selfUser: SelfUser | null
  hasCookie: boolean
  loggingIn: boolean
  onLogin: () => void
  onOpenFollowing: () => void
  onOpenFavorites: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
}

/**
 * 顶栏账号入口：已登录时点击头像弹出浮层，集中放账号信息、
 * 关注列表入口（关注数来自接口）以及收藏 / 浏览记录等预备入口。
 */
export function AccountMenu(props: AccountMenuProps): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [following, setFollowing] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)

  // 点击外部或按 Esc 关闭浮层
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 关注数在每次打开浮层时刷新：关注 / 取关会改变总数，缓存住会一直显示旧值。
  // limit 传 1，只关心 total。
  useEffect(() => {
    if (!open || !props.selfUser) return
    let alive = true
    setLoading(true)
    void window.pixiv
      .getFollowing({ userId: '', offset: 0, limit: 1 })
      .then((result) => {
        if (alive) setFollowing(result.total)
      })
      .catch(() => {
        // 取失败时别把已有数字清成 0，只有首次失败才回落
        if (alive) setFollowing((previous) => previous ?? 0)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, props.selfUser])

  if (!props.selfUser) {
    // 有登录凭据但还没取到账号信息时，不要退化成「登录」按钮，
    // 否则用户会以为没登录而反复点击
    if (props.hasCookie) {
      return (
        <button
          type="button"
          data-tour="account-menu"
          onClick={props.onOpenSettings}
          className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/40"
        >
          <User className="h-3.5 w-3.5" />
          {t('header.loggedIn')}
        </button>
      )
    }
    return (
      <Button size="sm" data-tour="account-menu" disabled={props.loggingIn} onClick={props.onLogin}>
        {props.loggingIn ? <Loader2 className="animate-spin" /> : <LogIn />}
        {props.loggingIn ? t('header.loggingIn') : t('header.login')}
      </Button>
    )
  }

  const user = props.selfUser
  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-secondary/60'

  const go = (action: () => void): void => {
    setOpen(false)
    action()
  }

  return (
    <div ref={root} data-tour="account-menu" className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        title={user.account ? `@${user.account}` : user.name}
        className="flex items-center gap-2 rounded-full border border-border/60 py-1 pl-1 pr-2.5 transition-colors hover:bg-secondary/40"
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt=""
            className="h-6 w-6 rounded-full bg-secondary object-cover"
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
            <User className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="max-w-[9rem] truncate text-xs font-medium leading-4">{user.name}</span>
        {user.premium ? (
          <span className="rounded bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-500">
            {t('header.premium')}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="account-menu absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-xl">
          <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-11 w-11 rounded-full border border-border/60 bg-secondary object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
                <User className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {user.account ? `@${user.account}` : user.id}
              </p>
            </div>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              onClick={() => go(props.onOpenFollowing)}
              className={itemClass}
            >
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">
                {t('account.following')}
                <span className="ml-1 font-medium text-foreground">
                  {loading ? '…' : (following ?? 0)}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => go(props.onOpenFavorites)}
              className={itemClass}
            >
              <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">{t('account.favorites')}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => go(props.onOpenHistory)}
              className={itemClass}
            >
              <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">{t('account.history')}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => go(props.onOpenSettings)}
              className={itemClass}
            >
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 text-left">{t('account.settings')}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
