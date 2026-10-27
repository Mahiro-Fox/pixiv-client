import { createContext, useContext, useMemo } from 'react'
import type * as React from 'react'
import type { ReactNode } from 'react'
import type { Locale } from '@shared/types'
import { MESSAGES, type MessageKey } from './messages'

export type TranslateParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: TranslateParams) => string

/** 按语言取文案并替换 {name} 占位符；缺失的 key 回退到简体中文 */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES['zh-CN'][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

interface I18nValue {
  locale: Locale
  t: Translate
}

const I18nContext = createContext<I18nValue>({
  locale: 'zh-CN',
  t: (key, params) => translate('zh-CN', key, params)
})

export function I18nProvider({
  locale,
  children
}: {
  locale: Locale
  children: ReactNode
}): React.JSX.Element {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: (key, params) => translate(locale, key, params) }),
    [locale]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

export type { MessageKey }
export { TOKEN_LABEL_KEYS } from './messages'
