import {
  Cookie,
  Download,
  FileArchive,
  Film,
  FolderOpen,
  FolderSearch,
  Gauge,
  Gem,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Loader2,
  LogIn,
  Minus,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type {
  AppConfig,
  CookieStatus,
  ImageQuality,
  Locale,
  OAuthCredentials,
  OAuthStatus,
  ProxyConfig,
  ProxyProtocol,
  ProxyState,
  ProxyTestResult,
  SelfUser,
  ThemeMode,
  UgoiraFormat,
  UpdateStatus
} from '@shared/types'
import {
  DEFAULT_FILE_TEMPLATE,
  TEMPLATE_TOKENS,
  renderFileName,
  validateTemplate
} from '@shared/template'
import { DEFAULT_THROTTLE_LIMITS, THROTTLE_RANGES } from '@shared/throttle'
import { TOKEN_LABEL_KEYS, useI18n } from '@renderer/i18n'
import type { Translate } from '@renderer/i18n'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Field } from './ui/field'
import { Select } from './ui/select'

import { Input, Textarea } from './ui/input'

interface SettingsDialogProps {
  config: AppConfig
  cookie: CookieStatus | null
  selfUser: SelfUser | null
  /** 代理配置与生效状态；密码本身不会传给渲染层 */
  proxy: ProxyState | null
  onConfigChange: (patch: Partial<AppConfig>) => void
  /** 保存并立即应用代理；password 传 undefined 表示保持原密码，空串表示清除 */
  onSaveProxy: (patch: Partial<ProxyConfig>, password?: string) => Promise<ProxyState>
  onTestProxy: () => Promise<ProxyTestResult>
  onSaveCookie: (raw: string) => Promise<void>
  /** 打开应用内 pixiv 登录窗口；返回 false 表示用户取消了登录 */
  onLogin: () => Promise<boolean>
  /** 清除已保存的 Cookie，并重置登录窗口的会话 */
  onClearCookie: () => Promise<void>
  /** App API（OAuth）连接状态；写操作需要它 */
  oauth: OAuthStatus | null
  /** 保存并校验凭据：主进程会先刷新一次，失败不落盘 */
  onSaveOAuth: (credentials: OAuthCredentials) => Promise<void>
  /** 打开 pixiv 授权页，用 PKCE 自动换取 refresh_token；返回 false 表示用户取消 */
  onLoginOAuth: (clientId: string, clientSecret: string) => Promise<boolean>
  onClearOAuth: () => Promise<void>
  onPickDir: () => void
  onOpenDir: () => void
  onClose: () => void
}

/** 与主进程落盘时的标签目录保持一致：收藏夹统一用「收藏夹」 */
function worksTagOf(config: AppConfig): string {
  return config.source === 'bookmarks' ? '收藏夹' : config.tag
}

function cookieSourceLabel(t: Translate, source: CookieStatus['source']): string {
  if (source === 'env') return t('settings.cookie.sourceEnv')
  if (source === 'file') return t('settings.cookie.sourceFile')
  return t('settings.cookie.sourceNone')
}

/** 更新状态 → 界面文案 */
function updateText(t: Translate, status: UpdateStatus): string {
  if (status.state === 'checking') return t('settings.update.checking')
  if (status.state === 'available') return t('settings.update.available', { version: status.version })
  if (status.state === 'downloading') {
    return t('settings.update.downloading', { percent: status.percent })
  }
  if (status.state === 'downloaded') return t('settings.update.downloaded', { version: status.version })
  if (status.state === 'up-to-date') return t('settings.update.upToDate')
  if (status.state === 'error') return t('settings.update.error', { message: status.message })
  if (status.state === 'unsupported') return t('settings.update.unsupported')
  return t('settings.update.idle')
}

/** 单选卡片：主题、语言、质量、动图格式共用一套样式 */
function OptionCard(props: {
  active: boolean
  icon: React.JSX.Element
  label: string
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        props.active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border/70 bg-background/60 hover:border-border'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs font-medium ${
          props.active ? 'text-primary' : 'text-foreground'
        }`}
      >
        {props.icon}
        {props.label}
      </span>
      {props.hint ? (
        <span className="text-[10px] leading-4 text-muted-foreground">{props.hint}</span>
      ) : null}
    </button>
  )
}

/** 限流参数加减器：只走合法区间内的步进，避免输入框被清空时写入 0 */
function NumberStepper(props: {
  label: string
  hint: string
  decreaseLabel: string
  increaseLabel: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const clamp = (next: number): number => Math.max(props.min, Math.min(props.max, next))
  const buttonClass =
    'flex h-5 w-5 items-center justify-center rounded border border-border/70 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{props.label}</p>
        <p className="truncate text-[10px] text-muted-foreground">{props.hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={props.decreaseLabel}
          disabled={props.value <= props.min}
          className={buttonClass}
          onClick={() => props.onChange(clamp(props.value - props.step))}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-14 text-center text-xs tabular-nums">
          {props.value}
          <span className="text-[10px] text-muted-foreground">{props.unit}</span>
        </span>
        <button
          type="button"
          aria-label={props.increaseLabel}
          disabled={props.value >= props.max}
          className={buttonClass}
          onClick={() => props.onChange(clamp(props.value + props.step))}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/** 设置弹窗：主题、语言、下载质量、保存目录、文件名模板与 Cookie 等全局设置 */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element {
  const { config } = props
  const { t } = useI18n()
  const templateRef = useRef<HTMLInputElement | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [savingCookie, setSavingCookie] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginCancelled, setLoginCancelled] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  /** App API 凭据表单：一次填三项，保存时主进程会先刷新校验 */
  const [oauthForm, setOAuthForm] = useState<OAuthCredentials>({
    clientId: '',
    clientSecret: '',
    refreshToken: ''
  })
  const [savingOAuth, setSavingOAuth] = useState(false)
  const [oauthError, setOAuthError] = useState('')
  /** 授权登录的结果提示（成功 / 取消），与错误分开显示 */
  const [oauthNotice, setOAuthNotice] = useState('')
  const [confirmingOAuthClear, setConfirmingOAuthClear] = useState(false)

  // 版本与更新：主进程在启动后会自动检查，这里只负责展示与手动触发
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  // 后台下载期间不禁用「检查更新」：下载可能持续一阵，没必要让按钮一直转圈；
  // 此时点它只会拿到当前状态，主进程不会重复触发下载
  const updateBusy = checkingUpdate || updateStatus.state === 'checking'

  useEffect(() => {
    let alive = true
    void window.pixiv.getVersion().then((value) => {
      if (alive) setVersion(value)
    })
    void window.pixiv.getUpdateStatus().then((value) => {
      if (alive) setUpdateStatus(value)
    })
    const unsubscribe = window.pixiv.onUpdateStatus((value) => setUpdateStatus(value))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const checkUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      setUpdateStatus(await window.pixiv.checkForUpdates())
    } finally {
      setCheckingUpdate(false)
    }
  }

  // 代理表单：文本框在失焦时提交，避免每敲一个字符就重设一次 session
  const proxyConfig = props.proxy?.config ?? config.proxy
  const proxyIsSocks =
    proxyConfig.protocol === 'socks4' || proxyConfig.protocol === 'socks5'
  const [proxyHost, setProxyHost] = useState(proxyConfig.host)
  const [proxyPort, setProxyPort] = useState(proxyConfig.port ? String(proxyConfig.port) : '')
  const [proxyUsername, setProxyUsername] = useState(proxyConfig.username)
  const [proxyBypass, setProxyBypass] = useState(proxyConfig.bypassRules)
  const [proxyPassword, setProxyPassword] = useState('')
  const [proxyBusy, setProxyBusy] = useState(false)
  const [proxyError, setProxyError] = useState('')
  const [proxyTesting, setProxyTesting] = useState(false)
  const [proxyTest, setProxyTest] = useState<ProxyTestResult | null>(null)

  const proxyQueue = useRef<Promise<unknown>>(Promise.resolve())

  // 主进程应用后会把规范化的值回传，这里跟着同步一次
  useEffect(() => {
    setProxyHost(proxyConfig.host)
    setProxyPort(proxyConfig.port ? String(proxyConfig.port) : '')
    setProxyUsername(proxyConfig.username)
    setProxyBypass(proxyConfig.bypassRules)
  }, [proxyConfig.host, proxyConfig.port, proxyConfig.username, proxyConfig.bypassRules])

  /**
   * 串行提交：失焦与开关点击可能几乎同时触发，两个「读-改-写」
   * 并发落盘会互相覆盖（例如刚填的主机被开关的旧快照写回）。
   */
  const commitProxy = (
    patch: Partial<ProxyConfig>,
    password?: string
  ): Promise<void> => {
    const task = proxyQueue.current.then(async () => {
      setProxyBusy(true)
      setProxyError('')
      try {
        await props.onSaveProxy(patch, password)
      } catch (reason) {
        setProxyError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        setProxyBusy(false)
      }
    })
    proxyQueue.current = task
    return task
  }

  /** 密码留空视为不修改，避免用户只是路过输入框就把已保存的密码清掉 */
  const commitProxyPassword = (): void => {
    const value = proxyPassword.trim()
    if (!value) return
    setProxyPassword('')
    void commitProxy({}, value)
  }

  const runProxyTest = async (): Promise<void> => {
    setProxyTesting(true)
    setProxyTest(null)
    try {
      setProxyTest(await props.onTestProxy())
    } catch (reason) {
      setProxyTest({
        ok: false,
        latencyMs: 0,
        message: reason instanceof Error ? reason.message : String(reason)
      })
    } finally {
      setProxyTesting(false)
    }
  }

  const proxyIncomplete = !proxyConfig.host || proxyConfig.port <= 0

  // Cookie 存在且能解析出账号，才算真正「已登录」
  const loggedIn = Boolean(props.cookie?.hasCookie && props.selfUser)

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

  const login = async (): Promise<void> => {
    setLoggingIn(true)
    setLoginCancelled(false)
    try {
      // 登录窗口是独立窗口，用户在那边输完密码；这里只负责等待结果
      const ok = await props.onLogin()
      setLoginCancelled(!ok)
    } finally {
      setLoggingIn(false)
    }
  }

  const clearCookie = async (): Promise<void> => {
    setClearing(true)
    try {
      await props.onClearCookie()
      setConfirmingClear(false)
      setLoginCancelled(false)
    } finally {
      setClearing(false)
    }
  }

  const saveOAuth = async (): Promise<void> => {
    setSavingOAuth(true)
    setOAuthError('')
    setOAuthNotice('')
    try {
      await props.onSaveOAuth(oauthForm)
      // 保存成功后清空表单，避免密钥长时间留在界面里
      setOAuthForm({ clientId: '', clientSecret: '', refreshToken: '' })
    } catch (reason) {
      setOAuthError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setSavingOAuth(false)
    }
  }

  /** 打开 pixiv 授权页登录：把 code 换成的 refresh_token 直接落盘，无需手填 */
  const loginOAuth = async (): Promise<void> => {
    setSavingOAuth(true)
    setOAuthError('')
    setOAuthNotice('')
    try {
      const ok = await props.onLoginOAuth(
        oauthForm.clientId.trim(),
        oauthForm.clientSecret.trim()
      )
      if (!ok) {
        setOAuthNotice(t('settings.oauth.loginCanceled'))
        return
      }
      setOAuthForm({ clientId: '', clientSecret: '', refreshToken: '' })
      setOAuthNotice(t('settings.oauth.loginDone'))
    } catch (reason) {
      setOAuthError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setSavingOAuth(false)
    }
  }

  const clearOAuth = async (): Promise<void> => {
    setSavingOAuth(true)
    try {
      await props.onClearOAuth()
      setConfirmingOAuthClear(false)
      setOAuthError('')
    } finally {
      setSavingOAuth(false)
    }
  }

  const themeOptions: { value: ThemeMode; label: string; icon: React.JSX.Element }[] = [
    { value: 'light', label: t('theme.light'), icon: <Sun className="h-3.5 w-3.5" /> },
    { value: 'dark', label: t('theme.dark'), icon: <Moon className="h-3.5 w-3.5" /> },
    { value: 'system', label: t('theme.system'), icon: <Monitor className="h-3.5 w-3.5" /> }
  ]
  const localeOptions: { value: Locale; label: string }[] = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' }
  ]

  const qualityOptions: {
    value: ImageQuality
    label: string
    hint: string
    icon: React.JSX.Element
  }[] = [
    {
      value: 'regular',
      label: t('settings.quality.regular'),
      hint: t('settings.quality.regularHint'),
      icon: <ImageIcon className="h-3.5 w-3.5" />
    },
    {
      value: 'original',
      label: t('settings.quality.original'),
      hint: t('settings.quality.originalHint'),
      icon: <Gem className="h-3.5 w-3.5" />
    }
  ]

  const ugoiraOptions: {
    value: UgoiraFormat
    label: string
    hint: string
    icon: React.JSX.Element
  }[] = [
    {
      value: 'mp4',
      label: t('settings.ugoira.mp4'),
      hint: t('settings.ugoira.mp4Hint'),
      icon: <Film className="h-3.5 w-3.5" />
    },
    {
      value: 'gif',
      label: t('settings.ugoira.gif'),
      hint: t('settings.ugoira.gifHint'),
      icon: <ImageIcon className="h-3.5 w-3.5" />
    },
    {
      value: 'zip',
      label: t('settings.ugoira.zip'),
      hint: t('settings.ugoira.zipHint'),
      icon: <FileArchive className="h-3.5 w-3.5" />
    }
  ]

  const templateError = validateTemplate(config.fileNameTemplate)
  const templatePreview = renderFileName(config.fileNameTemplate || DEFAULT_FILE_TEMPLATE, {
    id: '122784064',
    title: t('settings.template.sampleTitle'),
    author: props.selfUser?.name || t('settings.template.sampleAuthor'),
    userid: config.userId || '114638697',
    tag: worksTagOf(config),
    page: 1,
    date: '2026-01-02T03:04:05+09:00',
    quality: config.imageQuality,
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
      title={t('settings.title')}
      description={t('settings.description')}
      icon={<Settings2 className="h-4 w-4 text-primary" />}
      onClose={props.onClose}
      footer={
        <Button size="sm" onClick={props.onClose}>
          {t('settings.done')}
        </Button>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Languages className="h-4 w-4 text-primary" />
              {t('settings.appearance.title')}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {t('settings.appearance.summary')}
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">{t('settings.appearance.theme')}</p>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  active={config.theme === option.value}
                  icon={option.icon}
                  label={option.label}
                  onClick={() => props.onConfigChange({ theme: option.value })}
                />
              ))}
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('settings.appearance.themeHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              {t('settings.appearance.language')}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {localeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => props.onConfigChange({ locale: option.value })}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                    config.locale === option.value
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border/70 bg-background/60 text-foreground hover:border-border'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('settings.appearance.languageHint')}
            </p>
          </div>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('settings.quality.title')}</h3>
            <span className="text-[11px] text-muted-foreground">
              {t('settings.quality.hint')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {qualityOptions.map((option) => (
              <OptionCard
                key={option.value}
                active={config.imageQuality === option.value}
                icon={option.icon}
                label={option.label}
                hint={option.hint}
                onClick={() => props.onConfigChange({ imageQuality: option.value })}
              />
            ))}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('settings.quality.note')}
          </p>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('settings.ugoira.title')}</h3>
            <span className="text-[11px] text-muted-foreground">{t('settings.ugoira.hint')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ugoiraOptions.map((option) => (
              <OptionCard
                key={option.value}
                active={config.ugoiraFormat === option.value}
                icon={option.icon}
                label={option.label}
                hint={option.hint}
                onClick={() => props.onConfigChange({ ugoiraFormat: option.value })}
              />
            ))}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('settings.ugoira.note')}
          </p>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Gauge className="h-4 w-4 text-primary" />
              {t('settings.throttle.title')}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                props.onConfigChange({
                  throttleApiConcurrency: DEFAULT_THROTTLE_LIMITS.apiConcurrency,
                  throttleApiInterval: DEFAULT_THROTTLE_LIMITS.apiInterval,
                  throttleCdnConcurrency: DEFAULT_THROTTLE_LIMITS.cdnConcurrency,
                  throttleCdnInterval: DEFAULT_THROTTLE_LIMITS.cdnInterval,
                  // 与主进程默认配置保持一致
                  parallelJobs: 2
                })
              }
            >
              {t('settings.throttle.reset')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberStepper
              label={t('settings.throttle.parallelJobs')}
              hint={t('settings.throttle.parallelJobsHint')}
              decreaseLabel={t('settings.step.decrease', {
                label: t('settings.throttle.parallelJobs')
              })}
              increaseLabel={t('settings.step.increase', {
                label: t('settings.throttle.parallelJobs')
              })}
              value={config.parallelJobs}
              unit=""
              min={1}
              max={4}
              step={1}
              onChange={(value) => props.onConfigChange({ parallelJobs: value })}
            />
            <NumberStepper
              label={t('settings.throttle.apiConcurrency')}
              hint={t('settings.throttle.apiConcurrencyHint')}
              decreaseLabel={t('settings.step.decrease', {
                label: t('settings.throttle.apiConcurrency')
              })}
              increaseLabel={t('settings.step.increase', {
                label: t('settings.throttle.apiConcurrency')
              })}
              value={config.throttleApiConcurrency}
              unit=""
              min={THROTTLE_RANGES.apiConcurrency.min}
              max={THROTTLE_RANGES.apiConcurrency.max}
              step={THROTTLE_RANGES.apiConcurrency.step}
              onChange={(value) => props.onConfigChange({ throttleApiConcurrency: value })}
            />
            <NumberStepper
              label={t('settings.throttle.apiInterval')}
              hint={t('settings.throttle.intervalHint')}
              decreaseLabel={t('settings.step.decrease', {
                label: t('settings.throttle.apiInterval')
              })}
              increaseLabel={t('settings.step.increase', {
                label: t('settings.throttle.apiInterval')
              })}
              value={config.throttleApiInterval}
              unit="ms"
              min={THROTTLE_RANGES.apiInterval.min}
              max={THROTTLE_RANGES.apiInterval.max}
              step={THROTTLE_RANGES.apiInterval.step}
              onChange={(value) => props.onConfigChange({ throttleApiInterval: value })}
            />
            <NumberStepper
              label={t('settings.throttle.cdnConcurrency')}
              hint={t('settings.throttle.cdnConcurrencyHint')}
              decreaseLabel={t('settings.step.decrease', {
                label: t('settings.throttle.cdnConcurrency')
              })}
              increaseLabel={t('settings.step.increase', {
                label: t('settings.throttle.cdnConcurrency')
              })}
              value={config.throttleCdnConcurrency}
              unit=""
              min={THROTTLE_RANGES.cdnConcurrency.min}
              max={THROTTLE_RANGES.cdnConcurrency.max}
              step={THROTTLE_RANGES.cdnConcurrency.step}
              onChange={(value) => props.onConfigChange({ throttleCdnConcurrency: value })}
            />
            <NumberStepper
              label={t('settings.throttle.cdnInterval')}
              hint={t('settings.throttle.intervalHint')}
              decreaseLabel={t('settings.step.decrease', {
                label: t('settings.throttle.cdnInterval')
              })}
              increaseLabel={t('settings.step.increase', {
                label: t('settings.throttle.cdnInterval')
              })}
              value={config.throttleCdnInterval}
              unit="ms"
              min={THROTTLE_RANGES.cdnInterval.min}
              max={THROTTLE_RANGES.cdnInterval.max}
              step={THROTTLE_RANGES.cdnInterval.step}
              onChange={(value) => props.onConfigChange({ throttleCdnInterval: value })}
            />
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('settings.throttle.note')}
          </p>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('settings.outDir.title')}</h3>
            <span className="text-[11px] text-muted-foreground">{t('settings.outDir.hint')}</span>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground break-all">
            {config.outDir}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={props.onPickDir}>
              <FolderSearch />
              {t('settings.outDir.pick')}
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={props.onOpenDir}>
              <FolderOpen />
              {t('settings.outDir.open')}
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('settings.template.title')}</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => props.onConfigChange({ fileNameTemplate: DEFAULT_FILE_TEMPLATE })}
            >
              {t('settings.template.reset')}
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
            {TEMPLATE_TOKENS.map((item) => {
              const labelKey = TOKEN_LABEL_KEYS[item.token]
              const label = labelKey ? t(labelKey) : item.label
              return (
                <button
                  key={item.token}
                  type="button"
                  title={t('settings.template.tooltip', { label, example: item.example })}
                  onClick={() => insertToken(item.token)}
                  className="rounded border border-border/70 bg-secondary/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {item.token}
                </button>
              )
            })}
          </div>
          <p className="break-all rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
            {t('settings.template.preview')}
            <span className="text-foreground/90">{templatePreview}</span>
          </p>
          {templateError ? (
            <p className="text-[11px] leading-4 text-destructive">{templateError}</p>
          ) : (
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('settings.template.note')}
            </p>
          )}
        </section>

        <section className="space-y-2.5 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-primary" />
              {t('settings.proxy.title')}
            </h3>
            <div className="flex items-center gap-2">
              {proxyConfig.enabled ? (
                <Badge variant={props.proxy?.applied ? 'success' : 'destructive'}>
                  {props.proxy?.applied
                    ? t('settings.proxy.applied')
                    : t('settings.proxy.notApplied')}
                </Badge>
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={proxyConfig.enabled}
                aria-label={t('settings.proxy.enable')}
                onClick={() => void commitProxy({ enabled: !proxyConfig.enabled })}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  proxyConfig.enabled ? 'bg-primary' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
                    proxyConfig.enabled ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t('settings.proxy.hint')}
          </p>
          {props.proxy?.resolved ? (
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('settings.proxy.resolved', { route: props.proxy.resolved })}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <Field label={t('settings.proxy.protocol')}>
              <Select
                value={proxyConfig.protocol}
                onChange={(value) =>
                  void commitProxy({ protocol: value as ProxyProtocol })
                }
                 options={[
                  { value: 'http', label: 'http' },
                  { value: 'https', label: 'https' },
                  { value: 'socks4', label: 'SOCKS4' },
                  { value: 'socks5', label: 'socks5' },
                ]}
              />
            </Field>
            <div className="col-span-2">
              <Field label={t('settings.proxy.host')}>
                <Input
                  value={proxyHost}
                  spellCheck={false}
                  placeholder="127.0.0.1"
                  onChange={(event) => setProxyHost(event.target.value)}
                  onBlur={() => {
                    const value = proxyHost.trim()
                    if (value !== proxyConfig.host) void commitProxy({ host: value })
                  }}
                />
              </Field>
            </div>
          </div>
          {proxyConfig.protocol === 'https' ? (
            <p className="text-[11px] leading-4 text-amber-500">
              {t('settings.proxy.httpsHint')}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <Field label={t('settings.proxy.port')}>
              <Input
                value={proxyPort}
                inputMode="numeric"
                placeholder="7890"
                onChange={(event) => setProxyPort(event.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => {
                  const value = Math.max(0, Math.min(65535, Number(proxyPort) || 0))
                  if (value !== proxyConfig.port) void commitProxy({ port: value })
                }}
              />
            </Field>
            <Field label={t('settings.proxy.username')}>
              <Input
                value={proxyUsername}
                spellCheck={false}
                disabled={proxyIsSocks}
                onChange={(event) => setProxyUsername(event.target.value)}
                onBlur={() => {
                  const value = proxyUsername.trim()
                  if (value !== proxyConfig.username) void commitProxy({ username: value })
                }}
              />
            </Field>
            <Field label={t('settings.proxy.password')}>
              <Input
                type="password"
                value={proxyPassword}
                disabled={proxyIsSocks}
                placeholder={
                  props.proxy?.hasPassword
                    ? t('settings.proxy.passwordKeep')
                    : t('settings.proxy.passwordPlaceholder')
                }
                onChange={(event) => setProxyPassword(event.target.value)}
                onBlur={commitProxyPassword}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitProxyPassword()
                }}
              />
            </Field>
          </div>
          {proxyIsSocks ? (
            <p className="text-[11px] leading-4 text-amber-500">
              {t('settings.proxy.socksHint')}
            </p>
          ) : null}

          <Field label={t('settings.proxy.bypass')} hint={t('settings.proxy.bypassHint')}>
            <Input
              value={proxyBypass}
              spellCheck={false}
              placeholder="localhost, 127.0.0.1, <local>"
              onChange={(event) => setProxyBypass(event.target.value)}
              onBlur={() => {
                const value = proxyBypass.trim()
                if (value !== proxyConfig.bypassRules) void commitProxy({ bypassRules: value })
              }}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={proxyTesting || proxyBusy}
              onClick={() => void runProxyTest()}
            >
              {proxyTesting ? <Loader2 className="animate-spin" /> : <Globe />}
              {proxyTesting ? t('settings.proxy.testing') : t('settings.proxy.test')}
            </Button>
            {props.proxy?.hasPassword ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={proxyBusy}
                onClick={() => void commitProxy({}, '')}
              >
                <Trash2 />
                {t('settings.proxy.passwordClear')}
              </Button>
            ) : null}
          </div>

          {proxyConfig.enabled && proxyIncomplete ? (
            <p className="text-[11px] leading-4 text-amber-500">
              {t('settings.proxy.invalid')}
            </p>
          ) : null}
          {proxyConfig.enabled && props.proxy?.error ? (
            <p className="text-[11px] leading-4 text-destructive">
              {t('settings.proxy.applyError', { message: props.proxy.error })}
            </p>
          ) : null}
          {proxyError ? (
            <p className="text-[11px] leading-4 text-destructive">{proxyError}</p>
          ) : null}
          {proxyTest ? (
            <p
              className={`text-[11px] leading-4 ${
                !proxyTest.ok
                  ? 'text-destructive'
                  : proxyTest.status && proxyTest.status >= 400
                    ? 'text-amber-500'
                    : 'text-emerald-500'
              }`}
            >
              {!proxyTest.ok
                ? t('settings.proxy.testFail', { message: proxyTest.message })
                : proxyTest.status && proxyTest.status >= 400
                  ? t('settings.proxy.testWarn', {
                      status: proxyTest.status,
                      ms: proxyTest.latencyMs
                    })
                  : t('settings.proxy.testOk', { ms: proxyTest.latencyMs })}
            </p>
          ) : null}
        </section>

        <section className="space-y-2.5 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Cookie className="h-4 w-4 text-primary" />
              {t('settings.cookie.title')}
            </h3>
            <Badge variant={props.cookie?.hasCookie ? 'success' : 'destructive'}>
              {props.cookie?.hasCookie
                ? t('settings.cookie.configured')
                : t('settings.cookie.notConfigured')}
            </Badge>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {props.cookie?.hasCookie
              ? `${cookieSourceLabel(t, props.cookie.source)} · ${props.cookie.masked}`
              : t('settings.cookie.hint')}
          </p>
          {props.selfUser ? (
            <p className="text-[11px] leading-4 text-muted-foreground/80">
              {t('settings.cookie.currentUser', {
                name: props.selfUser.name,
                id: props.selfUser.id
              })}
            </p>
          ) : null}
          {loggedIn ? (
            <p className="text-[11px] leading-4 text-muted-foreground/70">
              {t('settings.cookie.alreadyLoggedIn')}
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={loggingIn}
                  onClick={() => void login()}
                >
                  {loggingIn ? <Loader2 className="animate-spin" /> : <LogIn />}
                  {loggingIn ? t('settings.cookie.loggingIn') : t('settings.cookie.login')}
                </Button>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground/70">
                {t('settings.cookie.loginHint')}
              </p>
              <p className="text-[11px] leading-4 text-red-500">
                {t('settings.cookie.captchaLoop')}
              </p>
            </>
          )}
          {props.cookie?.hasCookie ? (
            confirmingClear ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[11px] leading-4 text-amber-500">
                  {t('settings.cookie.clearConfirm')}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={clearing}
                  onClick={() => void clearCookie()}
                >
                  {clearing ? <Loader2 className="animate-spin" /> : null}
                  {t('settings.cookie.clearOk')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clearing}
                  onClick={() => setConfirmingClear(false)}
                >
                  {t('settings.cookie.clearCancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setConfirmingClear(true)}
              >
                <Trash2 />
                {t('settings.cookie.clear')}
              </Button>
            )
          ) : null}
          {loginCancelled ? (
            <p className="text-[11px] leading-4 text-amber-500">
              {t('settings.cookie.loginCancelled')}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <span className="h-px flex-1 bg-border/60" />
            {t('settings.cookie.orManual')}
            <span className="h-px flex-1 bg-border/60" />
          </p>
          <Textarea
            value={cookieInput}
            onChange={(event) => setCookieInput(event.target.value)}
            placeholder={t('settings.cookie.placeholder')}
            spellCheck={false}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!cookieInput.trim() || savingCookie}
            onClick={() => void saveCookie()}
          >
            {savingCookie ? <Loader2 className="animate-spin" /> : <Cookie />}
            {t('settings.cookie.save')}
          </Button>
        </section>

        <section className="space-y-2.5 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4 text-primary" />
              {t('settings.oauth.title')}
            </h3>
            <Badge variant={props.oauth?.connected ? 'success' : 'destructive'}>
              {props.oauth?.connected
                ? t('settings.oauth.connected')
                : t('settings.oauth.notConnected')}
            </Badge>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {props.oauth?.connected
              ? t('settings.oauth.connectedHint', {
                  userId: props.oauth.userId ?? '-',
                  tail: props.oauth.tail
                })
              : t('settings.oauth.hint')}
          </p>
          {props.oauth?.connected ? (
            confirmingOAuthClear ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[11px] leading-4 text-amber-500">
                  {t('settings.oauth.clearConfirm')}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={savingOAuth}
                  onClick={() => void clearOAuth()}
                >
                  {savingOAuth ? <Loader2 className="animate-spin" /> : null}
                  {t('settings.oauth.clearOk')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={savingOAuth}
                  onClick={() => setConfirmingOAuthClear(false)}
                >
                  {t('settings.cookie.clearCancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setConfirmingOAuthClear(true)}
              >
                <Trash2 />
                {t('settings.oauth.clear')}
              </Button>
            )
          ) : (
            <>
              <Input
                value={oauthForm.clientId}
                onChange={(event) =>
                  setOAuthForm((previous) => ({ ...previous, clientId: event.target.value }))
                }
                placeholder={t('settings.oauth.clientId')}
                spellCheck={false}
              />
              <Input
                type="password"
                value={oauthForm.clientSecret}
                onChange={(event) =>
                  setOAuthForm((previous) => ({ ...previous, clientSecret: event.target.value }))
                }
                placeholder={t('settings.oauth.clientSecret')}
                spellCheck={false}
              />
              <Textarea
                value={oauthForm.refreshToken}
                onChange={(event) =>
                  setOAuthForm((previous) => ({ ...previous, refreshToken: event.target.value }))
                }
                placeholder={t('settings.oauth.refreshToken')}
                spellCheck={false}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={savingOAuth || !oauthForm.refreshToken.trim()}
                onClick={() => void saveOAuth()}
              >
                {savingOAuth ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {t('settings.oauth.save')}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="w-full"
                disabled={savingOAuth}
                onClick={() => void loginOAuth()}
              >
                {savingOAuth ? <Loader2 className="animate-spin" /> : <LogIn />}
                {t('settings.oauth.login')}
              </Button>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t('settings.oauth.loginHint')}
              </p>
              {oauthNotice ? (
                <p className="text-[11px] leading-4 text-emerald-500">{oauthNotice}</p>
              ) : null}
              {oauthError ? (
                <p className="text-[11px] leading-4 text-red-500">{oauthError}</p>
              ) : null}
            </>
          )}
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <RefreshCw className="h-4 w-4 text-primary" />
              {t('settings.update.title')}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {t('settings.update.current', { version: version || '-' })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={updateBusy}
              onClick={() => void checkUpdate()}
            >
              {updateBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t('settings.update.check')}
            </Button>
            {updateStatus.state === 'downloaded' ? (
              <Button
                size="sm"
                className="flex-1"
                onClick={() => void window.pixiv.installUpdate()}
              >
                <Download />
                {t('settings.update.install')}
              </Button>
            ) : null}
          </div>
          <p
            className={`text-[11px] leading-4 ${
              updateStatus.state === 'error'
                ? 'text-destructive'
                : updateStatus.state === 'downloaded'
                  ? 'text-emerald-500'
                  : 'text-muted-foreground'
            }`}
          >
            {updateText(t, updateStatus)}
          </p>
          <p className="text-[11px] leading-4 text-muted-foreground/70">
            {t('settings.update.hint')}
          </p>
        </section>
      </div>
    </Dialog>
  )
}
