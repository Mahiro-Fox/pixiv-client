import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { messageOf } from './errors'
import { usePageActive } from './pageActive'

/**
 * 统一分页取数。
 *
 * 改造前五个页面各自抄了一遍同样的骨架：`page` 从 URL 读、用来去重的
 * `loadedSig`、`alive` 标志、`loading` / `error` 两个 state、条件变化时
 * `scroll.reset()`。任何一处漏写就会出现「从详情页回来重新请求」或
 * 「切换筛选后停在上一页的滚动位置」这类问题，所以收敛到这里。
 *
 * 页面只负责：从 URL 读参数（或本地 state）、拼条件签名、给出取数函数。
 */
export interface PagedQueryOptions<T> {
  /** 当前页，来自 URL 或本地 state */
  page: number
  /**
   * 除页码外的条件签名（关键词、排序、筛选…）。
   * 变化即视为换了内容：重新请求 + 滚动回顶 + 清掉错误。
   */
  signature: string
  /** 取第 page 页数据 */
  query: (page: number) => Promise<T>
  /** 不发请求（没关键词、没选用户、没连凭据等），并清空已有数据 */
  skip?: boolean
  /**
   * 换内容条件（不含页码）时先清空旧数据。
   * 列表页一般不想要这个（清空会闪一下白屏）；但「从 A 作者主页切到 B」时
   * 保留上一批作品会很怪，那类页面打开它。
   */
  clearOnChange?: boolean
  /** 滚动记忆实例：翻页 / 换条件时把位置归零 */
  scroll?: { reset: () => void }
  /** 数据就绪后回调：派生状态（每页条数、筛选 chip 缓存等）在这里更新 */
  onData?: (data: T) => void
}

export interface PagedQueryResult<T> {
  data: T | null
  loading: boolean
  error: string
  /** 同条件下强制重取（刷新按钮） */
  reload: () => void
}

export function usePagedQuery<T>(options: PagedQueryOptions<T>): PagedQueryResult<T> {
  const { page, signature, skip = false, scroll, clearOnChange = false } = options

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 递增即强制重取：条件和页码都没变时用它绕过去重 */
  const [nonce, setNonce] = useState(0)

  const active = usePageActive()
  /** 已经取到的条件签名：一致就不再请求（keep-alive 回前台时最常命中） */
  const loadedSig = useRef('')
  /** 上一次的内容条件（不含页码），配合 clearOnChange 判断是否换了对象 */
  const lastSignature = useRef('')

  // query / onData / scroll 多半是内联函数，每次渲染都是新引用。
  // 放进依赖会让 effect 每渲染都重跑，所以统一用 ref 取最新值。
  const queryRef = useRef(options.query)
  queryRef.current = options.query
  const onDataRef = useRef(options.onData)
  onDataRef.current = options.onData
  const resetScrollRef = useRef(scroll?.reset)
  resetScrollRef.current = scroll?.reset

  useEffect(() => {
    // keep-alive 后台时 URL 参数会被算成默认值，此时不读、也不请求
    if (!active) return

    if (skip) {
      setData(null)
      setError('')
      setLoading(false)
      loadedSig.current = ''
      return
    }

    const sig = `${signature}|${page}|${nonce}`
    if (loadedSig.current === sig) return

    let alive = true
    if (clearOnChange && lastSignature.current !== signature) setData(null)
    lastSignature.current = signature
    resetScrollRef.current?.()
    setLoading(true)
    setError('')
    void queryRef
      .current(page)
      .then((next) => {
        if (!alive) return
        loadedSig.current = sig
        setData(next)
        onDataRef.current?.(next)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        // 失败就清掉签名，下次激活（或下次参数变化）允许重新请求
        loadedSig.current = ''
        setData(null)
        setError(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [active, skip, page, signature, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload }
}

/** 本地分页（浏览记录 / 稍后看这类一次性取回整个列表的页面） */
export interface LocalPageResult<T> {
  /** 实际生效的页码：列表变短时会自动收敛，不会停在空白页 */
  page: number
  lastPage: number
  pageItems: T[]
  setPage: (page: number) => void
  /** 回到第一页（清空、删除、过滤条件变化） */
  reset: () => void
}

export function useLocalPage<T>(items: T[], pageSize: number): LocalPageResult<T> {
  const [raw, setRaw] = useState(1)
  const lastPage = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(1, raw), lastPage)

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize]
  )

  const setPage = useCallback((next: number) => {
    const value = Math.round(Number(next))
    setRaw(Number.isFinite(value) && value > 0 ? value : 1)
  }, [])
  const reset = useCallback(() => setRaw(1), [])

  return { page, lastPage, pageItems, setPage, reset }
}
