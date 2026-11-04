import * as React from 'react'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * 应用主题由 `utils/theme.ts` 直接切 html 上的 `dark` class，没有主题库。
 * shadcn 原始模板用 next-themes 读主题，这里没必要——监听这个 class 就够了。
 */
function useIsDark(): boolean {
  const [dark, setDark] = React.useState(() =>
    document.documentElement.classList.contains('dark')
  )

  React.useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

/** 全局轻提示容器：挂在 App 根部一次即可，样式对齐 shadcn 的 popover 卡片 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  const dark = useIsDark()

  return (
    <Sonner
      theme={dark ? 'dark' : 'light'}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:rounded-lg group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}
