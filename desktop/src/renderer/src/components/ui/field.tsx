import type * as React from 'react'
import { Label } from './label'

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
