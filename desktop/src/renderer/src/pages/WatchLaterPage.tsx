import { Pager } from '@renderer/components/shared/Pager';
import { WorkCard } from '@renderer/components/shared/WorkCard';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useWorkContextMenu } from '@renderer/hooks/useCardMenu';
import { useLocalPage } from '@renderer/hooks/usePagedQuery';
import { openPreview } from '@renderer/hooks/useWorkPreview';
import { useI18n } from '@renderer/i18n';
import { messageOf } from '@renderer/utils/errors';
import { toast } from '@renderer/utils/toast';
import { recordToSearchWork } from '@renderer/utils/workRecords';
import type { WatchLaterEntry } from '@shared/types';
import { Bookmark, Loader2, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';

const PAGE_SIZE = 24;

/**
 * 稍后看：在作品详情里手动加入的待看列表，只存本地。
 * 与 pixiv 收藏无关（收藏要写服务端、分公开/私密），这里只是本地的快捷书签。
 * 列表规模不大，搜索与分页都在渲染层完成。
 */
export function WatchLaterPage(): React.JSX.Element {
  const { t } = useI18n();
  /** 稍后看的卡片也可右键：加入下载 / 复制链接 / 屏蔽作者 */
  const menu = useWorkContextMenu({ onPreview: openPreview });
  const [items, setItems] = useState<WatchLaterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void window.pixiv
      .listWatchLater()
      .then((result) => {
        if (alive) setItems(result);
      })
      .catch((reason: unknown) => {
        if (alive) toast.error(messageOf(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (entry) =>
        entry.title.toLowerCase().includes(query) ||
        entry.userName.toLowerCase().includes(query) ||
        entry.userId.includes(query) ||
        entry.id.includes(query)
    );
  }, [items, keyword]);

  const { page, lastPage, pageItems, setPage, reset } = useLocalPage(
    filtered,
    PAGE_SIZE
  );

  /** 相对时间与浏览记录页共用文案 */
  const timeText = (at: number): string => {
    const diff = Date.now() - at;
    if (diff < 60_000) return t('history.justNow');
    if (diff < 3_600_000)
      return t('history.minutesAgo', { count: Math.floor(diff / 60_000) });
    if (diff < 86_400_000)
      return t('history.hoursAgo', { count: Math.floor(diff / 3_600_000) });
    return new Date(at).toLocaleDateString();
  };

  /** 移出列表：主进程返回最新列表，直接替换避免本地与落盘数据不一致 */
  const remove = (id: string): void => {
    void window.pixiv
      .removeWatchLater(id)
      .then((result) => {
        setItems(result);
        reset();
      })
      .catch((reason: unknown) => toast.error(messageOf(reason)));
  };

  const clear = (): void => {
    setClearing(true);
    void window.pixiv
      .clearWatchLater()
      .then((result) => {
        setItems(result);
        reset();
        setConfirming(false);
      })
      .catch((reason: unknown) => toast.error(messageOf(reason)))
      .finally(() => setClearing(false));
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bookmark className="h-4 w-4 text-primary" />
            {t('watchLater.title')}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('watchLater.hint')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                reset();
              }}
              placeholder={t('watchLater.searchPlaceholder')}
              className="h-8 w-56 pl-7 text-xs"
            />
            {keyword ? (
              <button
                type="button"
                aria-label={t('watchLater.clearSearch')}
                onClick={() => {
                  setKeyword('');
                  reset();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {confirming ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={clearing}
                onClick={clear}
              >
                {clearing ? <Loader2 className="animate-spin" /> : null}
                {t('watchLater.confirmClear')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirming(false)}
              >
                {t('watchLater.cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={items.length === 0}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
              {t('watchLater.clear')}
            </Button>
          )}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="h-42 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('watchLater.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Bookmark className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm">{t('watchLater.empty')}</p>
            <p className="text-[11px]">{t('watchLater.emptyHint')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-42 flex items-center justify-center text-sm text-muted-foreground">
            {t('watchLater.noMatch')}
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {pageItems.map((entry, index) => (
              <WorkCard
                key={entry.id}
                work={entry}
                index={index}
                onOpen={() => openPreview(recordToSearchWork(entry))}
                onContextMenu={(event) =>
                  menu.onContextMenu(event, recordToSearchWork(entry))
                }
                action={
                  <button
                    type="button"
                    title={t('watchLater.remove')}
                    aria-label={t('watchLater.remove')}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(entry.id);
                    }}
                    className="rounded bg-black/55 p-1 text-white opacity-0 backdrop-blur transition-opacity hover:bg-red-500/85 focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
                meta={
                  <p className="text-[10px] text-muted-foreground/70">
                    {timeText(entry.at)}
                  </p>
                }
              />
            ))}
          </ul>
        )}
      </div>

      {!loading && filtered.length > PAGE_SIZE ? (
        <Pager page={page} lastPage={lastPage} onChange={setPage} />
      ) : null}

      {menu.menuNode}
    </main>
  );
}
