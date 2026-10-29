import { Compass, Loader2, RefreshCw, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { useSearchParams } from "react-router-dom";
import type {
  OAuthStatus,
  SearchWork,
  UserSearchItem,
  WorkSearchKind,
} from "@shared/types";
import { useI18n } from "@renderer/i18n";
import { Button } from "@renderer/components/ui/button";
import { UserCard } from "@renderer/components/UserCard";
import { SearchWorkGrid } from "@renderer/components/WorkCard";
import { usePageActive } from "@renderer/lib/pageActive";
import { useKeepAliveScroll } from "@renderer/lib/scrollMemory";
import { useWorkPreview } from "@renderer/lib/workPreview";

/** 续拉去重：接口偶尔会在不同批里返回同一件 */
function appendUnique<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...next.filter((item) => !seen.has(item.id))];
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export interface RecommendPageProps {
  /**
   * App 层的 OAuth 状态（启动时读取，设置里保存 / 登录 / 清除后实时更新）。
   * 由上层传入而不是页面自己读一次，否则在设置里配置好凭据后，
   * 已经挂载的推荐页仍会停在「未连接」的提示上。
   */
  oauth: OAuthStatus | null;
}

/** 某个 kind 的作品批次 */
interface WorksBucket {
  works: SearchWork[];
  next: string;
  /** 这批数据是按什么取的：kind + 连接状态；一致就不再请求 */
  token: string;
}

/**
 * 推荐页：作品与画师两个标签。
 * 两者都走 pixiv App API，需要设置里的 OAuth 凭据；
 * 未连接时作品退回网页发现接口（数量有限），画师标签只给引导提示。
 *
 * 本页被 keep-alive 按 pathname 缓存：进作者主页再回来，数据与滚动位置都还在。
 * 切标签 / 切插画漫画不重新请求（各存一份数据与一个滚动位置），只有「刷新」按钮会重取。
 */
export function RecommendPage({
  oauth,
}: RecommendPageProps): React.JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const { openPreview, previewNode } = useWorkPreview();

  const tab = params.get("tab") === "users" ? "users" : "works";
  const kind: WorkSearchKind =
    params.get("kind") === "manga" ? "manga" : "illust";

  /** 状态还没就绪（App 启动时读取中）时不请求，避免首屏白跑一次兜底接口 */
  const oauthReady = oauth !== null;
  const connected = oauth?.connected ?? false;
  /**
   * 后台时 useSearchParams() 读到的是全局位置（进详情页就变成了空参数），
   * 直接用会把 kind / tab 算错并触发无谓请求，所以后台一律不请求。
   */
  const active = usePageActive();

  /** 作品按 kind 分桶缓存：切插画 / 漫画回来后直接用，不重取 */
  const [worksBuckets, setWorksBuckets] = useState<Record<string, WorksBucket>>(
    {},
  );
  const bucketsRef = useRef(worksBuckets);
  bucketsRef.current = worksBuckets;
  const [worksLoadingKind, setWorksLoadingKind] =
    useState<WorkSearchKind | null>(null);
  const [worksError, setWorksError] = useState("");
  const [worksReload, setWorksReload] = useState(0);

  const bucket = worksBuckets[kind];
  const works = bucket?.works ?? [];
  const worksNext = bucket?.next ?? "";
  const worksLoading = worksLoadingKind === kind;

  const [users, setUsers] = useState<UserSearchItem[]>([]);
  const [usersNext, setUsersNext] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersReload, setUsersReload] = useState(0);
  const [usersLoaded, setUsersLoaded] = useState(false);

  /** 触底自动续拉的哨兵节点 */
  const worksSentinel = useRef<HTMLDivElement | null>(null);
  const usersSentinel = useRef<HTMLDivElement | null>(null);
  /**
   * 滚动位置记忆：本页只有外层 main 在滚动（内部列表没有高度约束）。
   * 键按标签 / 类型分开，切标签回来各自停在原位。
   */
  const scrollKey =
    tab === "users" ? "recommend:users" : `recommend:works:${kind}`;
  const scroll = useKeepAliveScroll<HTMLElement>(scrollKey);

  useEffect(() => {
    if (!active || !oauthReady || tab !== "works") return;
    const token = `${kind}:${connected ? 1 : 0}`;
    // 这个 kind 已经按同样的条件取过，切回来不重复请求
    if (bucketsRef.current[kind]?.token === token) return;

    let alive = true;
    setWorksLoadingKind(kind);
    setWorksError("");
    void window.pixiv
      .listRecommendedWorks({ kind, mode: "all" })
      .then((data) => {
        if (!alive) return;
        setWorksBuckets((previous) => ({
          ...previous,
          [kind]: { works: data.works, next: data.nextUrl, token },
        }));
      })
      .catch((reason: unknown) => {
        if (alive) setWorksError(messageOf(reason));
      })
      .finally(() => {
        if (alive) setWorksLoadingKind(null);
      });
    return () => {
      alive = false;
    };
    // 组件常驻，不再依赖「重新挂载」触发请求，参数变化必须显式进依赖
  }, [active, oauthReady, tab, kind, connected, worksReload]);

  useEffect(() => {
    if (!active || !oauthReady) return;
    if (!connected) {
      // 断开后不保留上一份数据，重新连接时要重新取
      setUsers([]);
      setUsersNext("");
      setUsersError("");
      setUsersLoaded(false);
      return;
    }
    if (tab !== "users") return;
    if (usersLoaded) return;

    let alive = true;
    setUsersLoading(true);
    setUsersError("");
    void window.pixiv
      .listRecommendedUsers({})
      .then((data) => {
        if (!alive) return;
        setUsers(data.users);
        setUsersNext(data.nextUrl);
        setUsersLoaded(true);
      })
      .catch((reason: unknown) => {
        if (alive) setUsersError(messageOf(reason));
      })
      .finally(() => {
        if (alive) setUsersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, oauthReady, tab, connected, usersReload, usersLoaded]);

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  };

  /** 续拉下一批：按 ID 去重后追加 */
  const loadMoreWorks = async (): Promise<void> => {
    if (!worksNext || worksLoading || !bucket) return;
    setWorksLoadingKind(kind);
    setWorksError("");
    try {
      const data = await window.pixiv.listRecommendedWorks({
        kind,
        nextUrl: worksNext,
      });
      setWorksBuckets((previous) => {
        const current = previous[kind];
        if (!current) return previous;
        return {
          ...previous,
          [kind]: {
            ...current,
            works: appendUnique(current.works, data.works),
            next: data.nextUrl,
          },
        };
      });
    } catch (reason) {
      setWorksError(messageOf(reason));
    } finally {
      setWorksLoadingKind(null);
    }
  };

  const loadMoreUsers = async (): Promise<void> => {
    if (!usersNext || usersLoading) return;
    setUsersLoading(true);
    setUsersError("");
    try {
      const data = await window.pixiv.listRecommendedUsers({
        nextUrl: usersNext,
      });
      setUsers((previous) => appendUnique(previous, data.users));
      setUsersNext(data.nextUrl);
    } catch (reason) {
      setUsersError(messageOf(reason));
    } finally {
      setUsersLoading(false);
    }
  };

  /** 触底自动续拉：哨兵进入可视区（含 300px 提前量）就取下一批，替代原来的「加载更多」按钮 */
  useEffect(() => {
    const node =
      tab === "users" ? usersSentinel.current : worksSentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (tab === "users") void loadMoreUsers();
        else void loadMoreWorks();
      },
      { rootMargin: "0px 0px 300px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    tab,
    worksNext,
    usersNext,
    worksLoading,
    usersLoading,
    works.length,
    users.length,
    connected,
    oauthReady,
    kind,
  ]);

  const error = tab === "users" ? usersError : worksError;
  const loading = tab === "users" ? usersLoading : worksLoading;
  const count = tab === "users" ? users.length : works.length;

  return (
    <main className=" flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Compass className="h-4 w-4 text-primary" />
          {t("recommend.title")}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("recommend.hint")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
        <div className="flex overflow-hidden rounded-md border border-border/70">
          {(["works", "users"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => apply({ tab: key === "works" ? "" : key })}
              className={
                tab === key
                  ? "bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary"
                  : "px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50"
              }
            >
              {key === "works"
                ? t("recommend.tabWorks")
                : t("recommend.tabUsers")}
            </button>
          ))}
        </div>

        {/* 网页兜底发现接口没有漫画分类，未连接时隐藏类型切换避免误导 */}
        {tab === "works" && connected ? (
          <div className="flex overflow-hidden rounded-md border border-border/70">
            {(["illust", "manga"] as WorkSearchKind[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => apply({ kind: key === "illust" ? "" : key })}
                className={
                  kind === key
                    ? "bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary"
                    : "px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50"
                }
              >
                {key === "illust"
                  ? t("ranking.kind.illust")
                  : t("ranking.kind.manga")}
              </button>
            ))}
          </div>
        ) : null}

        <span className="text-[11px] text-muted-foreground">
          {t("recommend.count", { count })}
        </span>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 text-xs"
          disabled={loading}
          onClick={() => {
            // 只有这个按钮会清掉当前批次的标记，从而触发重新请求
            if (tab === "users") {
              setUsersLoaded(false);
              scroll.reset();
              setUsersReload((value) => value + 1);
            } else {
              setWorksBuckets((previous) => {
                const next = { ...previous };
                delete next[kind];
                return next;
              });
              scroll.reset();
              setWorksReload((value) => value + 1);
            }
          }}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("recommend.refresh")}
        </Button>
      </div>

      {oauthReady && !connected ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400">
          {tab === "users"
            ? t("recommend.usersNeedOAuthHint")
            : t("recommend.webNotice")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {!oauthReady || (loading && count === 0) ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("works.loading")}
        </div>
      ) : null}

      {oauthReady && tab === "works" ? (
        works.length > 0 ? (
          // shrink-0：不让 main 压缩这一块，保证「只有 main 在滚动」，
          // 否则内部 grid 的 overflow-y-auto 会变成独立滚动区，滚动位置就记到别处去了
            <SearchWorkGrid
              ref={scroll.ref}
              works={works}
              onPreview={openPreview}
              footer={
                <>
                  {loading ? (
                    <div className="flex h-8 items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  ) : null}
                  {worksNext ? (
                    <div ref={worksSentinel} className="h-1" aria-hidden />
                  ) : null}
                </>
              }
            />
        ) : !loading && !error ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            {t("recommend.empty")}
          </div>
        ) : null
      ) : null}

      {oauthReady && tab === "users" ? (
        !connected ? (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-4 py-10 text-center">
            <Users className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              {t("recommend.usersNeedOAuth")}
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              {t("recommend.usersNeedOAuthHint")}
            </p>
          </div>
        ) : users.length > 0 ? (
          <div className="scrollbar-thin overflow-y-auto" ref={scroll.ref}>
            <ul className="flex flex-col gap-2">
              {users.map((user) => (
                <UserCard key={user.id} user={user} onPreview={openPreview} />
              ))}
            </ul>
            {loading ? (
              <div className="flex h-8 items-center justify-center">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : null}
            {usersNext ? (
              <div ref={usersSentinel} className="h-1" aria-hidden />
            ) : null}
          </div>
        ) : !loading && !error ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            {t("recommend.emptyUsers")}
          </div>
        ) : null
      ) : null}

      {previewNode}
    </main>
  );
}
