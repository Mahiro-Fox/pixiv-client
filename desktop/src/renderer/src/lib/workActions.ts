import type { PixivWork, SearchWork } from '@shared/types'
import {
  blockRulesOf,
  blockedUserTerms,
  joinBlockTerms,
  splitBlockTermsRaw
} from '@shared/block'
import { toPixivWork } from './workPreview'
import { worksTag } from './files'

/**
 * 右键菜单用到的写操作。
 *
 * 菜单挂在卡片上、拿不到 App 的状态，所以每个动作都自己读配置、
 * 自己给结果（成功 → toast，失败 → toast 里显示原因），页面无需接线。
 */

/** 配置被菜单改过之后广播：App 收到会重新读一次，避免内存里的旧配置把改动覆盖掉 */
export const CONFIG_CHANGED_EVENT = 'pixiv:config-changed'

export function workWebUrl(illustId: string): string {
  return `https://www.pixiv.net/artworks/${String(illustId || '').trim()}`
}

export function userWebUrl(userId: string): string {
  return `https://www.pixiv.net/users/${String(userId || '').trim()}`
}

/**
 * 写剪贴板。
 * 优先异步 API；个别环境（窗口未聚焦、权限被拒）会抛错，
 * 退回 textarea + execCommand，保证「复制」不会静默失败。
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // 走下面的兜底
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(area)
  }
}

/**
 * 把作品加入下载队列。
 * 配置直接在调用时读，保证用的是用户当前的质量 / 目录 / 模板设置。
 * 返回作品数（不是任务数），用于提示「N 个作品已加入队列」。
 */
export async function enqueueWorks(works: SearchWork[]): Promise<number> {
  const list = works.filter(Boolean)
  if (list.length === 0) throw new Error('没有可下载的作品')
  const config = await window.pixiv.getConfig()
  await window.pixiv.enqueueDownload({
    works: list.map((work) => toPixivWork(work) as PixivWork),
    tag: worksTag(config),
    outDir: config.outDir,
    workers: config.workers,
    delay: config.delay,
    imageQuality: config.imageQuality,
    ugoiraFormat: config.ugoiraFormat
  })
  return list.length
}

/**
 * 屏蔽作者（全局屏蔽，搜索 / 用户主页 / 收藏 / 下载都会生效）。
 * 优先写用户 ID：改名也不会失效。已经屏蔽时返回 false，不重复写。
 */
export async function blockAuthor(userId: string, userName = ''): Promise<boolean> {
  const term = String(userId || '').trim() || String(userName || '').trim()
  if (!term) throw new Error('缺少作者信息')

  const config = await window.pixiv.getConfig()
  if (blockedUserTerms({ userId, userName }, blockRulesOf(config)).length > 0) return false

  const raw = (config.blockUsers || '').trim()
  await window.pixiv.setConfig({ blockUsers: raw ? `${raw}, ${term}` : term })
  window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT))
  return true
}

/** 该作者当前是否处于屏蔽状态（菜单据此显示「屏蔽」还是「取消屏蔽」） */
export async function isAuthorBlocked(userId: string, userName = ''): Promise<boolean> {
  const config = await window.pixiv.getConfig()
  return blockedUserTerms({ userId, userName }, blockRulesOf(config)).length > 0
}

/**
 * 取消屏蔽：删掉命中该作者的所有词条（ID 与昵称都写过时一起删）。
 * 返回删掉的词条数；本来就是未屏蔽状态则返回 0，不写配置。
 *
 * 匹配逻辑与 isBlocked 共用：按昵称屏蔽时写的是「部分名字」，
 * 所以删的也是那条命中词条，而不是作者全名。
 */
export async function unblockAuthor(userId: string, userName = ''): Promise<number> {
  const config = await window.pixiv.getConfig()
  const matched = blockedUserTerms({ userId, userName }, blockRulesOf(config))
  if (matched.length === 0) return 0

  const keep = splitBlockTermsRaw(config.blockUsers).filter(
    (term) => !matched.includes(term.toLowerCase())
  )
  await window.pixiv.setConfig({ blockUsers: joinBlockTerms(keep) })
  window.dispatchEvent(new Event(CONFIG_CHANGED_EVENT))
  return matched.length
}
