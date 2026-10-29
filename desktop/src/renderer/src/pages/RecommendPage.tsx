import { Compass, Loader2, RefreshCw, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { useLocation, useSearchParams } from "react-router-dom";
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
import { useCachedPage, writePageCache } from "@renderer/lib/pageCache";
import { useScrollMemory } from "@renderer/lib/scrollMemory";
import { useWorkPreview } from "@renderer/lib/workPreview";

/** 无限滚动累积的多页结果快照 */
interface WorksSnapshot {
  works: SearchWork[];
  next: string;
}
interface UsersSnapshot {
  users: UserSearchItem[];
  next: string;
}

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

/**
 * 推荐页：作品与画师两个标签。
 * 两者都走 pixiv App API，需要设置里的 OAuth 凭据；
 * 未连接时作品退回网页发现接口（数量有限），画师标签只给引导提示。
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

  const [works, setWorks] = useState<SearchWork[]>([]);
  const [worksNext, setWorksNext] = useState("");
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState("");
  const [worksReload, setWorksReload] = useState(0);

  const [users, setUsers] = useState<UserSearchItem[]>([]);
  const [usersNext, setUsersNext] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [usersReload, setUsersReload] = useState(0);

  /** 从作者主页后退回来时命中快照，避免推荐列表整体重刷 */
  const worksKey = `recommend:works:${kind}:${connected ? 1 : 0}`;
  const usersKey = "recommend:users";
  /** 后退会复用同一个 location.key；手动切标签 / 换插画漫画是新历史条目，快照视为未命中 */
  const locationKey = useLocation().key;
  /** 本次挂载读到的快照；StrictMode 下 effect 跑两次也拿到同一份 */
  const worksSnapshot = useCachedPage<WorksSnapshot>(worksKey, locationKey);
  const usersSnapshot = useCachedPage<UsersSnapshot>(usersKey, locationKey);
  /** 触底自动续拉的哨兵节点 */
  const worksSentinel = useRef<HTMLDivElement | null>(null);
  const usersSentinel = useRef<HTMLDivElement | null>(null);
  /** 本次渲染是否来自后退快照：只有快照才还原滚动位置 */
  const [restoredWorks, setRestoredWorks] = useState(false);
  const [restoredUsers, setRestoredUsers] = useState(false);
  const scrollRef = useScrollMemory<HTMLElement>(
    tab === "users" ? usersKey : worksKey,
    tab === "users" ? restoredUsers : restoredWorks,
  );

  useEffect(() => {
    if (!oauthReady || tab !== "works") return;
    const key = worksKey;
    if (worksSnapshot) {
      setWorks(worksSnapshot.works);
      setWorksNext(worksSnapshot.next);
      setWorksError("");
      setWorksLoading(false);
      setRestoredWorks(true);
      return;
    }

    let alive = true;
    setRestoredWorks(false);
    setWorksLoading(true);
    setWorksError("");
    // 这是重置批次（切标签 / 切类型 / 刷新），先清空上一批，避免短暂显示旧内容
    setWorks([]);
    setWorksNext("");
    void window.pixiv
      .listRecommendedWorks({ kind, mode: "all" })
      .then((data) => {
        if (!alive) return;
        setWorks(data.works);
        setWorksNext(data.nextUrl);
        writePageCache(key, { works: data.works, next: data.nextUrl }, locationKey);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setWorks([]);
          setWorksNext("");
          setWorksError(messageOf(reason));
        }
      })
      .finally(() => {
        if (alive) setWorksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [oauthReady, tab, kind, connected, worksReload]);

  useEffect(() => {
    if (!oauthReady) return;
    if (tab !== "users" || !connected) {
      // 断开状态下不保留上一份数据，避免重新连接后显示过期列表
      if (!connected) {
        setUsers([]);
        setUsersNext("");
        setUsersError("");
      }
      return;
    }
    if (usersSnapshot) {
      setUsers(usersSnapshot.users);
      setUsersNext(usersSnapshot.next);
      setUsersError("");
      setUsersLoading(false);
      setRestoredUsers(true);
      return;
    }

    let alive = true;
    setRestoredUsers(false);
    setUsersLoading(true);
    setUsersError("");
    void window.pixiv
      .listRecommendedUsers({})
      .then((data) => {
        if (!alive) return;
        setUsers(data.users);
        setUsersNext(data.nextUrl);
        writePageCache(usersKey, { users: data.users, next: data.nextUrl }, locationKey);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setUsers([]);
          setUsersNext("");
          setUsersError(messageOf(reason));
        }
      })
      .finally(() => {
        if (alive) setUsersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [oauthReady, tab, connected, usersReload]);

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  };

  /** 续拉下一批：按 ID 去重后追加，并同步更新快照 */
  const loadMoreWorks = async (): Promise<void> => {
    if (!worksNext || worksLoading) return;
    setWorksLoading(true);
    setWorksError("");
    try {
      const data = await window.pixiv.listRecommendedWorks({
        kind,
        nextUrl: worksNext,
      });
      const merged = appendUnique(works, data.works);
      setWorks(merged);
      setWorksNext(data.nextUrl);
      writePageCache(worksKey, { works: merged, next: data.nextUrl }, locationKey);
    } catch (reason) {
      setWorksError(messageOf(reason));
    } finally {
      setWorksLoading(false);
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
      const merged = appendUnique(users, data.users);
      setUsers(merged);
      setUsersNext(data.nextUrl);
      writePageCache(usersKey, { users: merged, next: data.nextUrl }, locationKey);
    } catch (reason) {
      setUsersError(messageOf(reason));
    } finally {
      setUsersLoading(false);
    }
  };

  /** 触底自动续拉：哨兵进入可视区（含 300px 提前量）就取下一批，替代原来的「加载更多」按钮 */
  useEffect(() => {
    const node = tab === "users" ? usersSentinel.current : worksSentinel.current;
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
    <main
      ref={scrollRef}
      className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4"
    >
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
            if (tab === "users") setUsersReload((value) => value + 1);
            else setWorksReload((value) => value + 1);
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
          // 续拉时不能因为 loading 卸载网格，否则页面塌缩、滚动回顶
          <SearchWorkGrid
            works={works}
            onPreview={openPreview}
            footer={
              <>
                {loading ? (
                  <div className="flex h-8 items-center justify-center">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                ) : null}
                {worksNext ? <div ref={worksSentinel} className="h-1" aria-hidden /> : null}
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
          <div className="scrollbar-thin overflow-y-auto">
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
            {usersNext ? <div ref={usersSentinel} className="h-1" aria-hidden /> : null}
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
