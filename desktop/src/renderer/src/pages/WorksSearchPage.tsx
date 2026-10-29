import { Hash, ImageOff, Images, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type {
  WorkSearchChip,
  WorkSearchKind,
  WorkSearchMode,
  WorkSearchOrder,
  WorkSearchResult,
  WorkSearchScope
} from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { Pagination } from '@renderer/components/ui/pagination'
import { Select } from '@renderer/components/ui/select'
import { SearchWorkGrid } from '@renderer/components/WorkCard'
import { useCachedPage, writePageCache } from '@renderer/lib/pageCache'
import { useScrollMemory } from '@renderer/lib/scrollMemory'
import { useWorkPreview } from '@renderer/lib/workPreview'

/** 校验 URL 里的排序值；热门度排序属会员功能，不在下拉里提供 */
const ORDERS: WorkSearchOrder[] = [
  'date_d',
  'date',
  'popular_d',
  'popular_male_d',
  'popular_female_d'
]

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 关闭某个筛选 chip 时，把它涉及到的参数还原成默认值 */
const RESET_PATCH: Record<string, string> = {
  order: 'date_d',
  mode: 'all',
  csw: '',
  blt: '',
  scope: '',
  includeManga: ''
}

/**
 * 插画 / 漫画搜索页共用一套 UI：栏目只决定请求路径与部分筛选文案。
 * 关键词、排序、分级、页码全部挂在 URL 上，方便顶栏导航与搜索框同步。
 */
export function WorksSearchPage(props: { kind: WorkSearchKind }): React.JSX.Element {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  /** 点击作品缩略图在应用内预览，右上角图标才跳 pixiv */
  const { openPreview, previewNode } = useWorkPreview()

  const word = params.get('word') || ''
  const order = (ORDERS.includes(params.get('order') as WorkSearchOrder)
    ? params.get('order')
    : 'date_d') as WorkSearchOrder
  const mode: WorkSearchMode =
    params.get('mode') === 'safe' || params.get('mode') === 'r18'
      ? (params.get('mode') as WorkSearchMode)
      : 'all'
  const scope: WorkSearchScope = params.get('scope') === 'tag_tc' ? 'tag_tc' : 'tag'
  const csw = params.get('csw') === '1'
  const blt = Math.max(0, Math.round(Number(params.get('blt') || 0) || 0))
  const includeManga = params.get('includeManga') === '1'
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1))

  const [result, setResult] = useState<WorkSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /**
   * chips 会随当前筛选状态变化（已应用的选项会从列表里消失），
   * 这里按 id 做并集缓存，保证筛选行不会在点击后突然跳动。
   */
  const chipCache = useRef(new Map<string, WorkSearchChip>())
  const [chips, setChips] = useState<WorkSearchChip[]>([])

  /** 从详情页后退回来时命中快照，避免整页数据重刷 */
  const cacheKey = `works|${props.kind}|${word}|${order}|${mode}|${page}|${csw ? 1 : 0}|${blt}|${scope}|${includeManga ? 1 : 0}`
  /** 后退会复用同一个 location.key；手动改筛选是新历史条目，快照视为未命中 */
  const locationKey = useLocation().key
  /** 本次挂载读到的快照；StrictMode 下 effect 跑两次也拿到同一份 */
  const snapshot = useCachedPage<{ result: WorkSearchResult; chips: WorkSearchChip[] }>(
    cacheKey,
    locationKey
  )
  /** 本次渲染是否来自后退快照：只有快照才还原滚动位置 */
  const [restored, setRestored] = useState(false)
  const scrollRef = useScrollMemory<HTMLDivElement>(cacheKey, restored)

  // 插画与漫画的筛选集合不同，切换栏目时清空缓存
  useEffect(() => {
    chipCache.current.clear()
    setChips([])
  }, [props.kind])

  useEffect(() => {
    if (!word) {
      setResult(null)
      setError('')
      return
    }
    if (snapshot) {
      chipCache.current = new Map(snapshot.chips.map((chip) => [chip.id, chip]))
      setResult(snapshot.result)
      setChips(snapshot.chips)
      setError('')
      setLoading(false)
      setRestored(true)
      return
    }

    let alive = true
    setRestored(false)
    setLoading(true)
    setError('')
    void window.pixiv
      .searchWorks({ kind: props.kind, word, order, mode, page, csw, blt, scope, includeManga })
      .then((data) => {
        if (!alive) return
        setResult(data)
        data.chips.forEach((chip) => chipCache.current.set(chip.id, chip))
        // 会员专属筛选（如更细的热门度/收藏数区间）不接入，直接不展示
        const nextChips = Array.from(chipCache.current.values()).filter((chip) => !chip.premium)
        setChips(nextChips)
        writePageCache(cacheKey, { result: data, chips: nextChips }, locationKey)
      })
      .catch((reason: unknown) => {
        if (alive) {
          setResult(null)
          setError(messageOf(reason))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [props.kind, word, order, mode, page, csw, blt, scope, includeManga])

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next)
  }

  /**
   * chip 的 params 是「相对默认状态」的增量，
   * 只要其中每一项都与当前 URL 一致，就认为该 chip 处于开启状态。
   */
  const isChipActive = (chip: WorkSearchChip): boolean => {
    const delta = chip.params
    if (delta.order && delta.order !== order) return false
    if (delta.mode && delta.mode !== mode) return false
    if (delta.csw && !csw) return false
    if (delta.blt && String(blt) !== delta.blt) return false
    if (delta.scope && delta.scope !== scope) return false
    if (delta.includeManga && !includeManga) return false
    return Boolean(
      delta.order ||
        delta.mode ||
        delta.csw ||
        delta.blt ||
        delta.scope ||
        delta.includeManga
    )
  }

  const toggleChip = (chip: WorkSearchChip): void => {
    if (isChipActive(chip)) {
      const reset: Record<string, string> = {}
      Object.keys(chip.params).forEach((key) => {
        reset[key] = RESET_PATCH[key] ?? ''
      })
      apply({ ...reset, page: '1' })
      return
    }
    const patch: Record<string, string> = { page: '1' }
    Object.entries(chip.params).forEach(([key, value]) => {
      patch[key] = value ?? ''
    })
    // blt 需要在 URL 上以字符串保存；csw / scope 同理
    apply(patch)
  }

  const relatedTags = useMemo(
    () => (result?.relatedTags || []).filter((tag) => tag && tag !== word).slice(0, 20),
    [result, word]
  )

  const chipClass = (active: boolean): string =>
    `flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
      active
        ? 'border-primary/60 bg-primary/15 text-primary'
        : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary'
    }`

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Select
          size="sm"
          className="w-[9rem]"
          value={order}
          ariaLabel={t('novel.order')}
          onChange={(value) => apply({ order: value, page: '1' })}
          options={[
            { value: 'date_d', label: t('novel.orderDateDesc') },
            { value: 'date', label: t('novel.orderDateAsc') }
          ]}
        />

        {/* 其余筛选项直接来自接口的 suggestChips，文案随 lang 自动本地化 */}
        {chips.map((chip) => {
          const active = isChipActive(chip)
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleChip(chip)}
              className={chipClass(active)}
            >
              {chip.label}
            </button>
          )
        })}

        {result && word ? (
          <span className="ml-auto text-[11px]">{t('works.total', { total: result.total })}</span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!word ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Images className="h-10 w-10 opacity-40" />
          <p className="text-sm">{t('works.searchHint')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {relatedTags.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              {relatedTags.map((tag) => {
                const translation = result?.tagTranslation[tag] || ''
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => apply({ word: tag, page: '1' })}
                    className="group flex flex-col items-start rounded-lg border border-border/60 px-2 py-1 leading-tight transition-colors hover:border-primary/50"
                  >
                    {translation ? (
                      <span className="max-w-[10rem] truncate text-[10px] text-muted-foreground/80">
                        {translation}
                      </span>
                    ) : null}
                    <span className="max-w-[10rem] truncate text-[11px] text-muted-foreground transition-colors group-hover:text-primary">
                      #{tag}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('works.loading')}
              </div>
            ) : null}
            {!loading && result && result.works.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageOff className="h-6 w-6" />
                {t('works.noResult')}
              </div>
            ) : null}
            {!loading && result && result.works.length > 0 ? (
              <SearchWorkGrid works={result.works} onPreview={openPreview} />
            ) : null}
          </div>

          {result && result.lastPage > 1 ? (
            <Pagination
              page={page}
              lastPage={result.lastPage}
              onChange={(next) => apply({ page: String(next) })}
              disabled={loading}
            />
          ) : null}
        </div>
      )}

      {previewNode}
    </main>
  )
}
