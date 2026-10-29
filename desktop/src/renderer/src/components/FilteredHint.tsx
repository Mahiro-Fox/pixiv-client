import { FilterX } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '@renderer/i18n'
import { useFilterContext } from '@renderer/lib/filterContext'
import { Button } from './ui/button'

/**
 * 整页结果都被过滤规则隐藏时的占位。
 *
 * 有些页面按接口返回的原始条数判断「有没有内容」，规则把一页全挡掉时
 * 它不会给出空态，只剩空白网格——这里补一句说明并给个直达规则的入口。
 */
export function FilteredHint(props: { count: number }): React.JSX.Element {
  const { t } = useI18n()
  const { onOpenFilter } = useFilterContext()

  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
      <FilterX className="h-5 w-5 opacity-60" />
      <p>{t('filter.hiddenAll', { count: props.count })}</p>
      {onOpenFilter ? (
        <Button variant="ghost" size="sm" onClick={onOpenFilter}>
          {t('filter.adjust')}
        </Button>
      ) : null}
    </div>
  )
}
