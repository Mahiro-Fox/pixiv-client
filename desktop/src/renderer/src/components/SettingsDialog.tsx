import {
  Cookie,
  FolderOpen,
  FolderSearch,
  Gem,
  Image as ImageIcon,
  Loader2,
  Settings2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type { AppConfig, CookieStatus, ImageQuality, SelfUser } from '@shared/types'
import {
  DEFAULT_FILE_TEMPLATE,
  TEMPLATE_TOKENS,
  renderFileName,
  validateTemplate
} from '@shared/template'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Textarea } from './ui/input'

interface SettingsDialogProps {
  config: AppConfig
  cookie: CookieStatus | null
  selfUser: SelfUser | null
  onConfigChange: (patch: Partial<AppConfig>) => void
  onSaveCookie: (raw: string) => Promise<void>
  onPickDir: () => void
  onOpenDir: () => void
  onClose: () => void
}

/** 与主进程落盘时的标签目录保持一致：收藏夹统一用「收藏夹」 */
function worksTagOf(config: AppConfig): string {
  return config.source === 'bookmarks' ? '收藏夹' : config.tag
}

function cookieSourceLabel(source: CookieStatus['source']): string {
  if (source === 'env') return '来自环境变量'
  if (source === 'file') return '来自本地文件'
  return '未配置'
}

const QUALITY_OPTIONS: { value: ImageQuality; label: string; hint: string; icon: React.JSX.Element }[] = [
  {
    value: 'regular',
    label: '常规图',
    hint: '约 1200px，体积小，适合浏览与备份',
    icon: <ImageIcon className="h-3.5 w-3.5" />
  },
  {
    value: 'original',
    label: '高清原图',
    hint: '作品原始尺寸，体积更大，适合收藏',
    icon: <Gem className="h-3.5 w-3.5" />
  }
]

/** 设置弹窗：下载质量、保存目录、文件名模板与 Cookie 等全局设置 */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element {
  const { config } = props
  const templateRef = useRef<HTMLInputElement | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [savingCookie, setSavingCookie] = useState(false)

  useEffect(() => {
    if (!props.cookie?.hasCookie) setCookieInput('')
  }, [props.cookie?.hasCookie])

  const saveCookie = async (): Promise<void> => {
    if (!cookieInput.trim()) return
    setSavingCookie(true)
    try {
      await props.onSaveCookie(cookieInput)
      setCookieInput('')
    } finally {
      setSavingCookie(false)
    }
  }

  const templateError = validateTemplate(config.fileNameTemplate)
  const templatePreview = renderFileName(config.fileNameTemplate || DEFAULT_FILE_TEMPLATE, {
    id: '122784064',
    title: '示例标题 ~ 100%',
    author: props.selfUser?.name || '画师名',
    userid: config.userId || '114638697',
    tag: worksTagOf(config),
    page: 1,
    date: '2026-01-02T03:04:05+09:00',
    ext: '.jpg'
  })

  /** 点击变量按钮：在光标处插入占位符，保持用户正在编辑的位置 */
  const insertToken = (token: string): void => {
    const input = templateRef.current
    const current = config.fileNameTemplate
    if (!input) {
      props.onConfigChange({ fileNameTemplate: `${current}${token}` })
      return
    }
    const start = input.selectionStart ?? current.length
    const end = input.selectionEnd ?? current.length
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`
    props.onConfigChange({ fileNameTemplate: next })
    requestAnimationFrame(() => {
      input.focus()
      const caret = start + token.length
      input.setSelectionRange(caret, caret)
    })
  }

  return (
    <Dialog
      title="设置"
      description="下载质量、保存目录、文件名模板与 Cookie 等全局设置"
      icon={<Settings2 className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
      footer={
        <Button size="sm" onClick={props.onClose}>
          完成
        </Button>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">下载质量</h3>
            <span className="text-[11px] text-muted-foreground">下载前也可在左栏快速切换</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => props.onConfigChange({ imageQuality: option.value })}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                  config.imageQuality === option.value
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/70 bg-background/60 hover:border-border'
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-xs font-medium ${
                    config.imageQuality === option.value ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </span>
                <span className="text-[10px] leading-4 text-muted-foreground">{option.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            动图（ugoira）作品不区分质量，统一保存为 pixiv 提供的帧压缩包（.zip）
          </p>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">保存目录</h3>
            <span className="text-[11px] text-muted-foreground">按「标签 / 作者」两级存放</span>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground break-all">
            {config.outDir}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={props.onPickDir}>
              <FolderSearch />
              选择目录
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={props.onOpenDir}>
              <FolderOpen />
              打开目录
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">文件名模板</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => props.onConfigChange({ fileNameTemplate: DEFAULT_FILE_TEMPLATE })}
            >
              恢复默认
            </Button>
          </div>
          <Input
            ref={templateRef}
            value={config.fileNameTemplate}
            spellCheck={false}
            placeholder={DEFAULT_FILE_TEMPLATE}
            onChange={(event) => props.onConfigChange({ fileNameTemplate: event.target.value })}
          />
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_TOKENS.map((item) => (
              <button
                key={item.token}
                type="button"
                title={`${item.label}，示例：${item.example}`}
                onClick={() => insertToken(item.token)}
                className="rounded border border-border/70 bg-secondary/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {item.token}
              </button>
            ))}
          </div>
          <p className="break-all rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
            预览：<span className="text-foreground/90">{templatePreview}</span>
          </p>
          {templateError ? (
            <p className="text-[11px] leading-4 text-destructive">{templateError}</p>
          ) : (
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              未写 {'{ext}'} 时自动追加扩展名；非法字符会被替换，超过 120 字符会截断
            </p>
          )}
        </section>

        <section className="space-y-2.5 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Cookie className="h-4 w-4 text-primary" />
              Cookie
            </h3>
            <Badge variant={props.cookie?.hasCookie ? 'success' : 'destructive'}>
              {props.cookie?.hasCookie ? '已配置' : '未配置'}
            </Badge>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {props.cookie?.hasCookie
              ? `${cookieSourceLabel(props.cookie.source)} · ${props.cookie.masked}`
              : '未登录时 R-18 作品会被 pixiv 过滤，建议先配置 PHPSESSID'}
          </p>
          {props.selfUser ? (
            <p className="text-[11px] leading-4 text-muted-foreground/80">
              当前登录：{props.selfUser.name}（{props.selfUser.id}）
            </p>
          ) : null}
          <Textarea
            value={cookieInput}
            onChange={(event) => setCookieInput(event.target.value)}
            placeholder="粘贴 PHPSESSID=... 或完整 Cookie"
            spellCheck={false}
          />
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={!cookieInput.trim() || savingCookie}
            onClick={() => void saveCookie()}
          >
            {savingCookie ? <Loader2 className="animate-spin" /> : <Cookie />}
            保存 Cookie
          </Button>
        </section>
      </div>
    </Dialog>
  )
}
