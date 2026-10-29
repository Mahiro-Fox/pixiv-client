import { Filter, RotateCcw, ShieldBan } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import type { AppConfig, R18Filter } from '@shared/types'
import { splitBlockTermsRaw } from '@shared/block'
import { countActiveFilters } from '@renderer/lib/filters'
import { useI18n } from '@renderer/i18n'
import { BlockManagerDialog } from './BlockManagerDialog'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Field, Select } from './ui/field'
import { Input } from './ui/input'

interface FilterDialogProps {
  config: AppConfig
  onConfigChange: (patch: Partial<AppConfig>) => void
  onClose: () => void
}

/** 过滤规则弹窗：本地实时生效，规则之间为「与」关系 */
export function FilterDialog(props: FilterDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const { config } = props
  const activeCount = countActiveFilters(config)
  /** 屏蔽名单管理单独一层弹窗：清单要能一目了然地看，塞在这个弹窗里会太长 */
  const [managing, setManaging] = useState(false)
  const blockedUsers = splitBlockTermsRaw(config.blockUsers).length
  const blockedTags = splitBlockTermsRaw(config.blockTags).length

  const clear = (): void => {
    props.onConfigChange({
      filterMinPages: 0,
      filterMaxPages: 0,
      filterMinWidth: 0,
      filterMinHeight: 0,
      filterExcludeTags: '',
      filterExcludeKeywords: '',
      filterR18: 'any',
      filterExcludeAi: false,
      blockTags: '',
      blockUsers: ''
    })
  }

  return (
    <Dialog
      title={t('filter.title')}
      description={t('filter.description')}
      icon={<Filter className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
      // 管理层打开时 Esc 只关管理层，别把整个过滤弹窗一起关掉
      closeOnEscape={!managing}
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted-foreground">
            {t('filter.activeCount', { count: activeCount })}
          </span>
          <Button variant="ghost" size="sm" onClick={clear}>
            <RotateCcw />
            {t('filter.clear')}
          </Button>
          <Button size="sm" onClick={props.onClose}>
            {t('filter.done')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('filter.minPages')} hint={t('filter.noLimit')}>
            <Input
              type="number"
              min={0}
              value={config.filterMinPages}
              onChange={(event) =>
                props.onConfigChange({
                  filterMinPages: Math.max(0, Number(event.target.value) || 0)
                })
              }
            />
          </Field>
          <Field label={t('filter.maxPages')} hint={t('filter.noLimit')}>
            <Input
              type="number"
              min={0}
              value={config.filterMaxPages}
              onChange={(event) =>
                props.onConfigChange({
                  filterMaxPages: Math.max(0, Number(event.target.value) || 0)
                })
              }
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('filter.minWidth')} hint={t('filter.minWidthHint')}>
            <Input
              type="number"
              min={0}
              value={config.filterMinWidth}
              onChange={(event) =>
                props.onConfigChange({
                  filterMinWidth: Math.max(0, Number(event.target.value) || 0)
                })
              }
            />
          </Field>
          <Field label={t('filter.minHeight')} hint={t('filter.minHeightHint')}>
            <Input
              type="number"
              min={0}
              value={config.filterMinHeight}
              onChange={(event) =>
                props.onConfigChange({
                  filterMinHeight: Math.max(0, Number(event.target.value) || 0)
                })
              }
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('filter.r18')}>
            <Select
              value={config.filterR18}
              onChange={(value) => props.onConfigChange({ filterR18: value as R18Filter })}
            >
              <option value="any">{t('filter.r18Any')}</option>
              <option value="only">{t('filter.r18Only')}</option>
              <option value="exclude">{t('filter.r18Exclude')}</option>
            </Select>
          </Field>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={config.filterExcludeAi}
                onChange={(event) =>
                  props.onConfigChange({ filterExcludeAi: event.target.checked })
                }
                className="h-3.5 w-3.5 accent-primary"
              />
              {t('filter.excludeAi')}
            </label>
          </div>
        </div>

        <Field label={t('filter.excludeKeywords')} hint={t('filter.excludeKeywordsHint')}>
          <Input
            value={config.filterExcludeKeywords}
            onChange={(event) =>
              props.onConfigChange({ filterExcludeKeywords: event.target.value })
            }
            placeholder={t('filter.excludeKeywordsPlaceholder')}
          />
        </Field>

        <Field label={t('filter.excludeTags')} hint={t('filter.excludeTagsHint')}>
          <Input
            value={config.filterExcludeTags}
            onChange={(event) => props.onConfigChange({ filterExcludeTags: event.target.value })}
            placeholder={t('filter.excludeTagsPlaceholder')}
          />
        </Field>

        {/* 与上面的「排除标签」不同：屏蔽是全局的，搜索、用户主页、收藏里都不再出现 */}
        <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/20 p-3">
          <p className="text-[11px] text-muted-foreground">{t('filter.blockHint')}</p>
          <Field label={t('filter.blockTags')} hint={t('filter.blockTagsHint')}>
            <Input
              value={config.blockTags}
              onChange={(event) => props.onConfigChange({ blockTags: event.target.value })}
              placeholder={t('filter.blockTagsPlaceholder')}
            />
          </Field>
          <Field label={t('filter.blockUsers')} hint={t('filter.blockUsersHint')}>
            <Input
              value={config.blockUsers}
              onChange={(event) => props.onConfigChange({ blockUsers: event.target.value })}
              placeholder={t('filter.blockUsersPlaceholder')}
            />
          </Field>
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <ShieldBan className="h-3.5 w-3.5" />
              {t('filter.manageBlocks')}
            </span>
            <span className="shrink-0 tabular-nums">
              {t('filter.manageBlocksCount', { users: blockedUsers, tags: blockedTags })}
            </span>
          </button>
        </div>
      </div>

      {managing ? (
        <BlockManagerDialog
          config={config}
          onConfigChange={props.onConfigChange}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </Dialog>
  )
}
