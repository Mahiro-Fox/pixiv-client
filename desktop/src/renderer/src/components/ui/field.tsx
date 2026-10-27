import type * as React from 'react'
import { Label } from './label'

/** 原生下拉，保持与输入框一致的视觉 */
export function Select({
  value,
  onChange,
  children
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </select>
  )
}

/** 表单字段：标签 + 控件 + 可选说明；`required` 在标签后加红色星号 */
export function Field({
  label,
  hint,
  required,
  children
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}
