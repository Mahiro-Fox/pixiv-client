import { Filter, RotateCcw } from 'lucide-react'
import type * as React from 'react'
import type { AppConfig, R18Filter } from '@shared/types'
import { countActiveFilters } from '@renderer/lib/filters'
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
      title="过滤规则"
      description="规则在本地对抓取结果实时生效，多条规则同时满足才会保留"
      icon={<Filter className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
      footer={
        <>
          <span className="mr-auto text-[11px] text-muted-foreground">
            已启用 {activeCount} 条规则
          </span>
          <Button variant="ghost" size="sm" onClick={clear}>
            <RotateCcw />
            清空
          </Button>
          <Button size="sm" onClick={props.onClose}>
            完成
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="最少页数" hint="0 表示不限">
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
          <Field label="最多页数" hint="0 表示不限">
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
          <Field label="最小宽度" hint="原图宽，0 不限">
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
          <Field label="最小高度" hint="原图高，0 不限">
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
          <Field label="内容分级">
            <Select
              value={config.filterR18}
              onChange={(value) => props.onConfigChange({ filterR18: value as R18Filter })}
            >
              <option value="any">全部</option>
              <option value="only">仅 R-18</option>
              <option value="exclude">排除 R-18</option>
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
              排除 AI 作品
            </label>
          </div>
        </div>

        <Field label="排除关键词" hint="匹配标题与作者名，逗号或空格分隔">
          <Input
            value={config.filterExcludeKeywords}
            onChange={(event) =>
              props.onConfigChange({ filterExcludeKeywords: event.target.value })
            }
            placeholder="例如：AI, 漫画, 汇总"
          />
        </Field>

        <Field label="排除标签" hint="匹配作品标签，同时兜底匹配标题与作者名">
          <Input
            value={config.filterExcludeTags}
            onChange={(event) => props.onConfigChange({ filterExcludeTags: event.target.value })}
            placeholder="例如：漫画, アニメ"
          />
        </Field>
      </div>
    </Dialog>
  )
}
