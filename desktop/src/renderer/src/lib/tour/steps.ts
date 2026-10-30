import type { MessageKey } from '@renderer/i18n'

/**
 * 引导内容版本。
 *
 * 只在「步骤或文案变了、值得让老用户再看一遍」时 +1，不与 app 版本绑定：
 * 发一个修 bug 的补丁版不该把引导重新弹给所有人。
 */
export const TOUR_VERSION = 2

/**
 * 引导里用的示例画师。
 *
 * 工作台没抓过作品时右侧工具栏根本不渲染，第 6 步的锚点会落空，
 * 所以第 5 步会用它抓一页作品——纯粹为了让后面的步骤有东西可指。
 * 选一个作品多、更新稳定的老账号，抓一页（50 条）也很快。
 */
export const TOUR_DEMO_AUTHOR = '121154321'

const TOUR_STORAGE_KEY = 'pixiv.tour.version'

/**
 * 是否已经看过这一版引导。
 *
 * 用 localStorage 而不是 config.json：这里记的是「这台机器的界面见过没有」，
 * 属于纯前端偏好，和语言、搜索历史一样；走 config 需要多一层 IPC，
 * 还会和 `pixiv:config-changed` 那条广播机制打架。
 * 写不进去（隐私模式 / 磁盘只读）时退化成「每次都弹」，不影响正常使用。
 */
export function hasSeenTour(): boolean {
  try {
    const raw = window.localStorage.getItem(TOUR_STORAGE_KEY)
    return raw !== null && Number(raw) >= TOUR_VERSION
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, String(TOUR_VERSION))
  } catch {
    /* 存不下就下次再引导，不抛错 */
  }
}

export interface TourStep {
  /** 对应元素的 `data-tour` 值；`null` 表示居中显示（无锚点） */
  anchor: string | null
  /**
   * 主锚点不在 DOM 里时退而求其次的锚点。
   * 例：工作台还没抓过作品时工具栏根本不渲染，改高亮整个作品区。
   */
  fallback?: string
  /**
   * 进入这一步前先切到该路由（工作台 / 推荐页的步骤需要）。
   *
   * 往前翻、往后翻都会执行：第 4 步讲的是「推荐页里的作品卡」，
   * 从第 5 步（工作台）退回第 4 步时必须先回到推荐页，
   * 否则锚点找不到、气泡只能原地降级居中。
   */
  route?: string
  /** 进入这一步时顺带做的一件事，由外层（App）实现 */
  action?: TourAction
  titleKey: MessageKey
  bodyKey: MessageKey
  /**
   * 交互步骤：用户真的做完（右键卡片）后，气泡改显示这段补充说明。
   * 没有它就只能「下一步」硬走，用户看完就忘。
   */
  doneKey?: MessageKey
  interactive?: boolean
}

/**
 * 步骤附带的动作，交给 App 执行。
 *
 * `demo-works`：把工作台的作者 ID 填成示例画师并抓一页，
 * 好让第 6 步的工具栏锚点真的存在。
 */
export type TourAction = 'demo-works'

/**
 * 主流程步骤。
 *
 * 顺序按「顶栏 → 卡片 → 工作台」走，符合用户实际的视线路径；
 * 每步只讲一件「不点开就发现不了」的事，避免变成功能清单朗读。
 */
export const TOUR_STEPS: TourStep[] = [
  {
    anchor: 'search-box',
    titleKey: 'tour.search.title',
    bodyKey: 'tour.search.body'
  },
  {
    anchor: 'account-menu',
    titleKey: 'tour.account.title',
    bodyKey: 'tour.account.body'
  },
  {
    anchor: 'filter-button',
    titleKey: 'tour.filter.title',
    bodyKey: 'tour.filter.body'
  },
  {
    anchor: 'work-card',
    route: '/recommend',
    interactive: true,
    titleKey: 'tour.card.title',
    bodyKey: 'tour.card.body',
    doneKey: 'tour.card.done'
  },
  {
    anchor: 'collect-panel',
    route: '/workbench',
    action: 'demo-works',
    titleKey: 'tour.collect.title',
    bodyKey: 'tour.collect.body'
  },
  {
    anchor: 'works-toolbar',
    fallback: 'works-panel',
    route: '/workbench',
    titleKey: 'tour.toolbar.title',
    bodyKey: 'tour.toolbar.body'
  },
  {
    anchor: 'workbench-tabs',
    route: '/workbench',
    titleKey: 'tour.tabs.title',
    bodyKey: 'tour.tabs.body'
  }
]
