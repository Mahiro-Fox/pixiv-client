import { ExternalLink, ShieldBan, Tag, Trash2, UserRound } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'
import type { AppConfig } from '@shared/types'
import { joinBlockTerms, splitBlockTermsRaw } from '@shared/block'
import { userWebUrl } from '@renderer/lib/workActions'
import { useI18n } from '@renderer/i18n'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

interface BlockManagerDialogProps {
  config: AppConfig
  onConfigChange: (patch: Partial<AppConfig>) => void
  onClose: () => void
}

/** 纯数字词条按用户 ID 处理：与共享匹配逻辑保持一致（ID 精确、其余按昵称包含） */
const USER_ID = /^\d+$/

/**
 * 屏蔽名单管理。
 *
 * 屏蔽后该作者的卡片会被主进程整体过滤掉，右键菜单根本够不着，
 * 所以管理必须独立于卡片列表存在：这里列出全部词条，逐条取消或整组清空。
 *
 * 是一个「只读 + 删除」的清单，添加仍走右键菜单与过滤弹窗的输入框。
 */
export function BlockManagerDialog(props: BlockManagerDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const users = splitBlockTermsRaw(props.config.blockUsers)
  const tags = splitBlockTermsRaw(props.config.blockTags)

  const removeUser = (term: string): void => {
    const keep = users.filter((item) => item.toLowerCase() !== term.toLowerCase())
    props.onConfigChange({ blockUsers: joinBlockTerms(keep) })
  }

  const removeTag = (term: string): void => {
    const keep = tags.filter((item) => item.toLowerCase() !== term.toLowerCase())
    props.onConfigChange({ blockTags: joinBlockTerms(keep) })
  }

  return createPortal(
    // 外层加一层更高的 z，避免与父级弹窗（过滤规则）同级叠在一起分不清前后
    <div className="fixed inset-0 z-[60]">
      <Dialog
        title={t('block.title')}
        description={t('block.description')}
        icon={<ShieldBan className="h-4 w-4 text-primary" />}
        onClose={props.onClose}
        footer={
          <Button size="sm" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="space-y-5">
          <Section
            icon={<UserRound className="h-3.5 w-3.5" />}
            title={t('block.users')}
            count={users.length}
            empty={t('block.emptyUsers')}
            onClear={() => props.onConfigChange({ blockUsers: '' })}
          >
            {users.map((term) => (
              <Row
                key={term}
                term={term}
                note={USER_ID.test(term) ? t('block.byId') : t('block.byName')}
                onRemove={() => removeUser(term)}
                action={
                  USER_ID.test(term) ? (
                    <button
                      type="button"
                      title={t('block.openProfile')}
                      onClick={() => window.open(userWebUrl(term), '_blank')}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  ) : null
                }
              />
            ))}
          </Section>

          <Section
            icon={<Tag className="h-3.5 w-3.5" />}
            title={t('block.tags')}
            count={tags.length}
            empty={t('block.emptyTags')}
            onClear={() => props.onConfigChange({ blockTags: '' })}
          >
            {tags.map((term) => (
              <Row
                key={term}
                term={term}
                note={t('block.byTag')}
                onRemove={() => removeTag(term)}
              />
            ))}
          </Section>

          <p className="text-[11px] leading-5 text-muted-foreground">
            {t('block.note')}
            <br />
            {t('block.emptyHint')}
          </p>
        </div>
      </Dialog>
    </div>,
    document.body
  )
}

function Section(props: {
  icon: React.ReactNode
  title: string
  count: number
  empty: string
  onClear: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const empty = props.count === 0

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
          <span className="text-muted-foreground" aria-hidden>
            {props.icon}
          </span>
          {props.title}
          <span className="text-[11px] font-normal text-muted-foreground">（{props.count}）</span>
        </h3>
        {empty ? null : <ClearButton label={t('block.clear')} onClear={props.onClear} />}
      </div>

      {empty ? (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
          {props.empty}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60 bg-secondary/10">
          {props.children}
        </ul>
      )}
    </section>
  )
}

function Row(props: {
  term: string
  note: string
  onRemove: () => void
  action?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <li className="group flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground/90">{props.term}</p>
        <p className="text-[10px] text-muted-foreground">{props.note}</p>
      </div>
      {props.action}
      <Button
        variant="ghost"
        size="sm"
        onClick={props.onRemove}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('block.remove')}
      </Button>
    </li>
  )
}

/** 清空要两步：先变成「确认清空」，移开焦点或再点一次才真正清掉 */
function ClearButton(props: { label: string; onClear: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)

  return (
    <Button
      size="sm"
      variant={armed ? 'destructive' : 'ghost'}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        props.onClear()
        setArmed(false)
      }}
      className={armed ? undefined : 'text-muted-foreground'}
    >
      {armed ? t('block.clearConfirm') : props.label}
    </Button>
  )
}
