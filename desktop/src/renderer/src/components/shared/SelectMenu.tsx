import * as React from 'react'
import { cn } from '@renderer/utils/ui'
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export interface SelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

interface SelectMenuProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** 值为空时的占位文案 */
  placeholder?: string
  disabled?: boolean
  /** sm 用于工具栏，md 用于表单 */
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}

/**
 * 按 `options` 数组驱动的下拉，底下是 shadcn 的 Select（Radix）。
 *
 * 项目里有十来处「一组固定选项 + 当前值 + onChange」的选择器，
 * 每处都展开写成 Root/Trigger/Content/Item 四层反而更难读，
 * 所以保留原来的数组式 API，只在尺寸上区分工具栏与表单两种规格。
 */
export function SelectMenu(props: SelectMenuProps): React.JSX.Element {
  const { value, onChange, options, placeholder, disabled, size = 'md', className, ariaLabel } = props

  return (
    <SelectRoot
      // 空串交给 Radix 会被当成「已选中空值」，取不到占位文案，这里转成未选中
      value={value === '' ? undefined : value}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-2.5 text-sm', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={size === 'sm' ? 'py-1 text-xs' : undefined}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  )
}
