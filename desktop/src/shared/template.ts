/**
 * 文件名模板：主进程与渲染进程共用，保证「预览」「实际落盘」「已下载判定」三处规则一致。
 * 纯函数，无副作用，不依赖 Node/Electron API。
 */

export const DEFAULT_FILE_TEMPLATE = '{id}_p{page}_{title}'

export interface TemplateToken {
  token: string
  label: string
  example: string
}

/** 用于设置页展示的变量表，顺序即推荐书写顺序 */
export const TEMPLATE_TOKENS: TemplateToken[] = [
  { token: '{id}', label: '作品 ID', example: '122784064' },
  { token: '{page}', label: '页码（从 0 开始，同 pixiv）', example: '0' },
  { token: '{page1}', label: '页码（从 1 开始）', example: '1' },
  { token: '{title}', label: '标题', example: '夕焼け' },
  { token: '{author}', label: '作者名', example: '画师名' },
  { token: '{userid}', label: '作者 ID', example: '114638697' },
  { token: '{tag}', label: '标签', example: 'R-18' },
  { token: '{date}', label: '发布日期（YYYY-MM-DD）', example: '2026-01-01' },
  { token: '{quality}', label: '下载质量（regular / original）', example: 'original' },
  { token: '{ext}', label: '扩展名', example: '.jpg' }
]

const TOKEN_RE = /\{(id|page1|page|title|author|userid|tag|date|quality|ext)\}/g
const INVALID_CHARS = /[\\/:*?"<>|\r\n\t]+/g

/** 清理单个路径片段：替换非法字符、去掉首尾的点/空格/下划线 */
export function safeFilePart(text: unknown, fallback = ''): string {
  const cleaned = String(text ?? '')
    .replace(INVALID_CHARS, '_')
    .replace(/^[.\s_]+/, '')
    .replace(/[.\s_]+$/, '')
  return cleaned || fallback
}

/** 校验模板，返回错误文案；null 表示合法 */
export function validateTemplate(template: string): string | null {
  const value = (template || '').trim()
  if (!value) return '模板不能为空'
  if (/[\\/]/.test(value)) return '模板不能包含路径分隔符，目录由「标签 / 作者」自动生成'
  if (!value.includes('{id}')) return '模板必须包含 {id}，否则不同作品会重名'
  const hasPage = value.includes('{page}')
  const hasPage1 = value.includes('{page1}')
  if (!hasPage && !hasPage1) return '模板必须包含 {page} 或 {page1}，否则多图作品会重名'
  if (hasPage && hasPage1) return '{page} 与 {page1} 只能保留一个'

  const unknown = (value.match(/\{[^}]*\}/g) || []).filter(
    (token) => !TEMPLATE_TOKENS.some((item) => item.token === token)
  )
  if (unknown.length > 0) return `未知变量：${Array.from(new Set(unknown)).join('、')}`
  return null
}

export interface TemplateVars {
  id: string
  title: string
  author: string
  userid: string
  tag: string
  /** 0 基页码 */
  page: number
  /** 发布日期，ISO 字符串 */
  date?: string
  /** 下载质量：regular / original，用于让两种质量的文件名共存 */
  quality?: string
  /** 含点的扩展名，如 .jpg */
  ext: string
}

function tokenValue(token: string, vars: TemplateVars): string {
  switch (token) {
    case 'id':
      return safeFilePart(vars.id, '0')
    case 'page':
      return String(Math.max(0, Math.floor(vars.page) || 0))
    case 'page1':
      return String(Math.max(0, Math.floor(vars.page) || 0) + 1)
    case 'title':
      return safeFilePart(vars.title, 'untitled').slice(0, 60)
    case 'author':
      return safeFilePart(vars.author, 'artist').slice(0, 40)
    case 'userid':
      return safeFilePart(vars.userid, 'unknown')
    case 'tag':
      return safeFilePart(vars.tag, 'tag').slice(0, 40)
    case 'date':
      // 只保留 YYYY-MM-DD 部分，避免出现冒号等非法字符
      return String(vars.date || '')
        .slice(0, 10)
        .replace(/[^0-9-]/g, '')
    case 'quality':
      return vars.quality === 'original' ? 'original' : 'regular'
    case 'ext':
      return vars.ext || '.jpg'
    default:
      return ''
  }
}

/**
 * 渲染文件名（含扩展名）。
 * - 变量值先做非法字符清理，再把连续下划线/短横折叠，避免空变量留下 `__`
 * - 未写 {ext} 时自动追加扩展名
 * - 截断只在整体超长时发生，且优先保留头部（id/page 通常在前）
 */
export function renderFileName(template: string, vars: TemplateVars): string {
  const pattern = (template || '').trim() || DEFAULT_FILE_TEMPLATE
  const rendered = pattern.replace(TOKEN_RE, (_match, token: string) => tokenValue(token, vars))
  const cleaned = safeFilePart(rendered)
    .replace(/_{2,}/g, '_')
    .replace(/-{3,}/g, '-')
    .slice(0, 120)
  const withExt = pattern.includes('{ext}') ? cleaned : `${cleaned}${vars.ext || '.jpg'}`
  return withExt || `${safeFilePart(vars.id, '0')}_p${vars.page}${vars.ext || '.jpg'}`
}

export interface DownloadMatcher {
  re: RegExp
  /** 页码需要减去的偏移：{page1} 为 1 */
  pageOffset: number
  idGroup: number
  pageGroup: number
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 由模板生成「文件名 → 作品 ID / 页码」的解析器，用于严格判定已下载。
 * 只捕获 {id} 与页码变量，其余变量用通配匹配，因此标题改了也不影响判定。
 */
export function compileDownloadMatcher(template: string): DownloadMatcher | null {
  if (validateTemplate(template)) return null

  const pattern = (template || '').trim()
  const pageOffset = pattern.includes('{page1}') ? 1 : 0
  let source = '^'
  let cursor = 0
  let idGroup = 0
  let pageGroup = 0
  let group = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0

  while ((match = TOKEN_RE.exec(pattern)) !== null) {
    source += escapeRegex(pattern.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const token = match[1]

    if (token === 'id' || token === 'page' || token === 'page1') {
      group += 1
      source += '(\\d+)'
      if (token === 'id') idGroup = group
      else pageGroup = group
    } else if (token === 'ext') {
      source += '(?:\\.[A-Za-z0-9]+)?'
    } else {
      source += '[^\\\\/]*?'
    }
  }

  source += escapeRegex(pattern.slice(cursor))
  if (!idGroup || !pageGroup) return null
  // 忽略扩展名之后的差异，只要求从文件名开头按模板匹配
  return { re: new RegExp(`${source}.*$`), pageOffset, idGroup, pageGroup }
}
