import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { cn } from '@renderer/lib/utils'

export interface SelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

interface SelectProps {
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
 * 自定义下拉：原生 select 的弹层由系统绘制，深色主题下会出现亮蓝高亮与灰底，
 * 这里用按钮 + 绝对定位列表自己画，并带展开动效与键盘操作。
 */
export function Select(props: SelectProps): React.JSX.Element {
  const { value, onChange, options, placeholder, disabled, size = 'md', className, ariaLabel } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)

  const current = options.find((option) => option.value === value)

  const close = (): void => {
    setOpen(false)
    setActive(-1)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // 展开时把当前项滚到可视区，长列表（如作者标签）也能直接看到选中位置
  useEffect(() => {
    if (!open || active < 0) return
    const node = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openMenu = (): void => {
    if (disabled) return
    const index = options.findIndex((option) => option.value === value)
    setOpen(true)
    setActive(index >= 0 ? index : options.findIndex((option) => !option.disabled))
  }

  const pick = (option: SelectOption): void => {
    if (option.disabled) return
    onChange(option.value)
    close()
  }

  const step = (delta: number): void => {
    if (options.length === 0) return
    let index = active
    for (let guard = 0; guard < options.length; guard += 1) {
      index = (index + delta + options.length) % options.length
      if (!options[index].disabled) {
        setActive(index)
        return
      }
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      step(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[active]
      if (option) pick(option)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  const height = size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-2.5 text-sm'

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 text-left transition-colors',
          'hover:border-border hover:bg-secondary/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'border-primary/50 bg-secondary/60',
          disabled && 'cursor-not-allowed opacity-50',
          height
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-muted-foreground')}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>

      {open ? (
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          className={cn(
            'select-menu scrollbar-thin absolute z-40 mt-1 max-h-64 min-w-full w-max max-w-[20rem] overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 shadow-xl',
            size === 'sm' ? 'text-xs' : 'text-sm'
          )}
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">—</p>
          ) : (
            options.map((option, index) => {
              const selected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  data-index={index}
                  aria-selected={selected}
                  disabled={option.disabled}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(option)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                    option.disabled && 'cursor-not-allowed opacity-40',
                    !option.disabled && index === active && 'bg-secondary',
                    selected ? 'text-primary' : 'text-foreground/85'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
