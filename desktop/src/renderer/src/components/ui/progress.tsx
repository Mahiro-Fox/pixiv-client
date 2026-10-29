import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@renderer/lib/utils'

export const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const reduce = useReducedMotion()
  const percent = Math.min(100, Math.max(0, Number(value) || 0))

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      {/*
        进度用弹簧过渡：下载速度抖动时进度条不会一格一格跳。
        阻尼比大于 1（欠阻尼才会回弹），所以到 100% 不会越过终点。
      */}
      <ProgressPrimitive.Indicator asChild>
        <motion.div
          className="h-full w-full flex-1 rounded-full bg-primary"
          initial={false}
          animate={{ x: `${-(100 - percent)}%` }}
          transition={
            reduce ? { duration: 0 } : { type: 'spring', stiffness: 210, damping: 30, mass: 0.8 }
          }
        />
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName
