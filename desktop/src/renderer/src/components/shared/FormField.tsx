import type * as React from 'react';
import { Field, FieldDescription, FieldLabel } from '../ui/field';

/**
 * 表单字段：标签 + 控件 + 可选说明；`required` 在标签后加红色星号。
 *
 * 基于 shadcn 的 `Field` 原语封装，外部只关心 label / hint，不铺开 FieldGroup 那套组合 API。
 */
export function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Field className="gap-1.5">
      <FieldLabel>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </FieldLabel>
      {children}
      {hint ? (
        <FieldDescription className="text-[11px] leading-4 text-muted-foreground/70">
          {hint}
        </FieldDescription>
      ) : null}
    </Field>
  );
}
