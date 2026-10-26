import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-xs font-medium leading-none text-muted-foreground', className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName
