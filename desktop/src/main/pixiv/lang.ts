import type { Locale } from '../../shared/types'

/**
 * pixiv 接口的 `lang` 参数。
 *
 * 网页 ajax 接口会按这个值返回标题 / 标签的译文（`tags.tags[].translation`），
 * 固定 `zh` 会让英日界面拿到中文译文，两边对不上。这里跟着界面语言走：
 * `zh-CN` → `zh`、`en` → `en`、`ja` → `ja`，其余（含老配置的脏值）回落 `zh`。
 *
 * 为什么用模块级缓存而不是每次读 config.json：这些 URL 是在请求前同步拼出来的，
 * 每个接口读一次文件既慢又没必要。主进程在启动时和 `config:set` 时同步一次即可。
 */
const PIXIV_LANGS: Record<string, string> = {
  'zh-CN': 'zh',
  zh: 'zh',
  en: 'en',
  'en-US': 'en',
  ja: 'ja',
  'ja-JP': 'ja'
}

/** 当前界面语言对应的 pixiv 取值；默认值与 config 的默认语言一致 */
let current = 'zh'

export function localeToPixivLang(locale: string | null | undefined): string {
  const key = String(locale || '').trim()
  if (!key) return 'zh'
  return PIXIV_LANGS[key] ?? PIXIV_LANGS[key.split('-')[0].toLowerCase()] ?? 'zh'
}

/** 由主进程在启动读到配置、以及保存配置（语言可能刚改）时调用 */
export function setPixivLang(locale: Locale | string | null | undefined): void {
  current = localeToPixivLang(locale)
}

export function pixivLang(): string {
  return current
}

/**
 * 与 `lang` 参数配套的请求头。
 * 单改 URL 而请求头仍是中文，pixiv 有可能按请求头回中文文案，
 * 两处取值来自同一个 `current`，不会互相打架。
 */
const ACCEPT_LANGUAGE: Record<string, string> = {
  zh: 'zh-CN,zh;q=0.9',
  en: 'en-US,en;q=0.9',
  ja: 'ja-JP,ja;q=0.9'
}

export function pixivAcceptLanguage(): string {
  return ACCEPT_LANGUAGE[current] ?? ACCEPT_LANGUAGE.zh
}

/**
 * 从 pixiv 的译文字典（`tagTranslation` / `translation`）里取当前语言那一条。
 * 字典里通常只有部分语言，缺了按中文 → 繁体 → 罗马字 → 英文的顺序兜底，
 * 保证界面上不会出现空标签。
 */
export function pickLangText(dict: Record<string, string> | null | undefined): string {
  if (!dict) return ''
  return dict[current] || dict.zh || dict.zh_tw || dict.romaji || dict.en || ''
}

/**
 * 把 URL 模板里的 `{lang}` 换成当前语言。
 * 只由 `http.ts` 的 requestJson 调用：所有接口都经那里发请求，
 * 一处替换就能保证没有哪个接口漏掉，调用方只负责写模板。
 */
export function withLang(url: string): string {
  return url.includes('{lang}') ? url.replace('{lang}', pixivLang()) : url
}
