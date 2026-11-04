import { WorksGrid } from '@renderer/components/shared/WorksGrid';
import { Button } from '@renderer/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@renderer/components/ui/tabs';
import { useI18n } from '@renderer/i18n';
import { CollectPanel } from '@renderer/pages/WorkbenchPage/_components/CollectPanel';
import { LogPanel } from '@renderer/pages/WorkbenchPage/_components/LogPanel';
import { ProgressPanel } from '@renderer/pages/WorkbenchPage/_components/ProgressPanel';
import { QueuePanel } from '@renderer/pages/WorkbenchPage/_components/QueuePanel';
import type {
  AppConfig,
  BatchSyncProgress,
  CollectProgress,
  DownloadItemEvent,
  FailureItem,
  PixivWork,
  QueueSummary,
  SelfUser,
  TagSuggestion,
  ThrottleState,
  WorkContent,
  WorkSort,
} from '@shared/types';
import {
  AlertTriangle,
  Images,
  ListRestart,
  Loader2,
  ScrollText,
  X,
} from 'lucide-react';
import type * as React from 'react';

/** 工作台作品栏目的固定顺序；「全部」放第一位，保持与旧行为一致 */
const CONTENT_TABS: WorkContent[] = ['all', 'illust', 'manga', 'bookmarks'];

/**
 * Cookie 失效提醒条。
 * 之所以单独成组件：I18nProvider 挂在 App 内部，
 * 只有 provider 下面的组件才拿得到 useI18n。
 */
function CookieExpiredBanner(props: {
  loading: boolean;
  onRelogin: () => void;
  onRecheck: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p className="flex-1 leading-5">{t('cookie.expired')}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={props.loading}
        onClick={props.onRelogin}
      >
        {props.loading ? <Loader2 className="animate-spin" /> : null}
        {t('cookie.relogin')}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onRecheck}>
        {t('cookie.recheck')}
      </Button>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label={t('cookie.dismiss')}
        className="rounded p-0.5 text-amber-500/70 transition-colors hover:bg-amber-500/15 hover:text-amber-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * 下载工作台：左侧采集面板 + 右侧「作品 / 任务 / 日志」三页签。
 *
 * 这里不持有任何业务状态 —— 抓取、下载、队列都跑在 App 里（主进程事件也由 App 订阅），
 * 页面只负责把当前状态摆出来、把用户操作交回去，避免同一份 state 出现两个来源。
 */
export interface WorkbenchPageProps {
  /* —— 采集参数 —— */
  config: AppConfig;
  selfUser: SelfUser | null;
  hasCookie: boolean;
  collecting: boolean;
  /** 队列里已有未完成任务：采集面板的按钮文案随之变化 */
  queued: boolean;
  selectedCount: number;
  /** 「正在抓取第 3/8 页」这类实时文案；为空时退回通用文案 */
  collectText: string | null;
  collectProgress: CollectProgress | null;
  total: number;
  worksCount: number;

  /* —— 采集动作 —— */
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onCollect: () => void;
  onDownload: () => void;
  /** 清掉标签筛选，回到这位作者的全部作品 */
  onClearTag: () => void;
  onSwitchContent: (next: WorkContent) => void;
  onSuggestTags: (word: string) => Promise<TagSuggestion[]>;

  /* —— Cookie 失效提醒 —— */
  cookieExpired: boolean;
  loggingIn: boolean;
  onRelogin: () => void;
  onRecheckCookie: () => void;
  onDismissCookieBanner: () => void;

  /* —— 页签 —— */
  tab: string;
  onTabChange: (value: string) => void;

  /* —— 作品网格（当前页、已选、筛选结果都由 App 算好） —— */
  works: PixivWork[];
  selected: Set<string>;
  downloaded: Set<string>;
  downloadedCount: number;
  filteredTotal: number;
  /** 被过滤规则挡掉的作品数 */
  filteredOut: number;
  onlyNew: boolean;
  sort: WorkSort;
  activeFilterCount: number;
  onSortChange: (sort: WorkSort) => void;
  onOpenFilter: () => void;
  onOpenTags: () => void;
  onExport: () => void;
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (work: PixivWork) => void;
  onToggleOnlyNew: () => void;

  /* —— 任务队列 —— */
  queue: QueueSummary[];
  /** 正在跑的下载任务数 */
  activeCount: number;
  throttle: ThrottleState[];
  batch: BatchSyncProgress | null;
  onOpenSettings: () => void;
  onCancelBatch: () => void;
  onResume: (id: string) => void;
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onLoadFailures: (id: string) => Promise<FailureItem[]>;
  onRetryFailure: (id: string, item: FailureItem) => Promise<void>;
  onExportFailures: (id: string) => void;
  onOpenDir: (dir: string) => void;

  /* —— 下载日志 —— */
  items: DownloadItemEvent[];
  running: boolean;
}

export function WorkbenchPage(props: WorkbenchPageProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    config,
    selfUser,
    hasCookie,
    collecting,
    queued,
    selectedCount,
    collectText,
    collectProgress,
    total,
    worksCount,
    onConfigChange,
    onCollect,
    onDownload,
    onClearTag,
    onSwitchContent,
    onSuggestTags,
    cookieExpired,
    loggingIn,
    onRelogin,
    onRecheckCookie,
    onDismissCookieBanner,
    tab,
    onTabChange,
    works,
    selected,
    downloaded,
    downloadedCount,
    filteredTotal,
    filteredOut,
    onlyNew,
    sort,
    activeFilterCount,
    onSortChange,
    onOpenFilter,
    onOpenTags,
    onExport,
    page,
    pageCount,
    pageSize,
    onPageChange,
    onToggle,
    onToggleAll,
    onOpen,
    onToggleOnlyNew,
    queue,
    activeCount,
    throttle,
    batch,
    onOpenSettings,
    onCancelBatch,
    onResume,
    onPause,
    onCancel,
    onRemove,
    onLoadFailures,
    onRetryFailure,
    onExportFailures,
    onOpenDir,
    items,
    running,
  } = props;

  /** 作品列表的四个栏目与作者主页口径一致：全部 = 插画+漫画，收藏换的是数据来源 */
  const contentTab = config.contentKind ?? 'all';
  const isBookmarks = config.contentKind === 'bookmarks';

  const contentLabel = (value: WorkContent): string => {
    if (value === 'bookmarks') return t('workbench.contentBookmarks');
    if (value === 'illust') return t('workbench.contentIllust');
    if (value === 'manga') return t('workbench.contentManga');
    return t('workbench.contentAll');
  };

  return (
    <main className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
      <aside className="min-h-0 border-r border-border/60 px-5 py-4">
        <CollectPanel
          config={config}
          selfUser={selfUser}
          hasCookie={hasCookie}
          collecting={collecting}
          queued={queued}
          selectedCount={selectedCount}
          onConfigChange={onConfigChange}
          onCollect={onCollect}
          onDownload={onDownload}
          onSuggestTags={onSuggestTags}
        />
      </aside>

      <section className="flex min-h-0 flex-col gap-3 px-6 py-4">
        {cookieExpired ? (
          <CookieExpiredBanner
            loading={loggingIn}
            onRelogin={onRelogin}
            onRecheck={onRecheckCookie}
            onDismiss={onDismissCookieBanner}
          />
        ) : null}

        <Tabs
          value={tab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            className="flex items-center justify-between"
            data-tour="workbench-tabs"
          >
            <TabsList>
              <TabsTrigger value="works">
                <Images className="h-4 w-4" />
                {t('app.tabWorks')}
                {worksCount > 0 ? `（${worksCount}）` : ''}
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListRestart className="h-4 w-4" />
                {t('app.tabTasks')}
                {queue.length > 0 ? `（${queue.length}）` : ''}
              </TabsTrigger>
              <TabsTrigger value="log">
                <ScrollText className="h-4 w-4" />
                {t('app.tabLog')}
                {items.length > 0 ? `（${items.length}）` : ''}
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {collecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {collectText ?? t('app.collectingWorks')}
                </>
              ) : null}
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {t('app.downloadRunning')}
                </>
              ) : null}
              {total > 0 && !collecting ? (
                <span>{t('app.apiTotal', { total })}</span>
              ) : null}
            </div>
          </div>

          <TabsContent
            value="works"
            className="min-h-0 gap-2"
            data-tour="works-panel"
          >
            {/* 栏目与作者主页一致：全部 = 插画+漫画；收藏换的是数据来源 */}
            <div
              className="flex shrink-0 items-center gap-1 self-start rounded-lg bg-secondary/40 p-1"
              data-tour="works-content-tabs"
            >
              {CONTENT_TABS.map((value) => {
                const active = contentTab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onSwitchContent(value)}
                    disabled={collecting}
                    className={
                      active
                        ? 'rounded-md bg-background px-2.5 py-1 text-[11px] text-foreground shadow-sm transition-colors disabled:opacity-60'
                        : 'rounded-md px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40'
                    }
                  >
                    {contentLabel(value)}
                  </button>
                );
              })}
            </div>

            <WorksGrid
              works={works}
              selected={selected}
              downloaded={downloaded}
              downloadedCount={downloadedCount}
              collecting={collecting}
              loaded={collectProgress?.loaded ?? 0}
              total={total}
              filteredTotal={filteredTotal}
              filteredOut={filteredOut}
              onlyNew={onlyNew}
              sort={sort}
              activeFilterCount={activeFilterCount}
              onSortChange={onSortChange}
              onOpenFilter={onOpenFilter}
              activeTag={isBookmarks ? '' : config.tag}
              // 标签弹窗列的是作者作品的标签；收藏栏的标签是收藏夹标签，只能手填
              onOpenTags={isBookmarks ? undefined : onOpenTags}
              onClearTag={isBookmarks ? undefined : onClearTag}
              onExport={onExport}
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onOpen={onOpen}
              onToggleOnlyNew={onToggleOnlyNew}
            />
          </TabsContent>

          <TabsContent value="tasks" className="min-h-0">
            {/* 进度与队列集中在这里，主区高度全部留给作品网格 */}
            <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pb-2 pr-1">
              <ProgressPanel
                jobs={queue}
                parallel={activeCount}
                parallelJobs={config.parallelJobs}
                onOpenSettings={onOpenSettings}
                throttle={throttle}
                batch={batch}
                onCancelBatch={onCancelBatch}
              />

              <QueuePanel
                jobs={queue}
                onResume={onResume}
                onPause={onPause}
                onCancel={onCancel}
                onRemove={onRemove}
                loadFailures={onLoadFailures}
                onRetryFailure={onRetryFailure}
                onExportFailures={onExportFailures}
                onOpenDir={onOpenDir}
              />
            </div>
          </TabsContent>

          <TabsContent value="log" className="min-h-0">
            <LogPanel items={items} running={running} />
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
