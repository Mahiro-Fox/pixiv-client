import {
  Bookmark,
  BookmarkMinus,
  Download,
  ExternalLink,
  Eye,
  Hash,
  Link2,
  ShieldBan,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type * as React from 'react'
import { useNavigate } from 'react-router-dom'
import type { SearchWork } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { ContextMenu, type ContextMenuItem } from '@renderer/components/ContextMenu'
import { messageOf } from './errors'
import { toast } from './toast'
import {
  blockAuthor,
  copyText,
  enqueueWorks,
  isAuthorBlocked,
  unblockAuthor,
  userWebUrl,
  workWebUrl
} from './workActions'

/** 用户卡只需要 id / 名字就能撑起整个菜单 */
export interface MenuUser {
  id: string
  name: string
}

interface Anchor {
  x: number
  y: number
}

const ICON = 'h-3.5 w-3.5'

/**
 * 作品卡右键菜单。
 *
 * 挂在卡片组件内部而不是页面上：卡片出现在搜索、排行、推荐、收藏、作者页等
 * 五个地方，逐个页面接线容易漏；一个 hook 带一个 portal 节点，插到哪都能用。
 *
 * 每个菜单各自持有状态（同屏最多只有一个真正打开），打开前会先清掉上一个。
 */
export function useWorkContextMenu(options: {
  /** 有预览能力时（搜索 / 排行 / 收藏等）才显示「应用内预览」 */
  onPreview?: (work: SearchWork) => void
}): {
  onContextMenu: (event: React.MouseEvent, work: SearchWork) => void
  menuNode: React.JSX.Element | null
} {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [target, setTarget] = useState<SearchWork | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  /** 是否已在「稍后看」里，决定菜单项显示加入还是移出 */
  const [saved, setSaved] = useState(false)
  /** 作者是否已被屏蔽，决定菜单项显示屏蔽还是取消屏蔽 */
  const [blocked, setBlocked] = useState(false)
  /** 异步读状态期间可能已经右键了别的作品，用它丢掉过期结果 */
  const targetId = useRef('')

  const close = useCallback(() => setAnchor(null), [])

  const onContextMenu = useCallback((event: React.MouseEvent, work: SearchWork) => {
    event.preventDefault()
    event.stopPropagation()
    targetId.current = work.id
    setTarget(work)
    setAnchor({ x: event.clientX, y: event.clientY })
    setSaved(false)
    setBlocked(false)
    // 这两个状态都要读一次本地/配置才知道菜单该怎么写，读完再纠正文案
    void Promise.all([
      window.pixiv.isWatchLater(work.id),
      isAuthorBlocked(work.userId, work.userName)
    ])
      .then(([value, isBlocked]) => {
        if (targetId.current !== work.id) return
        setSaved(value)
        setBlocked(isBlocked)
      })
      .catch(() => undefined)
  }, [])

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      toast.success(t('menu.copied'))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  const enqueue = async (work: SearchWork): Promise<void> => {
    try {
      const count = await enqueueWorks([work])
      toast.success(t('menu.downloadQueued', { count }))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  const toggleWatchLater = async (work: SearchWork): Promise<void> => {
    try {
      if (saved) {
        await window.pixiv.removeWatchLater(work.id)
        setSaved(false)
        toast.success(t('menu.watchLaterRemoved'))
        return
      }
      await window.pixiv.addWatchLater({
        id: work.id,
        title: work.title,
        userId: work.userId,
        userName: work.userName,
        url: work.thumbnail,
        pageCount: work.pageCount,
        xRestrict: work.xRestrict,
        illustType: work.illustType
      })
      setSaved(true)
      toast.success(t('menu.watchLaterAdded'))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  const block = async (userId: string, userName: string): Promise<void> => {
    try {
      const added = await blockAuthor(userId, userName)
      const name = userName || userId
      // 列表过滤是主进程做的，本地数据（历史 / 稍后看）里的卡片不会被立刻收走，
      // 状态先翻转，再右键同一个作者时就能直接撤销
      setBlocked(true)
      if (added) toast.success(t('menu.blocked', { name }))
      else toast.info(t('menu.blockSkipped', { name }))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  /** 取消屏蔽后卡片本身还在（列表是之前取的），下一次刷新就不再过滤该作者 */
  const unblock = async (userId: string, userName: string): Promise<void> => {
    try {
      const removed = await unblockAuthor(userId, userName)
      const name = userName || userId
      setBlocked(false)
      if (removed > 0) toast.success(t('menu.unblocked', { name }))
      else toast.info(t('menu.notBlocked', { name }))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  let menuNode: React.JSX.Element | null = null

  if (target && anchor) {
    const work = target
    const items: ContextMenuItem[] = []

    if (options.onPreview) {
      const preview = options.onPreview
      items.push({
        key: 'preview',
        label: t('menu.preview'),
        icon: <Eye className={ICON} />,
        onSelect: () => preview(work)
      })
    }
    items.push({
      key: 'open',
      label: t('works.openWeb'),
      icon: <ExternalLink className={ICON} />,
      onSelect: () => window.open(workWebUrl(work.id), '_blank')
    })
    items.push({
      key: 'artist',
      label: t('menu.openArtist'),
      icon: <UserRound className={ICON} />,
      disabled: !work.userId,
      onSelect: () => void navigate(`/user/${work.userId}`)
    })
    items.push({
      key: 'download',
      label: t('menu.download'),
      icon: <Download className={ICON} />,
      divider: true,
      onSelect: () => void enqueue(work)
    })
    items.push({
      key: 'watchLater',
      label: saved ? t('menu.watchLaterRemove') : t('menu.watchLaterAdd'),
      icon: saved ? <BookmarkMinus className={ICON} /> : <Bookmark className={ICON} />,
      onSelect: () => void toggleWatchLater(work)
    })
    items.push({
      key: 'copyLink',
      label: t('menu.copyWorkLink'),
      icon: <Link2 className={ICON} />,
      divider: true,
      onSelect: () => void copy(workWebUrl(work.id))
    })
    items.push({
      key: 'copyId',
      label: t('menu.copyWorkId'),
      icon: <Hash className={ICON} />,
      hint: work.id,
      onSelect: () => void copy(work.id)
    })
    items.push({
      key: 'block',
      label: blocked ? t('menu.unblockAuthor') : t('menu.blockAuthor'),
      icon: blocked ? <ShieldCheck className={ICON} /> : <ShieldBan className={ICON} />,
      hint: work.userName,
      danger: !blocked,
      divider: true,
      disabled: !work.userId && !work.userName,
      onSelect: () => {
        if (blocked) void unblock(work.userId, work.userName)
        else void block(work.userId, work.userName)
      }
    })

    menuNode = <ContextMenu x={anchor.x} y={anchor.y} items={items} onClose={close} />
  }

  return { onContextMenu, menuNode }
}

/** 用户卡右键菜单：主页 / pixiv / 复制 / 屏蔽（已屏蔽时变成取消屏蔽） */
export function useUserContextMenu(): {
  onContextMenu: (event: React.MouseEvent, user: MenuUser) => void
  menuNode: React.JSX.Element | null
} {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [target, setTarget] = useState<MenuUser | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [blocked, setBlocked] = useState(false)
  const targetId = useRef('')

  const close = useCallback(() => setAnchor(null), [])

  const onContextMenu = useCallback((event: React.MouseEvent, user: MenuUser) => {
    event.preventDefault()
    event.stopPropagation()
    targetId.current = user.id
    setTarget(user)
    setAnchor({ x: event.clientX, y: event.clientY })
    setBlocked(false)
    void isAuthorBlocked(user.id, user.name)
      .then((value) => {
        if (targetId.current === user.id) setBlocked(value)
      })
      .catch(() => undefined)
  }, [])

  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text)
      toast.success(t('menu.copied'))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  const block = async (user: MenuUser): Promise<void> => {
    try {
      const added = await blockAuthor(user.id, user.name)
      setBlocked(true)
      if (added) toast.success(t('menu.blocked', { name: user.name || user.id }))
      else toast.info(t('menu.blockSkipped', { name: user.name || user.id }))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  const unblock = async (user: MenuUser): Promise<void> => {
    try {
      const removed = await unblockAuthor(user.id, user.name)
      setBlocked(false)
      if (removed > 0) toast.success(t('menu.unblocked', { name: user.name || user.id }))
      else toast.info(t('menu.notBlocked', { name: user.name || user.id }))
    } catch (reason) {
      toast.error(messageOf(reason))
    }
  }

  let menuNode: React.JSX.Element | null = null

  if (target && anchor) {
    const user = target
    const items: ContextMenuItem[] = [
      {
        key: 'open',
        label: t('menu.openProfile'),
        icon: <UserRound className={ICON} />,
        onSelect: () => void navigate(`/user/${user.id}`)
      },
      {
        key: 'pixiv',
        label: t('works.openWeb'),
        icon: <ExternalLink className={ICON} />,
        onSelect: () => window.open(userWebUrl(user.id), '_blank')
      },
      {
        key: 'copyLink',
        label: t('menu.copyUserLink'),
        icon: <Link2 className={ICON} />,
        divider: true,
        onSelect: () => void copy(userWebUrl(user.id))
      },
      {
        key: 'copyId',
        label: t('menu.copyUserId'),
        icon: <Hash className={ICON} />,
        hint: user.id,
        onSelect: () => void copy(user.id)
      },
      {
        key: 'block',
        label: blocked ? t('menu.unblockAuthor') : t('menu.blockAuthor'),
        icon: blocked ? <ShieldCheck className={ICON} /> : <ShieldBan className={ICON} />,
        danger: !blocked,
        divider: true,
        disabled: !user.id && !user.name,
        onSelect: () => {
          if (blocked) void unblock(user)
          else void block(user)
        }
      }
    ]

    menuNode = <ContextMenu x={anchor.x} y={anchor.y} items={items} onClose={close} />
  }

  return { onContextMenu, menuNode }
}
