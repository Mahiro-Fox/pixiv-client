import {
  AlertTriangle,
  BookOpen,
  Compass,
  Download,
  FolderOpen,
  Images,
  Library,
  ListRestart,
  Loader2,
  ScrollText,
  Settings2,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { Locale } from "@shared/types";
import type {
  AppConfig,
  BatchArtist,
  BatchSyncProgress,
  CollectProgress,
  CookieHealth,
  CookieStatus,
  OAuthCredentials,
  OAuthStatus,
  DownloadItemEvent,
  DownloadProgress,
  FailureItem,
  PixivWork,
  ProxyConfig,
  ProxyState,
  ProxyTestResult,
  QueueSummary,
  SelfUser,
  ThrottleState,
  WorkSort,
} from "@shared/types";
import { applyWorkFilters, countActiveFilters } from "./lib/filters";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { I18nProvider, translate, useI18n } from "./i18n";
import type { Translate } from "./i18n";
import { LogPanel } from "./components/LogPanel";
import { ProgressPanel } from "./components/ProgressPanel";
import { QueuePanel } from "./components/QueuePanel";
import { CollectPanel } from "./components/CollectPanel";
import { FilterDialog } from "./components/FilterDialog";
import { ImagePreviewProvider } from "./components/ImagePreview";
import { LibraryPanel } from "./components/LibraryPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WorkDetailDialog } from "./components/WorkDetailDialog";
import { WorksGrid } from "./components/WorksGrid";
import { AccountMenu } from "./components/AccountMenu";
import { SearchBox } from "./components/SearchBox";
import { NovelSearchPage } from "./pages/NovelSearchPage";
import { NovelSeriesPage } from "./pages/NovelSeriesPage";
import { NovelReaderPage } from "./pages/NovelReaderPage";
import { NovelLibraryPage } from "./pages/NovelLibraryPage";
import { NovelLocalReaderPage } from "./pages/NovelLocalReaderPage";
import { WorksSearchPage } from "./pages/WorksSearchPage";
import { UsersPage } from "./pages/UsersPage";
import { UsersFollowingPage } from "./pages/UsersFollowingPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { RankingPage } from "./pages/RankingPage";
import { RecommendPage } from "./pages/RecommendPage";
import { Button } from "./components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** 收藏夹来源统一存到「收藏夹」目录，避免标签过滤条件改变目录结构 */
function worksTag(config: AppConfig): string {
  return config.source === "bookmarks" ? "收藏夹" : config.tag;
}

/**
 * 配置读出来之前也要有语言可用，否则启动首屏只能是中文。
 * 做法和主题一致：在本地存一份，配置到位后由它接管。
 */
const LOCALE_STORAGE_KEY = "pixiv-locale";

function bootLocale(): Locale {
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return saved === "en" || saved === "ja" ? saved : "zh-CN";
}

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
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1 leading-5">{t("cookie.expired")}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={props.loading}
        onClick={props.onRelogin}
      >
        {props.loading ? <Loader2 className="animate-spin" /> : null}
        {t("cookie.relogin")}
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onRecheck}>
        {t("cookie.recheck")}
      </Button>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label={t("cookie.dismiss")}
        className="rounded p-0.5 text-amber-500/70 transition-colors hover:bg-amber-500/15 hover:text-amber-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** 结果排序；'default' 保留接口原始顺序 */
function sortWorks(works: PixivWork[], sort: WorkSort): PixivWork[] {
  if (sort === "default") return works;
  const list = [...works];
  const byDate = (work: PixivWork): number => {
    const time = Date.parse(work.createDate || "");
    return Number.isFinite(time) ? time : 0;
  };

  if (sort === "pages-desc")
    return list.sort((a, b) => b.pageCount - a.pageCount);
  if (sort === "pages-asc")
    return list.sort((a, b) => a.pageCount - b.pageCount);
  if (sort === "date-desc") return list.sort((a, b) => byDate(b) - byDate(a));
  return list.sort((a, b) => byDate(a) - byDate(b));
}

export default function App(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentWord = searchParams.get("word") || "";
  /** 顶栏搜索框的受控值；与 URL 的 word 保持同步 */
  const [keyword, setKeyword] = useState(currentWord);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [cookie, setCookie] = useState<CookieStatus | null>(null);
  /** App API 凭据状态；写操作（收藏、关注）依赖它 */
  const [oauth, setOAuth] = useState<OAuthStatus | null>(null);
  const [proxy, setProxy] = useState<ProxyState | null>(null);
  const [works, setWorks] = useState<PixivWork[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const [collecting, setCollecting] = useState(false);
  const [collectProgress, setCollectProgress] =
    useState<CollectProgress | null>(null);
  const [download, setDownload] = useState<DownloadProgress | null>(null);
  const [batch, setBatch] = useState<BatchSyncProgress | null>(null);
  const [items, setItems] = useState<DownloadItemEvent[]>([]);
  /** 正在下载的队列任务 ID（并行下载时可能同时存在多个） */
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const running = activeIds.size > 0 || Boolean(batch);
  const [queue, setQueue] = useState<QueueSummary[]>([]);
  const [throttle, setThrottle] = useState<ThrottleState[]>([]);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [selfUser, setSelfUser] = useState<SelfUser | null>(null);
  const [cookieHealth, setCookieHealth] = useState<CookieHealth>("valid");
  const [healthDismissed, setHealthDismissed] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState<WorkSort>("default");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<PixivWork | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("works");

  /** 顶栏导航与搜索框共用：按路由判断当前栏目 */
  const section: "illust" | "manga" | "novel" | "users" = location.pathname.startsWith(
    "/manga",
  )
    ? "manga"
    : location.pathname.startsWith("/novel")
      ? "novel"
      : location.pathname.startsWith("/user")
        ? "users"
        : "illust";
  const sectionPath = `/${section}`;

  // 路由变化（导航切换、点相关标签）后把搜索框同步回 URL 里的关键词
  useEffect(() => {
    setKeyword(currentWord);
  }, [currentWord]);

  const submitSearch = (value?: string): void => {
    const word = (value ?? keyword).trim();
    if (value !== undefined) setKeyword(value);
    navigate(
      word
        ? `${sectionPath}?word=${encodeURIComponent(word)}`
        : sectionPath,
    );
  };

  /** 顶部导航跳转时带上当前关键词，实现搜索词与栏目同步 */
  const linkWithWord = (path: string): string =>
    currentWord ? `${path}?word=${encodeURIComponent(currentWord)}` : path;

  useEffect(() => {
    let alive = true;

    void Promise.all([
      window.pixiv.getConfig(),
      window.pixiv.getCookie(),
      window.pixiv.getOAuthStatus(),
    ])
      .then(([loadedConfig, loadedCookie, loadedOAuth]) => {
        if (!alive) return;
        setConfig(loadedConfig);
        setCookie(loadedCookie);
        setOAuth(loadedOAuth);
      })
      .catch((reason: unknown) => {
        if (alive) setError(messageOf(reason));
      });

    void window.pixiv.listQueue().then((jobs) => {
      if (alive) setQueue(jobs);
    });
    void window.pixiv.getThrottle().then((states) => {
      if (alive) setThrottle(states);
    });
    void window.pixiv.getProxy().then((state) => {
      if (alive) setProxy(state);
    });

    const unsubscribers = [
      window.pixiv.onCollectProgress((progress) =>
        setCollectProgress(progress),
      ),
      window.pixiv.onDownloadProgress((progress) => {
        setDownload(progress);
        const id = progress.jobId;
        if (!id) return;
        // 结束的任务从运行集合里移除，界面据此显示并行数量
        const finished =
          progress.phase === "done" || progress.phase === "paused";
        setActiveIds((previous) => {
          if (finished) {
            if (!previous.has(id)) return previous;
            const next = new Set(previous);
            next.delete(id);
            return next;
          }
          return previous.has(id) ? previous : new Set(previous).add(id);
        });
      }),
      window.pixiv.onBatchProgress((progress) => setBatch(progress)),
      window.pixiv.onDownloadItem((item) =>
        setItems((previous) => [item, ...previous].slice(0, 500)),
      ),
      window.pixiv.onDownloadDone((summary) => {
        setDownload(summary);
        setActiveIds((previous) => {
          if (!previous.has(summary.jobId)) return previous;
          const next = new Set(previous);
          next.delete(summary.jobId);
          return next;
        });
      }),
      window.pixiv.onQueueChanged((jobs) => setQueue(jobs)),
      window.pixiv.onQueueError((message) => setError(message)),
      window.pixiv.onThrottle((state) =>
        setThrottle((previous) => {
          const next = previous.filter((item) => item.kind !== state.kind);
          return [...next, state];
        }),
      ),
    ];

    return () => {
      alive = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const selectedWorks = useMemo(
    () => works.filter((work) => selected.has(work.id)),
    [works, selected],
  );

  // 先按过滤规则筛选，再按「只看未下载」筛选
  const ruleFiltered = useMemo(
    () => (config ? applyWorkFilters(works, config) : { works, removed: 0 }),
    [works, config],
  );

  const filteredWorks = useMemo(
    () =>
      onlyNew
        ? ruleFiltered.works.filter((work) => !downloaded.has(work.id))
        : ruleFiltered.works,
    [ruleFiltered, onlyNew, downloaded],
  );

  const sortedWorks = useMemo(
    () => sortWorks(filteredWorks, sort),
    [filteredWorks, sort],
  );

  const activeFilterCount = useMemo(
    () => (config ? countActiveFilters(config) : 0),
    [config],
  );

  // 分页逻辑与 pixiv 网页端一致：按抓取时的每页数量切页，默认停在第 1 页
  const pageSize = Math.max(1, Math.min(100, Math.round(config?.limit || 48)));
  const pageCount = Math.max(1, Math.ceil(sortedWorks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedWorks = useMemo(
    () =>
      sortedWorks.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedWorks, currentPage, pageSize],
  );
  const downloadedCount = useMemo(
    () => filteredWorks.filter((work) => downloaded.has(work.id)).length,
    [filteredWorks, downloaded],
  );

  // 结果变少（例如开启筛选）时把页码收回到最后一页
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  /** 扫描作者目录，标记哪些作品已经下载过 */
  const refreshDownloaded = async (
    list: PixivWork[],
    cfg: AppConfig | null,
  ): Promise<Set<string>> => {
    if (!cfg || list.length === 0) {
      setDownloaded(new Set());
      return new Set();
    }
    try {
      const ids = await window.pixiv.checkDownloaded({
        works: list,
        tag: worksTag(cfg),
        outDir: cfg.outDir,
      });
      const next = new Set(ids);
      setDownloaded(next);
      return next;
    } catch {
      setDownloaded(new Set());
      return new Set();
    }
  };

  useEffect(() => {
    if (!config || works.length === 0 || !download) return;
    if (download.phase !== "done" && download.phase !== "paused") return;
    void refreshDownloaded(works, config);
  }, [download?.phase]);

  // 切换下载质量后「已下载」判定会变化（原图需要匹配原图尺寸），重新扫描一次
  useEffect(() => {
    if (!config || works.length === 0) return;
    void refreshDownloaded(works, config);
  }, [config?.imageQuality]);

  // Cookie 变化后重新识别当前登录账号（收藏夹同步会用到）
  useEffect(() => {
    let alive = true;
    if (!cookie?.hasCookie) {
      setSelfUser(null);
      return;
    }
    void window.pixiv.getSelfUser().then((user) => {
      if (alive) setSelfUser(user);
    });
    return () => {
      alive = false;
    };
  }, [cookie?.hasCookie, cookie?.masked]);

  // Cookie 体检：配置变化后主动打一次 pixiv 接口，确认它还认得我们。
  // 'unknown'（请求没打出去）不当成失效，避免代理抖动就弹提醒。
  useEffect(() => {
    if (!cookie?.hasCookie) {
      setCookieHealth("valid");
      return;
    }
    let alive = true;
    void window.pixiv.checkCookieHealth().then((health) => {
      if (alive) setCookieHealth(health);
    });
    return () => {
      alive = false;
    };
  }, [cookie?.hasCookie, cookie?.masked]);

  // 任务跑到一半 Cookie 才失效时，主进程会推这个通知过来
  useEffect(
    () =>
      window.pixiv.onCookieInvalid(() => {
        setHealthDismissed(false);
        setCookieHealth("expired");
      }),
    [],
  );

  const updateConfig = (patch: Partial<AppConfig>): void => {
    setConfig((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  /**
   * 代理改完立即在主进程生效（不必等关闭设置弹窗），
   * 同时把规范化后的配置同步回本地状态，避免关闭时把旧值写回磁盘。
   */
  const saveProxy = async (
    patch: Partial<ProxyConfig>,
    password?: string,
  ): Promise<ProxyState> => {
    const state = await window.pixiv.setProxy(patch, password);
    setProxy(state);
    setConfig((previous) =>
      previous ? { ...previous, proxy: state.config } : previous,
    );
    return state;
  };

  const testProxy: () => Promise<ProxyTestResult> = () =>
    window.pixiv.testProxy();

  // 主题与语言：配置变化时立即生效；跟随系统时监听系统配色变化
  const themeMode = config?.theme;
  const locale = config?.locale;
  useEffect(() => {
    if (!themeMode) return;
    applyTheme(themeMode);
    if (themeMode !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [themeMode]);

  useEffect(() => {
    if (!locale) return;
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  /** 关闭弹窗时把当前配置整份落盘，避免设置在下次抓取前丢失 */
  const persistConfig = (): void => {
    if (!config) return;
    void window.pixiv
      .setConfig(config)
      .catch((reason: unknown) => setError(messageOf(reason)));
  };

  /** patch 用于关注列表等入口「回填参数并立即抓取」 */
  const collect = async (patch?: Partial<AppConfig>): Promise<void> => {
    // 抓取与下载互不阻塞：下载进行中也能重新抓取作品列表
    if (!config || collecting) return;
    const cfg: AppConfig = { ...config, ...patch };
    if (patch) setConfig(cfg);

    setCollecting(true);
    setError("");
    setCollectProgress(null);
    // 下载进行中时不要清空进度与日志，否则面板会闪回空态并丢掉正在刷的日志
    if (!running) {
      setDownload(null);
      setItems([]);
    }
    try {
      await window.pixiv.setConfig(cfg);
      const result = await window.pixiv.collectWorks({
        userId: cfg.userId,
        tag: cfg.tag,
        extraTag: cfg.tagExtra,
        excludeTag: cfg.tagExclude,
        tagMode: cfg.tagMode,
        offset: cfg.offset,
        limit: cfg.limit,
        workers: cfg.workers,
        source: cfg.source,
        bookmarkUserId: cfg.bookmarkUserId,
        bookmarkTag: cfg.bookmarkTag,
        bookmarkRest: cfg.bookmarkRest,
      });
      setWorks(result.works);
      setTotal(result.total);
      setPreview(null);
      setPage(1);
      // 收藏夹同步默认只看未下载，实现增量同步
      const syncOnlyNew = cfg.source === "bookmarks" && cfg.bookmarkOnlyNew;
      setOnlyNew(syncOnlyNew);

      // 默认全选「当前筛选结果」的第一页
      const ids = await refreshDownloaded(result.works, cfg);
      const base = applyWorkFilters(result.works, cfg).works;
      const visible = syncOnlyNew
        ? base.filter((work) => !ids.has(work.id))
        : base;
      setSelected(new Set(visible.slice(0, cfg.limit).map((work) => work.id)));

      setTab("works");
      if (result.works.length === 0) {
        setError(
          cfg.source === "bookmarks"
            ? t("app.noWorksBookmarks")
            : t("app.noWorks"),
        );
      } else if (result.failedPages > 0) {
        setError(t("app.partialFail", { count: result.failedPages }));
      }
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setCollecting(false);
    }
  };

  /**
   * 批量同步：按当前标签与过滤规则逐位画师「抓取 → 下载」。
   * 主进程串行执行，这里只负责转进度与汇总结果。
   *
   * ⚠️ 入口已临时屏蔽：改版后关注列表改为独立页面，不再提供勾选批量同步，
   * 因此这段逻辑目前不会被触发，但整条链路（batchSync / batch 进度 / 进度条）
   * 保留不动，待需求完善后恢复入口即可复用，请勿删除。
   */
  const batchSync = async (artists: BatchArtist[]): Promise<void> => {
    // 额度是否足够由主进程决定：满了会返回明确错误，这里不再静默拦截
    if (!config || !artists.length) return;
    setError("");
    setNotice("");
    // 批量占一个额度但仍可与其它任务并行，所以不清空已有的进度与日志
    if (!running) {
      setDownload(null);
      setItems([]);
    }
    setBatch({
      index: 1,
      total: artists.length,
      artist: artists[0],
      phase: "collecting",
      works: 0,
      files: 0,
      failed: 0,
    });
    setTab("tasks");
    try {
      await window.pixiv.setConfig(config);
      const summary = await window.pixiv.batchSync({
        artists,
        tag: worksTag(config),
        outDir: config.outDir,
        workers: config.workers,
        delay: config.delay,
        imageQuality: config.imageQuality,
        ugoiraFormat: config.ugoiraFormat,
      });
      const failedNames = summary.artists
        .filter((item) => item.error)
        .map((item) => item.artist.name);
      if (summary.aborted) {
        setNotice(t("batch.aborted"));
      } else if (failedNames.length === 0) {
        setNotice(t("batch.done", { ok: summary.ok, failed: 0 }));
      } else {
        setError(
          `${t("batch.done", { ok: summary.ok, failed: summary.failed })}：${failedNames.join("、")}`,
        );
      }
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBatch(null);
    }
  };

  /** 加入下载队列：立即返回，任务由主进程按并行额度自动启动 */
  const startDownload = async (): Promise<void> => {
    if (!config) return;
    if (selectedWorks.length === 0) {
      setError(t("app.selectFirst"));
      return;
    }
    setError("");
    setItems([]);
    setTab("tasks");
    try {
      await window.pixiv.setConfig(config);
      setQueue(
        await window.pixiv.enqueueDownload({
          works: selectedWorks,
          tag: worksTag(config),
          outDir: config.outDir,
          workers: config.workers,
          delay: config.delay,
          imageQuality: config.imageQuality,
          ugoiraFormat: config.ugoiraFormat,
        }),
      );
      setNotice(t("app.enqueued", { count: selectedWorks.length }));
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  /** 批量同步是长任务、不进入队列，保留独立的中止入口 */
  const cancelDownload = (): void => {
    void window.pixiv.cancelDownload();
  };

  /** 暂停单个任务：运行中只中止它自己，排队中直接转为未完成 */
  const pauseQueue = async (id: string): Promise<void> => {
    setError("");
    try {
      setQueue(await window.pixiv.pauseQueue(id));
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  /** 继续任务：放回队列后由主进程在额度允许时自动启动 */
  const resumeQueue = async (id: string): Promise<void> => {
    setError("");
    setTab("tasks");
    try {
      setQueue(await window.pixiv.resumeQueue(id));
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  /** 失败清单逐条重试：只放行被点的那一项，其余失败项保持不变 */
  const retryFailure = async (id: string, item: FailureItem): Promise<void> => {
    setError("");
    setTab("tasks");
    try {
      setQueue(await window.pixiv.retryFailure(id, item));
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const removeQueue = async (id: string): Promise<void> => {
    try {
      setQueue(await window.pixiv.removeQueue(id));
      setNotice("");
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const exportFailures = async (id: string): Promise<void> => {
    try {
      const file = await window.pixiv.exportFailures(id);
      if (file) {
        setNotice(t("app.exportFailures", { file }));
        setError("");
      }
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const saveCookie = async (raw: string): Promise<void> => {
    try {
      const status = await window.pixiv.setCookie(raw);
      setCookie(status);
      setError("");
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  /** 保存 App API 凭据：主进程先刷新校验，失败会抛出，由设置面板就地展示 */
  const saveOAuthCredentials = async (
    credentials: OAuthCredentials,
  ): Promise<void> => {
    setOAuth(await window.pixiv.saveOAuthCredentials(credentials));
  };

  /** 打开 pixiv 授权页，用 PKCE 自动换取并保存 refresh_token；取消返回 false */
  const loginOAuth = async (
    clientId: string,
    clientSecret: string,
  ): Promise<boolean> => {
    const status = await window.pixiv.loginOAuth({ clientId, clientSecret });
    if (!status) return false;
    setOAuth(status);
    return true;
  };

  /** 清除 App API 凭据；不影响 Cookie，只影响写操作 */
  const clearOAuth = async (): Promise<void> => {
    setOAuth(await window.pixiv.clearOAuth());
  };

  /** 应用内登录：弹出 pixiv 登录窗口，成功后自动保存 Cookie；取消则不改动现有配置 */
  const loginPixiv = async (): Promise<boolean> => {
    setLoggingIn(true);
    try {
      const status = await window.pixiv.loginPixiv();
      if (!status) return false;
      setCookie(status);
      setError("");
      return true;
    } catch (reason) {
      setError(messageOf(reason));
      return false;
    } finally {
      setLoggingIn(false);
    }
  };

  /** 清除已保存 Cookie，并重置登录窗口的会话，使下次登录必须重新过一遍验证码 */
  const clearCookie = async (): Promise<void> => {
    try {
      const status = await window.pixiv.clearCookie();
      setCookie(status);
      setSelfUser(null);
      setError("");
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const pickDir = async (): Promise<void> => {
    try {
      const dir = await window.pixiv.pickDir();
      if (!dir) return;
      updateConfig({ outDir: dir });
      await window.pixiv.setConfig({ outDir: dir });
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const openDir = (): void => {
    if (!config) return;
    void window.pixiv
      .openDir(config.outDir)
      .catch((reason: unknown) => setError(messageOf(reason)));
  };

  const toggleWork = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    // 和 pixiv 一样按页操作：全选只作用于当前页显示的这批作品
    const allSelected =
      pagedWorks.length > 0 &&
      pagedWorks.every((work) => selected.has(work.id));
    setSelected((previous) => {
      const next = new Set(previous);
      if (allSelected) pagedWorks.forEach((work) => next.delete(work.id));
      else pagedWorks.forEach((work) => next.add(work.id));
      return next;
    });
  };

  const toggleOnlyNew = (): void => {
    const next = !onlyNew;
    setOnlyNew(next);
    setPage(1);
    if (next) void refreshDownloaded(works, config);
  };

  const changeSort = (next: WorkSort): void => {
    setSort(next);
    setPage(1);
  };

  const changePage = (next: number): void => {
    setPage(Math.max(1, Math.min(pageCount, next)));
  };

  const exportWorks = async (): Promise<void> => {
    if (!config || filteredWorks.length === 0) return;
    try {
      const file = await window.pixiv.exportWorks({
        works: sortedWorks,
        tag: worksTag(config),
        downloaded: Array.from(downloaded),
      });
      if (file) {
        setNotice(t("app.exportWorks", { file }));
        setError("");
      }
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  // App 自身的函数体在 I18nProvider 之上，useI18n 取不到配置里的语言，
  // 所以这里直接用纯函数按 locale 取文案（config 未就绪时退回本地缓存）
  const t: Translate = (key, params) =>
    translate(config?.locale ?? bootLocale(), key, params);

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.loadingConfig")}
      </div>
    );
  }

  const collectText =
    collecting && collectProgress
      ? t("app.progress", {
          loaded: collectProgress.loaded,
          total: collectProgress.total,
          done: collectProgress.pagesDone,
          pages: collectProgress.pagesTotal,
        })
      : null;

  const cookieExpired =
    cookieHealth === "expired" &&
    Boolean(cookie?.hasCookie) &&
    !healthDismissed;

  const recheckCookie = async (): Promise<void> => {
    setHealthDismissed(false);
    setCookieHealth(await window.pixiv.checkCookieHealth());
  };

  /** 顶栏导航项统一样式 */
  const navClass = (isActive: boolean): string =>
    `flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
      isActive
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-secondary/50"
    }`;

  return (
    <I18nProvider locale={config.locale}>
      <ImagePreviewProvider>
        <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-background to-background">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <h1 className="text-sm font-semibold leading-5">
                {t("app.title")}
              </h1>
            </div>

            {/* 插画 / 漫画 / 小说 / 用户：切换栏目时保留搜索框里的关键词 */}
            <nav className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 p-0.5">
              <NavLink
                to={linkWithWord("/illust")}
                className={({ isActive }) => navClass(isActive)}
              >
                <Images className="h-3.5 w-3.5" />
                {t("nav.illust")}
              </NavLink>
              <NavLink
                to={linkWithWord("/manga")}
                className={({ isActive }) => navClass(isActive)}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t("nav.manga")}
              </NavLink>
              <NavLink
                to={linkWithWord("/novel")}
                className={({ isActive }) => navClass(isActive)}
              >
                <ScrollText className="h-3.5 w-3.5" />
                {t("nav.novel")}
              </NavLink>
              <NavLink
                to={linkWithWord("/users")}
                className={({ isActive }) => navClass(isActive)}
              >
                <Users className="h-3.5 w-3.5" />
                {t("nav.users")}
              </NavLink>
              <NavLink
                to="/ranking"
                className={({ isActive }) => navClass(isActive)}
              >
                <Trophy className="h-3.5 w-3.5" />
                {t("nav.ranking")}
              </NavLink>
              <NavLink
                to="/recommend"
                className={({ isActive }) => navClass(isActive)}
              >
                <Compass className="h-3.5 w-3.5" />
                {t("nav.recommend")}
              </NavLink>
            </nav>

            {/* 下载工作台 / 图库 / 书库：图标入口，文案放 title 里节省顶栏宽度 */}
            <nav className="flex shrink-0 items-center gap-0.5">
              <NavLink
                to="/workbench"
                title={t("nav.workbench")}
                className={({ isActive }) => navClass(isActive)}
              >
                <Download className="h-3.5 w-3.5" />
              </NavLink>
              <NavLink
                to="/gallery"
                title={t("nav.gallery")}
                className={({ isActive }) => navClass(isActive)}
              >
                <Library className="h-3.5 w-3.5" />
              </NavLink>
              <NavLink
                to="/library"
                title={t("nav.library")}
                className={({ isActive }) => navClass(isActive)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </NavLink>
            </nav>

            {/* 全局搜索：回车在当前栏目下搜索，词同步到 URL；下拉含历史 / 联想 / 热门标签 */}
            <SearchBox
              value={keyword}
              onChange={setKeyword}
              onSubmit={submitSearch}
              placeholder={t("app.searchPlaceholder")}
            />

            <div className="flex shrink-0 items-center gap-1.5">
              <AccountMenu
                selfUser={selfUser}
                hasCookie={Boolean(cookie?.hasCookie)}
                loggingIn={loggingIn}
                onLogin={() => void loginPixiv()}
                onOpenFollowing={() => navigate("/users/following")}
                onOpenFavorites={() => navigate("/favorites")}
                onOpenHistory={() => navigate("/history")}
                onOpenSettings={() => setSettingsOpen(true)}
              />
              <Button
                variant="outline"
                size="sm"
                title={t("app.settings")}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 />
              </Button>
              <Button
                variant="outline"
                size="sm"
                title={t("app.openDir")}
                onClick={openDir}
              >
                <FolderOpen />
              </Button>
            </div>
          </header>

          <Routes>
            {/* 下载工作台保持原来的四标签结构，路由迁到 /workbench */}
            <Route
              path="/workbench"
              element={
                <>
                  <main className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
                    <aside className="min-h-0 border-r border-border/60 px-5 py-4">
                      <CollectPanel
                        config={config}
                        selfUser={selfUser}
                        hasCookie={Boolean(cookie?.hasCookie)}
                        collecting={collecting}
                        queued={queue.length > 0}
                        selectedCount={selectedWorks.length}
                        onConfigChange={updateConfig}
                        onCollect={() => void collect()}
                        onDownload={() => void startDownload()}
                        onSuggestTags={(word) => window.pixiv.suggestTags(word)}
                      />
                    </aside>

                    <section className="flex min-h-0 flex-col gap-3 px-6 py-4">
                      {cookieExpired ? (
                        <CookieExpiredBanner
                          loading={loggingIn}
                          onRelogin={() => void loginPixiv()}
                          onRecheck={() => void recheckCookie()}
                          onDismiss={() => setHealthDismissed(true)}
                        />
                      ) : null}

                      {notice ? (
                        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                          <p className="flex-1 break-all leading-5">{notice}</p>
                          <button
                            type="button"
                            onClick={() => setNotice("")}
                            className="rounded p-0.5 text-emerald-500/70 transition-colors hover:bg-emerald-500/15 hover:text-emerald-500"
                            aria-label={t("app.dismissNotice")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      {error ? (
                        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                          <p className="flex-1 break-all leading-5">{error}</p>
                          <button
                            type="button"
                            onClick={() => setError("")}
                            className="rounded p-0.5 text-destructive/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
                            aria-label={t("app.dismissNotice")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}

                      <Tabs
                        value={tab}
                        onValueChange={setTab}
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        <div className="flex items-center justify-between">
                          <TabsList>
                            <TabsTrigger value="works">
                              <Images className="h-3.5 w-3.5" />
                              {t("app.tabWorks")}
                              {works.length > 0 ? `（${works.length}）` : ""}
                            </TabsTrigger>
                            <TabsTrigger value="tasks">
                              <ListRestart className="h-3.5 w-3.5" />
                              {t("app.tabTasks")}
                              {queue.length > 0 ? `（${queue.length}）` : ""}
                            </TabsTrigger>
                            <TabsTrigger value="log">
                              <ScrollText className="h-3.5 w-3.5" />
                              {t("app.tabLog")}
                              {items.length > 0 ? `（${items.length}）` : ""}
                            </TabsTrigger>
                          </TabsList>

                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {collecting ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {collectText ?? t("app.collectingWorks")}
                              </>
                            ) : null}
                            {running ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                {t("app.downloadRunning")}
                              </>
                            ) : null}
                            {total > 0 && !collecting ? (
                              <span>{t("app.apiTotal", { total })}</span>
                            ) : null}
                          </div>
                        </div>

                        <TabsContent value="works" className="min-h-0">
                          <WorksGrid
                            works={pagedWorks}
                            selected={selected}
                            downloaded={downloaded}
                            downloadedCount={downloadedCount}
                            collecting={collecting}
                            loaded={collectProgress?.loaded ?? 0}
                            total={total}
                            filteredTotal={filteredWorks.length}
                            filteredOut={ruleFiltered.removed}
                            onlyNew={onlyNew}
                            sort={sort}
                            activeFilterCount={activeFilterCount}
                            onSortChange={changeSort}
                            onOpenFilter={() => setFilterOpen(true)}
                            onExport={() => void exportWorks()}
                            page={currentPage}
                            pageCount={pageCount}
                            pageSize={pageSize}
                            onPageChange={changePage}
                            onToggle={toggleWork}
                            onToggleAll={toggleAll}
                            onOpen={setPreview}
                            onToggleOnlyNew={toggleOnlyNew}
                          />
                        </TabsContent>

                        <TabsContent value="tasks" className="min-h-0">
                          {/* 进度与队列集中在这里，主区高度全部留给作品网格 */}
                          <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto pb-2 pr-1">
                            <ProgressPanel
                              jobs={queue}
                              parallel={activeIds.size}
                              parallelJobs={config.parallelJobs}
                              onOpenSettings={() => setSettingsOpen(true)}
                              throttle={throttle}
                              batch={batch}
                              onCancelBatch={cancelDownload}
                            />

                            <QueuePanel
                              jobs={queue}
                              onResume={(id) => void resumeQueue(id)}
                              onPause={(id) => void pauseQueue(id)}
                              onRemove={(id) => void removeQueue(id)}
                              loadFailures={(id) =>
                                window.pixiv.listFailures(id)
                              }
                              onRetryFailure={retryFailure}
                              onExportFailures={(id) => void exportFailures(id)}
                              onOpenDir={(dir) =>
                                void window.pixiv
                                  .openDir(dir)
                                  .catch((reason: unknown) =>
                                    setError(messageOf(reason)),
                                  )
                              }
                            />
                          </div>
                        </TabsContent>

                        <TabsContent value="log" className="min-h-0">
                          <LogPanel items={items} running={running} />
                        </TabsContent>
                      </Tabs>
                    </section>
                  </main>
                </>
              }
            />
            <Route path="/illust" element={<WorksSearchPage kind="illust" />} />
            <Route path="/manga" element={<WorksSearchPage kind="manga" />} />
            <Route path="/novel" element={<NovelSearchPage />} />
            <Route
              path="/novel/series/:seriesId"
              element={<NovelSeriesPage />}
            />
            <Route path="/novel/local" element={<NovelLocalReaderPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/following" element={<UsersFollowingPage />} />
            <Route path="/user/:userId" element={<UserDetailPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/ranking" element={<RankingPage />} />
            <Route path="/recommend" element={<RecommendPage />} />
            <Route
              path="/history"
              element={<HistoryPage />}
            />
            {/* 本地图库独立成页，不再塞在插画的标签里 */}
            <Route
              path="/gallery"
              element={
                <main className="flex min-h-0 flex-1 flex-col px-6 py-4">
                  <LibraryPanel />
                </main>
              }
            />
            <Route path="/library" element={<NovelLibraryPage />} />
            <Route path="/novel/:novelId" element={<NovelReaderPage />} />
            <Route path="*" element={<Navigate to="/illust" replace />} />
          </Routes>

          {preview ? (
            <WorkDetailDialog
              work={preview}
              quality={config.imageQuality}
              selected={selected.has(preview.id)}
              onToggle={toggleWork}
              onClose={() => setPreview(null)}
            />
          ) : null}

          {filterOpen ? (
            <FilterDialog
              config={config}
              onConfigChange={updateConfig}
              onClose={() => {
                setFilterOpen(false);
                persistConfig();
              }}
            />
          ) : null}

          {settingsOpen ? (
            <SettingsDialog
              config={config}
              cookie={cookie}
              selfUser={selfUser}
              proxy={proxy}
              onConfigChange={updateConfig}
              onSaveProxy={saveProxy}
              onTestProxy={testProxy}
              onSaveCookie={saveCookie}
              onLogin={loginPixiv}
              onClearCookie={clearCookie}
              oauth={oauth}
              onSaveOAuth={saveOAuthCredentials}
              onLoginOAuth={loginOAuth}
              onClearOAuth={clearOAuth}
              onPickDir={() => void pickDir()}
              onOpenDir={openDir}
              onClose={() => {
                setSettingsOpen(false);
                persistConfig();
              }}
            />
          ) : null}
        </div>
      </ImagePreviewProvider>
    </I18nProvider>
  );
}
