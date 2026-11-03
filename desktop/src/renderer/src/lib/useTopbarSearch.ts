import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { bumpSearchSubmit } from './searchSubmit'
import { getSectionSearch, rememberSectionSearch } from './sectionQuery'
import type { SearchSection } from './sectionQuery'

/** 顶栏搜索框同步关键词的范围：只有这四个搜索栏目页会随 URL 变化 */
const SEARCH_SECTION_PATHS = new Set(['/illust', '/manga', '/novel', '/users'])

export interface TopbarSearchState {
  /** 顶栏搜索框的受控值；与 URL 的 word 保持同步 */
  keyword: string
  setKeyword: (value: string) => void
  submitSearch: (value?: string) => void
  linkWithWord: (path: string) => string
}

/**
 * 顶栏搜索：关键词、栏目切换时的查询串还原，以及回车提交。
 *
 * 搜索词与 URL 的唯一同步点在这里：路由变化后把输入框拉回 URL 里的词，
 * 并顺手记住该栏目的查询串，供顶栏导航原样还原。
 */
export function useTopbarSearch(): TopbarSearchState {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentWord = searchParams.get('word') || ''
  const [keyword, setKeyword] = useState(currentWord)

  /** 顶栏导航与搜索框共用：按路由判断当前栏目 */
  const section: 'illust' | 'manga' | 'novel' | 'users' = location.pathname.startsWith('/manga')
    ? 'manga'
    : location.pathname.startsWith('/novel')
      ? 'novel'
      : location.pathname.startsWith('/user')
        ? 'users'
        : 'illust'
  const sectionPath = `/${section}`

  // 路由变化（导航切换、点相关标签）后把搜索框同步回 URL 里的关键词，
  // 同时记住该栏目这一份查询串，供顶栏导航原样还原。
  // 只在四个搜索栏目页同步：进作者/作品详情页时 URL 没有 word，
  // 否则搜索框会被清空，返回后又跳回原词，用户会觉得输入框在乱变。
  useEffect(() => {
    if (!SEARCH_SECTION_PATHS.has(location.pathname)) return
    setKeyword(currentWord)
    rememberSectionSearch(location.pathname.slice(1) as SearchSection, location.search)
  }, [currentWord, location.search, location.pathname])

  const submitSearch = (value?: string): void => {
    const word = (value ?? keyword).trim()
    if (value !== undefined) setKeyword(value)
    // 只有这里（回车提交）才要求刷新数据；同一个关键词再按一次回车也要重新取
    bumpSearchSubmit()
    navigate(word ? `${sectionPath}?word=${encodeURIComponent(word)}` : sectionPath)
  }

  /**
   * 顶部导航跳到某个栏目时，原样还原该栏目上次的查询串（关键词 / 页码 / 筛选）。
   *
   * 不能只看当前 URL 的 `currentWord`：站在「推荐 / 排行榜」上它恒为空，
   * 会把插画页刚搜过的词丢掉。该栏目没有记录时才退回当前关键词，
   * 保留「换栏目继续搜同一个词」的原有行为。
   */
  const linkWithWord = (path: string): string => {
    const saved = getSectionSearch(path.slice(1) as SearchSection)
    if (saved) return `${path}${saved}`
    return currentWord ? `${path}?word=${encodeURIComponent(currentWord)}` : path
  }

  return { keyword, setKeyword, submitSearch, linkWithWord }
}
