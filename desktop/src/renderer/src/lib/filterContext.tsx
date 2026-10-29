import { createContext, useContext, useMemo } from 'react'
import type * as React from 'react'
import type { AppConfig } from '@shared/types'
import {
  compileFilters,
  filterNovels,
  filterWorks,
  type CompiledFilters,
  type FilterableNovel,
  type FilterableWork
} from '@shared/filters'

interface FilterContextValue {
  config: AppConfig | null
  /** 编译好的判定参数，列表过滤器直接用 */
  filters: CompiledFilters
  /** 打开过滤规则弹窗（空态提示里的「调整规则」要用） */
  onOpenFilter?: () => void
}

const EMPTY_FILTERS = compileFilters(null)

const FilterContext = createContext<FilterContextValue>({
  config: null,
  filters: EMPTY_FILTERS,
  onOpenFilter: undefined
})

/**
 * 过滤规则的全局上下文。
 *
 * 规则以前只挂在下载工作台的列表上，现在对全站列表生效：顶栏按钮打开同一个
 * 弹窗，各列表用这里的 `filters` 就地过滤——判定在渲染层完成，所以改完规则
 * 不必重新请求接口，已加载的列表会立刻重算。
 */
export function FilterProvider(props: {
  config: AppConfig | null
  onOpenFilter?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const { config, onOpenFilter } = props
  const value = useMemo<FilterContextValue>(
    () => ({ config, filters: compileFilters(config), onOpenFilter }),
    [config, onOpenFilter]
  )
  return <FilterContext.Provider value={value}>{props.children}</FilterContext.Provider>
}

export function useFilterContext(): FilterContextValue {
  return useContext(FilterContext)
}

/** 只取配置本身（例如小说页需要判断分级等） */
export function useFilterConfig(): AppConfig | null {
  return useContext(FilterContext).config
}

/** 按当前规则过滤作品列表，返回保留项与被隐藏的数量 */
export function useFilteredWorks<T extends FilterableWork>(works: T[]): {
  items: T[]
  hidden: number
} {
  const { filters } = useFilterContext()
  return useMemo(() => {
    const result = filterWorks(works, filters)
    return { items: result.items, hidden: result.removed }
  }, [works, filters])
}

/** 按当前规则过滤小说列表（页数 / 尺寸规则不适用） */
export function useFilteredNovels<T extends FilterableNovel>(novels: T[]): {
  items: T[]
  hidden: number
} {
  const { filters } = useFilterContext()
  return useMemo(() => {
    const result = filterNovels(novels, filters)
    return { items: result.items, hidden: result.removed }
  }, [novels, filters])
}
