import {
  Bookmark,
  Download,
  Gem,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Tags,
  UserRound,
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
import { useI18n } from '@renderer/i18n'
import type { MessageKey } from '@renderer/i18n'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Field } from './ui/field'
import { Select } from './ui/select'
import { Input } from './ui/input'
import { Separator } from './ui/separator'

interface CollectPanelProps {
  config: AppConfig
  selfUser: SelfUser | null
  hasCookie: boolean
  collecting: boolean
  /** 队列里是否已有未完成任务：决定按钮文案是「下载」还是「添加到任务队列」 */
  queued: boolean
  selectedCount: number
  onConfigChange: (patch: Partial<AppConfig>) => void
  onCollect: () => void
  onDownload: () => void
  onSuggestTags: (word: string) => Promise<TagSuggestion[]>
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
  const { t } = useI18n()
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
            {t('collect.tagSuggest')}
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
  const { t } = useI18n()
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
              aria-label={t('collect.removeTag', { tag: chip })}
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
            {t('collect.tagSuggest')}
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
  const { t } = useI18n()
  const { config, selfUser, hasCookie } = props

  // 模板非法时禁用下载，避免生成无法解析的文件名
  const templateError = validateTemplate(config.fileNameTemplate)

  /**
   * 填了别人的收藏用户 ID 时，私密收藏必然拿不到（pixiv 返回 403 没权限），
   * 所以直接把类型收敛成公开收藏并锁住私密选项，避免用户白跑一次。
   * 只在自己 ID 已知且确实不同时才判定为「他人」，
   * 否则收藏夹资料还没取到时，用户填自己的 ID 会被误锁。
   */
  const otherUserId =
    config.bookmarkUserId.trim() !== '' &&
    Boolean(selfUser?.id) &&
    config.bookmarkUserId.trim() !== selfUser?.id

  useEffect(() => {
    if (otherUserId && config.bookmarkRest !== 'show') {
      props.onConfigChange({ bookmarkRest: 'show' })
    }
  }, [otherUserId, config.bookmarkRest, props])

  const setTagMode = (mode: TagMode): void => props.onConfigChange({ tagMode: mode })

  /** 下载质量：常规图（约 1200px）与高清原图；动图格式在设置弹窗里调整 */
  const qualityOptions: {
    value: ImageQuality
    labelKey: MessageKey
    icon: React.JSX.Element
  }[] = [
    { value: 'regular', labelKey: 'collect.qualityRegular', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { value: 'original', labelKey: 'collect.qualityOriginal', icon: <Gem className="h-3.5 w-3.5" /> }
  ]
  const qualityLabelKey: MessageKey =
    config.imageQuality === 'original' ? 'collect.qualityOriginal' : 'collect.qualityRegular'

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{t('collect.settings')}</CardTitle>
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
                {t('collect.sourceTag')}
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
                {t('collect.sourceBookmarks')}
              </button>
            </div>

            {config.source === 'tag' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('collect.userId')} required>
                  <Input
                    value={config.userId}
                    onChange={(event) => props.onConfigChange({ userId: event.target.value })}
                    placeholder="114638697"
                  />
                </Field>
                <Field label={t('collect.tag')}>
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
                  label={t('collect.bookmarkUserId')}
                  hint={
                    selfUser
                      ? t('collect.currentUser', { name: selfUser.name, id: selfUser.id })
                      : t('collect.bookmarkUserIdFallback')
                  }
                >
                  <Input
                    value={config.bookmarkUserId}
                    onChange={(event) =>
                      props.onConfigChange({ bookmarkUserId: event.target.value })
                    }
                    placeholder={selfUser?.id ?? t('collect.bookmarkUserIdPlaceholder')}
                  />
                </Field>
                <Field
                  label={t('collect.bookmarkType')}
                  hint={otherUserId ? t('collect.bookmarkOtherUserHint') : undefined}
                >
                  <Select
                    value={config.bookmarkRest}
                    onChange={(value) =>
                      props.onConfigChange({ bookmarkRest: value as BookmarkRest })
                    }
                    options={[
                      { value: 'show', label: t('collect.bookmarkShow') },
                      { value: 'hide', label: t('collect.bookmarkHide'), disabled: otherUserId }
                    ]}
                  />
                </Field>
              </div>
            )}

            {config.source === 'bookmarks' ? (
              <>
                <Field label={t('collect.tagOptional')} hint={t('collect.bookmarkTagHint')}>
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
                  {t('collect.onlyNew')}
                </label>
              </>
            ) : null}

            <div className="space-y-3 rounded-lg border border-border/60 bg-secondary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Tags className="h-3.5 w-3.5 text-primary" />
                  {t('collect.tagCombine')}
                </span>
                <div className="flex items-center gap-0.5 rounded-md bg-secondary/60 p-0.5">
                  {(
                    [
                      { value: 'and', labelKey: 'collect.tagModeAnd' },
                      { value: 'or', labelKey: 'collect.tagModeOr' }
                    ] as { value: TagMode; labelKey: MessageKey }[]
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
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <Field
                label={t('collect.tagExtra')}
                hint={
                  config.source === 'bookmarks' && !config.bookmarkTag.trim()
                    ? t('collect.tagExtraHintBookmark')
                    : config.tagMode === 'and'
                      ? t('collect.tagExtraHintAnd')
                      : t('collect.tagExtraHintOr')
                }
              >
                <TagListInput
                  value={config.tagExtra}
                  onChange={(value) => props.onConfigChange({ tagExtra: value })}
                  onSuggest={props.onSuggestTags}
                  placeholder={t('collect.tagExtraPlaceholder')}
                />
              </Field>
              <Field label={t('collect.tagExclude')} hint={t('collect.tagExcludeHint')}>
                <TagListInput
                  value={config.tagExclude}
                  onChange={(value) => props.onConfigChange({ tagExclude: value })}
                  onSuggest={props.onSuggestTags}
                  placeholder={t('collect.tagExcludePlaceholder')}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('collect.offset')}>
                <Input
                  type="number"
                  min={0}
                  value={config.offset}
                  onChange={(event) =>
                    props.onConfigChange({ offset: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </Field>
              <Field label={t('collect.limit')} hint={t('collect.limitHint')}>
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
              <Field label={t('collect.workers')} hint={t('collect.workersHint')}>
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
              <Field label={t('collect.delay')}>
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
            (config.source === 'tag' && !config.userId.trim()) ||
            (config.source === 'bookmarks' &&
              !hasCookie &&
              !config.bookmarkUserId.trim())
          }
          onClick={props.onCollect}
        >
          {props.collecting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {props.collecting
            ? config.source === 'bookmarks'
              ? t('collect.syncingBookmarks')
              : t('collect.collectingWorks')
            : config.source === 'bookmarks'
              ? t('collect.syncBookmarks')
              : t('collect.collectWorks')}
        </Button>
        {config.source === 'bookmarks' && !hasCookie && !config.bookmarkUserId.trim() ? (
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('collect.bookmarkLoginHint')}
          </p>
        ) : null}
        {config.source === 'tag' && !hasCookie ? (
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('collect.followingLoginHint')}
          </p>
        ) : null}

        <div className="space-y-1.5 rounded-lg border border-border/60 bg-secondary/10 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('collect.quality')}</span>
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
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={
              props.collecting || props.selectedCount === 0 || !hasCookie || Boolean(templateError)
            }
            onClick={props.onDownload}
          >
            <Download />
            {props.queued
              ? t('collect.enqueue', { count: props.selectedCount })
              : t('collect.download', { quality: t(qualityLabelKey), count: props.selectedCount })}
          </Button>
          <p className="text-[10px] leading-4 text-muted-foreground/70">
            {t('collect.qualityNote')}
          </p>
        </div>
        {templateError ? (
          <p className="text-[11px] leading-4 text-destructive">
            {t('collect.templateInvalid', { error: templateError })}
          </p>
        ) : null}
      </div>
    </div>
  )
}
