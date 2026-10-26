import {
  Bookmark,
  Download,
  Gem,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  Tags,
  UserRound,
  Users,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type {
  AppConfig,
  BookmarkRest,
  ImageQuality,
  SelfUser,
  TagMode,
  TagSuggestion
} from '@shared/types'
import { validateTemplate } from '@shared/template'
import { cn } from '@renderer/lib/utils'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Field, Select } from './ui/field'
import { Input } from './ui/input'
import { Separator } from './ui/separator'

interface CollectPanelProps {
  config: AppConfig
  selfUser: SelfUser | null
  hasCookie: boolean
  collecting: boolean
  running: boolean
  selectedCount: number
  onConfigChange: (patch: Partial<AppConfig>) => void
  onCollect: () => void
  onDownload: () => void
  onCancel: () => void
  onSuggestTags: (word: string) => Promise<TagSuggestion[]>
  onOpenFollowing: () => void
}

/** 把「逗号/空格/顿号」分隔的标签串拆成列表（与主进程解析规则一致） */
function splitTags(value: string): string[] {
  return (value || '')
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

interface TagInputProps {
  value: string
  onChange: (value: string) => void
  onSuggest: (word: string) => Promise<TagSuggestion[]>
}

/** 带搜索建议的标签输入框：防抖 350ms 请求 pixiv 关联标签，支持键盘上下选择 */
function TagInput({ value, onChange, onSuggest }: TagInputProps): React.JSX.Element {
  const [items, setItems] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const box = useRef<HTMLDivElement | null>(null)

  const close = (): void => {
    setOpen(false)
    setActive(-1)
  }

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const request = (word: string): void => {
    if (timer.current) clearTimeout(timer.current)
    if (word.trim().length < 2) {
      setItems([])
      close()
      return
    }

    timer.current = setTimeout(() => {
      const id = seq.current + 1
      seq.current = id
      setLoading(true)
      void onSuggest(word)
        .then((result) => {
          if (seq.current !== id) return
          setItems(result)
          setOpen(result.length > 0)
          setActive(-1)
        })
        .catch(() => {
          if (seq.current === id) setItems([])
        })
        .finally(() => {
          if (seq.current === id) setLoading(false)
        })
    }, 350)
  }

  const apply = (suggestion: TagSuggestion): void => {
    onChange(suggestion.tag)
    setItems([])
    close()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || items.length === 0) {
      if (event.key === 'ArrowDown' && items.length > 0) setOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((previous) => (previous + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((previous) => (previous <= 0 ? items.length - 1 : previous - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      apply(items[active >= 0 ? active : 0])
    } else if (event.key === 'Escape') {
      close()
    }
  }

  return (
    <div ref={box} className="relative">
      <Input
        value={value}
        placeholder="R-18"
        onChange={(event) => {
          onChange(event.target.value)
          request(event.target.value)
        }}
        onFocus={() => {
          if (items.length > 0) setOpen(true)
          else request(value)
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {loading ? (
        <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}

      {open && items.length > 0 ? (
        <div className="scrollbar-thin absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl">
          <p className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            标签建议
          </p>
          {items.map((item, index) => (
            <button
              key={`${item.tag}-${index}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => apply(item)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                index === active ? 'bg-secondary text-foreground' : 'text-foreground/85'
              )}
            >
              <span className="truncate">{item.tag}</span>
              {item.translation ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {item.translation}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface TagListInputProps {
  value: string
  onChange: (value: string) => void
  onSuggest: (word: string) => Promise<TagSuggestion[]>
  placeholder?: string
}

/**
 * 多标签输入：回车/逗号添加为芯片，退格删除最后一个，带 pixiv 关联标签建议。
 * 值以「逗号+空格」序列化，与主进程的解析规则保持一致。
 */
function TagListInput({
  value,
  onChange,
  onSuggest,
  placeholder
}: TagListInputProps): React.JSX.Element {
  const chips = splitTags(value)
  const [draft, setDraft] = useState('')
  const [items, setItems] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const box = useRef<HTMLDivElement | null>(null)

  const close = (): void => {
    setOpen(false)
    setActive(-1)
  }

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const commit = (tag: string): void => {
    const next = tag.trim()
    if (next && !chips.some((chip) => chip.toLowerCase() === next.toLowerCase())) {
      onChange([...chips, next].join(', '))
    }
    setDraft('')
    setItems([])
    close()
  }

  const remove = (tag: string): void => {
    onChange(chips.filter((chip) => chip !== tag).join(', '))
  }

  const request = (word: string): void => {
    if (timer.current) clearTimeout(timer.current)
    if (word.trim().length < 2) {
      setItems([])
      close()
      return
    }

    timer.current = setTimeout(() => {
      const id = seq.current + 1
      seq.current = id
      setLoading(true)
      void onSuggest(word)
        .then((result) => {
          if (seq.current !== id) return
          const remaining = result.filter(
            (item) => !chips.some((chip) => chip.toLowerCase() === item.tag.toLowerCase())
          )
          setItems(remaining)
          setOpen(remaining.length > 0)
          setActive(-1)
        })
        .catch(() => {
          if (seq.current === id) setItems([])
        })
        .finally(() => {
          if (seq.current === id) setLoading(false)
        })
    }, 350)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (open && active >= 0 && items[active]) commit(items[active].tag)
      else commit(draft)
      return
    }
    if (event.key === 'Backspace' && !draft && chips.length > 0) {
      event.preventDefault()
      remove(chips[chips.length - 1])
      return
    }
    if (!open || items.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((previous) => (previous + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((previous) => (previous <= 0 ? items.length - 1 : previous - 1))
    } else if (event.key === 'Escape') {
      close()
    }
  }

  return (
    <div ref={box} className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring">
        {chips.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
          >
            {chip}
            <button
              type="button"
              aria-label={`移除 ${chip}`}
              onClick={() => remove(chip)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => {
            const next = event.target.value
            // 输入逗号时把草稿转为芯片；支持一次粘贴多个标签
            if (next.includes(',') || next.includes('，')) {
              const merged = [...chips]
              splitTags(next).forEach((tag) => {
                if (!merged.some((chip) => chip.toLowerCase() === tag.toLowerCase())) {
                  merged.push(tag)
                }
              })
              onChange(merged.join(', '))
              setDraft('')
              setItems([])
              close()
              return
            }
            setDraft(next)
            request(next)
          }}
          onFocus={() => {
            if (items.length > 0) setOpen(true)
            else request(draft)
          }}
          onKeyDown={onKeyDown}
          placeholder={chips.length === 0 ? placeholder : undefined}
          autoComplete="off"
          spellCheck={false}
          className="min-w-20 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/60"
        />
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {open && items.length > 0 ? (
        <div className="scrollbar-thin absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl">
          <p className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            标签建议
          </p>
          {items.map((item, index) => (
            <button
              key={`${item.tag}-${index}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(item.tag)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                index === active ? 'bg-secondary text-foreground' : 'text-foreground/85'
              )}
            >
              <span className="truncate">{item.tag}</span>
              {item.translation ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {item.translation}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 左栏抓取面板：只放与「抓取作品」直接相关的参数与操作 */
export function CollectPanel(props: CollectPanelProps): React.JSX.Element {
  const { config, selfUser, hasCookie } = props

  // 模板非法时禁用下载，避免生成无法解析的文件名
  const templateError = validateTemplate(config.fileNameTemplate)

  const setTagMode = (mode: TagMode): void => props.onConfigChange({ tagMode: mode })

  /** 下载质量：常规图（约 1200px）与高清原图，动图统一保存为 zip */
  const qualityOptions: { value: ImageQuality; label: string; icon: React.JSX.Element }[] = [
    { value: 'regular', label: '常规图', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { value: 'original', label: '高清原图', icon: <Gem className="h-3.5 w-3.5" /> }
  ]
  const qualityLabel = config.imageQuality === 'original' ? '高清原图' : '常规图'

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>抓取设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => props.onConfigChange({ source: 'tag' })}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                  config.source === 'tag'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <UserRound className="h-3.5 w-3.5" />
                作者标签
              </button>
              <button
                type="button"
                onClick={() => props.onConfigChange({ source: 'bookmarks' })}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                  config.source === 'bookmarks'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Bookmark className="h-3.5 w-3.5" />
                我的收藏
              </button>
            </div>

            {config.source === 'tag' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="用户 ID">
                  <Input
                    value={config.userId}
                    onChange={(event) => props.onConfigChange({ userId: event.target.value })}
                    placeholder="114638697"
                  />
                </Field>
                <Field label="标签">
                  <TagInput
                    value={config.tag}
                    onChange={(value) => props.onConfigChange({ tag: value })}
                    onSuggest={props.onSuggestTags}
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="收藏用户 ID"
                  hint={
                    selfUser
                      ? `当前登录：${selfUser.name}（${selfUser.id}）`
                      : '留空则使用当前登录账号'
                  }
                >
                  <Input
                    value={config.bookmarkUserId}
                    onChange={(event) =>
                      props.onConfigChange({ bookmarkUserId: event.target.value })
                    }
                    placeholder={selfUser?.id ?? '留空=当前登录'}
                  />
                </Field>
                <Field label="收藏类型">
                  <Select
                    value={config.bookmarkRest}
                    onChange={(value) =>
                      props.onConfigChange({ bookmarkRest: value as BookmarkRest })
                    }
                  >
                    <option value="show">公开收藏</option>
                    <option value="hide">私密收藏</option>
                  </Select>
                </Field>
              </div>
            )}

            {config.source === 'bookmarks' ? (
              <>
                <Field label="标签（可选）" hint="只同步该标签下的收藏，留空则全部">
                  <TagInput
                    value={config.bookmarkTag}
                    onChange={(value) => props.onConfigChange({ bookmarkTag: value })}
                    onSuggest={props.onSuggestTags}
                  />
                </Field>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={config.bookmarkOnlyNew}
                    onChange={(event) =>
                      props.onConfigChange({ bookmarkOnlyNew: event.target.checked })
                    }
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  只同步未下载的作品（增量同步）
                </label>
              </>
            ) : null}

            <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Tags className="h-3.5 w-3.5 text-primary" />
                  多标签组合
                </span>
                <div className="flex items-center gap-0.5 rounded-md bg-secondary/60 p-0.5">
                  {(
                    [
                      { value: 'and', label: '同时满足' },
                      { value: 'or', label: '任一满足' }
                    ] as { value: TagMode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setTagMode(item.value)}
                      className={cn(
                        'rounded px-2 py-0.5 text-[11px] transition-colors',
                        config.tagMode === item.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field
                label="附加包含标签"
                hint={
                  config.source === 'bookmarks' && !config.bookmarkTag.trim()
                    ? '收藏标签为空时，将先抓取全部收藏再按标签筛选'
                    : config.tagMode === 'and'
                      ? '作品需同时包含主标签与这些标签'
                      : '包含任一标签即可；会逐个标签抓取，请求量随标签数增加'
                }
              >
                <TagListInput
                  value={config.tagExtra}
                  onChange={(value) => props.onConfigChange({ tagExtra: value })}
                  onSuggest={props.onSuggestTags}
                  placeholder="输入后回车，例如：オリジナル"
                />
              </Field>
              <Field label="排除标签" hint="作品包含任意一个排除标签时丢弃">
                <TagListInput
                  value={config.tagExclude}
                  onChange={(value) => props.onConfigChange({ tagExclude: value })}
                  onSuggest={props.onSuggestTags}
                  placeholder="输入后回车，例如：漫画"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="偏移量">
                <Input
                  type="number"
                  min={0}
                  value={config.offset}
                  onChange={(event) =>
                    props.onConfigChange({ offset: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </Field>
              <Field label="每页数量" hint="也是翻页步长">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={config.limit}
                  onChange={(event) =>
                    props.onConfigChange({
                      limit: Math.max(1, Math.min(100, Number(event.target.value) || 1))
                    })
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="并发数" hint="同时解析/下载的任务数">
                <Input
                  type="number"
                  min={1}
                  max={32}
                  value={config.workers}
                  onChange={(event) =>
                    props.onConfigChange({
                      workers: Math.max(1, Math.min(32, Number(event.target.value) || 1))
                    })
                  }
                />
              </Field>
              <Field label="请求间隔（秒）">
                <Input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={config.delay}
                  onChange={(event) =>
                    props.onConfigChange({
                      delay: Math.max(0, Math.min(5, Number(event.target.value) || 0))
                    })
                  }
                />
              </Field>
            </div>
          </CardContent>
        </Card>

      </div>

      <Separator className="my-3" />

      <div className="space-y-2">
        <Button
          className="w-full"
          variant="secondary"
          disabled={
            props.collecting ||
            props.running ||
            (config.source === 'bookmarks' &&
              !hasCookie &&
              !config.bookmarkUserId.trim())
          }
          onClick={props.onCollect}
        >
          {props.collecting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {props.collecting
            ? config.source === 'bookmarks'
              ? '正在同步收藏夹…'
              : '正在抓取作品列表…'
            : config.source === 'bookmarks'
              ? '同步收藏夹'
              : '抓取作品列表'}
        </Button>
        {config.source === 'bookmarks' && !hasCookie && !config.bookmarkUserId.trim() ? (
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            同步自己的收藏需要先配置 Cookie，或手动填写收藏用户 ID
          </p>
        ) : null}
        {config.source === 'tag' ? (
          <Button
            className="w-full"
            variant="outline"
            disabled={props.collecting || !hasCookie}
            onClick={props.onOpenFollowing}
          >
            <Users />
            从关注列表选择画师
          </Button>
        ) : null}
        {config.source === 'tag' && !hasCookie ? (
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            读取关注列表需要先配置 Cookie
          </p>
        ) : null}

        <div className="space-y-1.5 rounded-lg border border-border/60 bg-secondary/10 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">下载质量</span>
            <div className="flex items-center gap-0.5 rounded-md bg-secondary/60 p-0.5">
              {qualityOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => props.onConfigChange({ imageQuality: option.value })}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors',
                    config.imageQuality === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={
              props.running ||
              props.collecting ||
              props.selectedCount === 0 ||
              !hasCookie ||
              Boolean(templateError)
            }
            onClick={props.onDownload}
          >
            {props.running ? <Loader2 className="animate-spin" /> : <Download />}
            下载{qualityLabel}（{props.selectedCount}）
          </Button>
          <p className="text-[10px] leading-4 text-muted-foreground/70">
            常规图约 1200px，高清原图为作品原始尺寸；动图作品统一保存为 .zip
          </p>
        </div>
        {templateError ? (
          <p className="text-[11px] leading-4 text-destructive">
            文件名模板无效：{templateError}
          </p>
        ) : null}
        {props.running ? (
          <Button className="w-full" variant="outline" onClick={props.onCancel}>
            <Square className="h-3.5 w-3.5" />
            暂停下载（可续传）
          </Button>
        ) : null}
      </div>
    </div>
  )
}
