import type { ThemeMode } from '@shared/types'

/** 与 index.html 首屏脚本共用同一个 key，保证刷新后主题不闪 */
const THEME_STORAGE_KEY = 'pixiv-theme'

export function prefersDarkSystem(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把三态主题折算成当前实际生效的亮/暗 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return prefersDarkSystem() ? 'dark' : 'light'
  return mode === 'light' ? 'light' : 'dark'
}

/** 切换 html 的 dark class（Tailwind darkMode: 'class'）并写入本地镜像 */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // 隐私模式等场景写入失败时忽略，主题仍对当前会话生效
  }
}

/** 跟随系统时监听系统配色变化，其他模式无需监听 */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
