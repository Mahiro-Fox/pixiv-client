import { Filter, RotateCcw } from 'lucide-react'
import type * as React from 'react'
import type { AppConfig, R18Filter } from '@shared/types'
import { countActiveFilters } from '@renderer/lib/filters'
import { useI18n } from '@renderer/i18n'
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

  const clear = (): void => {
    props.onConfigChange({
      filterMinPages: 0,
      filterMaxPages: 0,
      filterMinWidth: 0,
      filterMinHeight: 0,
      filterExcludeTags: '',
      filterExcludeKeywords: '',
      filterR18: 'any',
      filterExcludeAi: false
    })
  }

  return (
    <Dialog
      title={t('filter.title')}
      description={t('filter.description')}
      icon={<Filter className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
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
      </div>
    </Dialog>
  )
}
