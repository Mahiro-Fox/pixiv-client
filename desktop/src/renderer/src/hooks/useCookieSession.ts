import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  CookieHealth,
  CookieStatus,
  OAuthCredentials,
  OAuthStatus,
  SelfUser
} from '@shared/types'
import { messageOf } from '../utils/errors'

export interface CookieSessionState {
  cookie: CookieStatus | null
  oauth: OAuthStatus | null
  selfUser: SelfUser | null
  cookieHealth: CookieHealth
  /** 用户手动关掉失效提醒后，直到下一次失效前不再弹 */
  healthDismissed: boolean
  setHealthDismissed: Dispatch<SetStateAction<boolean>>
  loggingIn: boolean
  /** 顶栏 / 工作台的 Cookie 失效提醒是否显示 */
  cookieExpired: boolean
  recheckCookie: () => Promise<void>
  saveCookie: (raw: string) => Promise<void>
  saveOAuthCredentials: (credentials: OAuthCredentials) => Promise<void>
  loginOAuth: (clientId: string, clientSecret: string) => Promise<boolean>
  clearOAuth: () => Promise<void>
  loginPixiv: () => Promise<boolean>
  clearCookie: () => Promise<void>
}

/**
 * Cookie / App API 凭据的会话状态。
 *
 * 由 Cookie 派生出来的两件事（识别当前账号、体检）都跟着 hasCookie / masked 走：
 * 保存或清除之后自动重算，不需要调用方再手动触发。
 */
export function useCookieSession(setError: (message: string) => void): CookieSessionState {
  const [cookie, setCookie] = useState<CookieStatus | null>(null)
  /** App API 凭据状态；写操作（收藏、关注）依赖它 */
  const [oauth, setOAuth] = useState<OAuthStatus | null>(null)
  const [selfUser, setSelfUser] = useState<SelfUser | null>(null)
  const [cookieHealth, setCookieHealth] = useState<CookieHealth>('valid')
  const [healthDismissed, setHealthDismissed] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([window.pixiv.getCookie(), window.pixiv.getOAuthStatus()])
      .then(([loadedCookie, loadedOAuth]) => {
        if (!alive) return
        setCookie(loadedCookie)
        setOAuth(loadedOAuth)
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason))
      })
    return () => {
      alive = false
    }
  }, [setError])

  // Cookie 变化后重新识别当前登录账号（收藏夹同步会用到）
  useEffect(() => {
    let alive = true
    if (!cookie?.hasCookie) {
      setSelfUser(null)
      return
    }
    void window.pixiv
      .getSelfUser()
      .then((user) => {
        if (alive) setSelfUser(user)
      })
      // 拿不到自己的信息只是少个头像，不影响浏览与下载
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [cookie?.hasCookie, cookie?.masked])

  // Cookie 体检：配置变化后主动打一次 pixiv 接口，确认它还认得我们。
  // 'unknown'（请求没打出去）不当成失效，避免代理抖动就弹提醒。
  useEffect(() => {
    if (!cookie?.hasCookie) {
      setCookieHealth('valid')
      return
    }
    let alive = true
    void window.pixiv
      .checkCookieHealth()
      .then((health) => {
        if (alive) setCookieHealth(health)
      })
      // 体检本身失败（断网 / 代理抖动）按「未知」处理，保持上一次结论
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [cookie?.hasCookie, cookie?.masked])

  // 任务跑到一半 Cookie 才失效时，主进程会推这个通知过来
  useEffect(
    () =>
      window.pixiv.onCookieInvalid(() => {
        setHealthDismissed(false)
        setCookieHealth('expired')
      }),
    []
  )

  // 登录后静默完成的 App API 授权在后台结束，主进程推送结果过来
  useEffect(() => window.pixiv.onOAuthChanged((status) => setOAuth(status)), [])

  const cookieExpired = cookieHealth === 'expired' && Boolean(cookie?.hasCookie) && !healthDismissed

  const recheckCookie = async (): Promise<void> => {
    setHealthDismissed(false)
    setCookieHealth(await window.pixiv.checkCookieHealth())
  }

  const saveCookie = async (raw: string): Promise<void> => {
    try {
      const status = await window.pixiv.setCookie(raw)
      setCookie(status)
      setError('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  /** 保存 App API 凭据：主进程先刷新校验，失败会抛出，由设置面板就地展示 */
  const saveOAuthCredentials = async (credentials: OAuthCredentials): Promise<void> => {
    setOAuth(await window.pixiv.saveOAuthCredentials(credentials))
  }

  /** 打开 pixiv 授权页，用 PKCE 自动换取并保存 refresh_token；取消返回 false */
  const loginOAuth = async (clientId: string, clientSecret: string): Promise<boolean> => {
    const status = await window.pixiv.loginOAuth({ clientId, clientSecret })
    if (!status) return false
    setOAuth(status)
    return true
  }

  /** 清除 App API 凭据；不影响 Cookie，只影响写操作 */
  const clearOAuth = async (): Promise<void> => {
    setOAuth(await window.pixiv.clearOAuth())
  }

  /** 应用内登录：弹出 pixiv 登录窗口，成功后自动保存 Cookie；取消则不改动现有配置 */
  const loginPixiv = async (): Promise<boolean> => {
    setLoggingIn(true)
    try {
      const status = await window.pixiv.loginPixiv()
      if (!status) return false
      setCookie(status)
      setError('')
      return true
    } catch (reason) {
      setError(messageOf(reason))
      return false
    } finally {
      setLoggingIn(false)
    }
  }

  /** 清除已保存 Cookie，并重置登录窗口的会话，使下次登录必须重新过一遍验证码 */
  const clearCookie = async (): Promise<void> => {
    try {
      const status = await window.pixiv.clearCookie()
      setCookie(status)
      setSelfUser(null)
      setError('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return {
    cookie,
    oauth,
    selfUser,
    cookieHealth,
    healthDismissed,
    setHealthDismissed,
    loggingIn,
    cookieExpired,
    recheckCookie,
    saveCookie,
    saveOAuthCredentials,
    loginOAuth,
    clearOAuth,
    loginPixiv,
    clearCookie
  }
}
