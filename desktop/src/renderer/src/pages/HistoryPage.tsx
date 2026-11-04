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
import type { ViewHistoryEntry } from '@shared/types';
import { Clock3, Loader2, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type * as React from 'react';

const PAGE_SIZE = 24;

/**
 * 浏览记录页：打开过作品详情就自动记一条，仅保存在本地。
 * 记录量不大，关键词过滤与分页都在渲染层完成，不再请求主进程。
 */
export function HistoryPage(): React.JSX.Element {
  const { t } = useI18n();
  /** 记录卡片与搜索结果共用同一套右键菜单（下载 / 复制 / 屏蔽作者） */
  const menu = useWorkContextMenu({ onPreview: openPreview });
  const [items, setItems] = useState<ViewHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void window.pixiv
      .listViewHistory()
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

  /** 记录都在本地，取回整表后按关键词过滤 + 分页，不再请求主进程 */
  const { page, lastPage, pageItems, setPage, reset } = useLocalPage(
    filtered,
    PAGE_SIZE
  );

  /** 相对时间：一天以内按分钟/小时，更早的显示日期 */
  const timeText = (at: number): string => {
    const diff = Date.now() - at;
    if (diff < 60_000) return t('history.justNow');
    if (diff < 3_600_000)
      return t('history.minutesAgo', { count: Math.floor(diff / 60_000) });
    if (diff < 86_400_000)
      return t('history.hoursAgo', { count: Math.floor(diff / 3_600_000) });
    return new Date(at).toLocaleDateString();
  };

  const clear = (): void => {
    setClearing(true);
    void window.pixiv
      .clearViewHistory()
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
            <Clock3 className="h-4 w-4 text-primary" />
            {t('history.title')}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('history.hint')}
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
              placeholder={t('history.searchPlaceholder')}
              className="h-8 w-56 pl-7 text-xs"
            />
            {keyword ? (
              <button
                type="button"
                aria-label={t('history.clearSearch')}
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
                {t('history.confirmClear')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirming(false)}
              >
                {t('history.cancel')}
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
              {t('history.clear')}
            </Button>
          )}
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="h-42 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('history.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <Clock3 className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm">{t('history.empty')}</p>
            <p className="text-[11px]">{t('history.emptyHint')}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-42 flex items-center justify-center text-sm text-muted-foreground">
            {t('history.noMatch')}
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
