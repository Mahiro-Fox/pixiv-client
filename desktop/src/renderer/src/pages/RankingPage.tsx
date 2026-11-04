import { Pager } from '@renderer/components/shared/Pager';
import { SearchWorksGrid } from '@renderer/components/shared/WorksGrid';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { usePagedQuery } from '@renderer/hooks/usePagedQuery';
import { usePageActive } from '@renderer/hooks/usePageActive';
import { useKeepAliveScroll } from '@renderer/hooks/useScrollMemory';
import { useI18n } from '@renderer/i18n';
import type { MessageKey } from '@renderer/i18n/messages';
import type {
  AppRankingFilter,
  AppRankingMode,
  OAuthStatus,
  RankingMode,
  RankingResult,
  WorkSearchKind,
} from '@shared/types';
import { ChevronDown, Loader2, RefreshCw, Trophy } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type * as React from 'react';

/** 未登录时网页 ranking.php 仍可用的榜单 */
const WEB_MODES: RankingMode[] = ['daily', 'weekly', 'monthly', 'rookie'];

/** 网页 mode 的文案 */
const WEB_MODE_KEYS: Record<RankingMode, MessageKey> = {
  daily: 'ranking.mode.daily',
  weekly: 'ranking.mode.weekly',
  monthly: 'ranking.mode.monthly',
  rookie: 'ranking.mode.rookie',
  original: 'ranking.mode.original',
  male: 'ranking.mode.male',
  female: 'ranking.mode.female',
};

/** App 榜单的四个维度；界面上按维度分组选择，请求前再拼成 App mode */
type RankingContent = 'illust' | 'manga';
type RankingPeriod = 'day' | 'week' | 'month';
type RankingCategory = 'general' | 'male' | 'female' | 'original' | 'rookie';
type RankingRating = 'normal' | 'r18' | 'r18g';

interface AppModeParts {
  content: RankingContent;
  period: RankingPeriod;
  category: RankingCategory;
  rating: RankingRating;
}

interface AppModeEntry {
  mode: AppRankingMode;
  parts: AppModeParts;
}

/**
 * App API 实际支持的 19 个 mode 摊平成维度组合。
 * 并不是所有组合都合法（例如男性向只有日榜），所以选了不存在的组合时按「刚改的维度优先」收敛到最近的合法榜单。
 */
const APP_MODE_TABLE: AppModeEntry[] = [
  {
    mode: 'day',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'week',
    parts: {
      content: 'illust',
      period: 'week',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'month',
    parts: {
      content: 'illust',
      period: 'month',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'day_male',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'male',
      rating: 'normal',
    },
  },
  {
    mode: 'day_female',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'female',
      rating: 'normal',
    },
  },
  {
    mode: 'week_original',
    parts: {
      content: 'illust',
      period: 'week',
      category: 'original',
      rating: 'normal',
    },
  },
  {
    mode: 'week_rookie',
    parts: {
      content: 'illust',
      period: 'week',
      category: 'rookie',
      rating: 'normal',
    },
  },
  {
    mode: 'day_r18',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'general',
      rating: 'r18',
    },
  },
  {
    mode: 'week_r18',
    parts: {
      content: 'illust',
      period: 'week',
      category: 'general',
      rating: 'r18',
    },
  },
  {
    mode: 'week_r18g',
    parts: {
      content: 'illust',
      period: 'week',
      category: 'general',
      rating: 'r18g',
    },
  },
  {
    mode: 'day_male_r18',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'male',
      rating: 'r18',
    },
  },
  {
    mode: 'day_female_r18',
    parts: {
      content: 'illust',
      period: 'day',
      category: 'female',
      rating: 'r18',
    },
  },
  {
    mode: 'day_manga',
    parts: {
      content: 'manga',
      period: 'day',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'week_manga',
    parts: {
      content: 'manga',
      period: 'week',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'month_manga',
    parts: {
      content: 'manga',
      period: 'month',
      category: 'general',
      rating: 'normal',
    },
  },
  {
    mode: 'week_rookie_manga',
    parts: {
      content: 'manga',
      period: 'week',
      category: 'rookie',
      rating: 'normal',
    },
  },
  {
    mode: 'day_r18_manga',
    parts: {
      content: 'manga',
      period: 'day',
      category: 'general',
      rating: 'r18',
    },
  },
  {
    mode: 'week_r18_manga',
    parts: {
      content: 'manga',
      period: 'week',
      category: 'general',
      rating: 'r18',
    },
  },
  {
    mode: 'week_r18g_manga',
    parts: {
      content: 'manga',
      period: 'week',
      category: 'general',
      rating: 'r18g',
    },
  },
];

const PARTS_KEY = (parts: AppModeParts): string =>
  `${parts.content}|${parts.period}|${parts.category}|${parts.rating}`;

const APP_PARTS = new Map<AppRankingMode, AppModeParts>(
  APP_MODE_TABLE.map((entry) => [entry.mode, entry.parts])
);
const APP_MODE_BY_KEY = new Map<string, AppRankingMode>(
  APP_MODE_TABLE.map((entry) => [PARTS_KEY(entry.parts), entry.mode])
);

const DEFAULT_PARTS: AppModeParts = {
  content: 'illust',
  period: 'day',
  category: 'general',
  rating: 'normal',
};

const PART_KEYS: (keyof AppModeParts)[] = [
  'content',
  'period',
  'category',
  'rating',
];

/** 组合不存在时：先保留刚改的维度，再把其余三个维度逐项匹配，选最接近的合法榜单 */
function resolveSelection(
  parts: AppModeParts,
  changed: keyof AppModeParts
): AppModeParts {
  if (APP_MODE_BY_KEY.has(PARTS_KEY(parts))) return parts;

  const preferred = APP_MODE_TABLE.filter(
    (entry) => entry.parts[changed] === parts[changed]
  );
  const candidates = preferred.length > 0 ? preferred : APP_MODE_TABLE;

  let best = candidates[0]?.parts ?? DEFAULT_PARTS;
  let bestScore = -1;
  for (const entry of candidates) {
    let score = 0;
    for (const key of PART_KEYS) {
      if (key !== changed && entry.parts[key] === parts[key]) score += 1;
    }
    if (score > bestScore) {
      best = entry.parts;
      bestScore = score;
    }
  }
  return best;
}

/** 维度值 → 文案键 */
const CONTENT_KEYS: Record<RankingContent, MessageKey> = {
  illust: 'ranking.kind.illust',
  manga: 'ranking.kind.manga',
};

const PERIOD_KEYS: Record<RankingPeriod, MessageKey> = {
  day: 'ranking.period.day',
  week: 'ranking.period.week',
  month: 'ranking.period.month',
};

const CATEGORY_KEYS: Record<RankingCategory, MessageKey> = {
  general: 'ranking.category.general',
  male: 'ranking.category.male',
  female: 'ranking.category.female',
  original: 'ranking.category.original',
  rookie: 'ranking.category.rookie',
};

const RATING_KEYS: Record<RankingRating, MessageKey> = {
  normal: 'ranking.rating.normal',
  r18: 'ranking.rating.r18',
  r18g: 'ranking.rating.r18g',
};

const CONTENTS: RankingContent[] = ['illust', 'manga'];
const PERIODS: RankingPeriod[] = ['day', 'week', 'month'];
const CATEGORIES: RankingCategory[] = [
  'general',
  'male',
  'female',
  'original',
  'rookie',
];
const RATINGS: RankingRating[] = ['normal', 'r18', 'r18g'];

/** App 来源的内容过滤参数，网页接口忽略它 */
const FILTERS: AppRankingFilter[] = ['for_android', 'for_ios']

/** 会被记住的筛选参数；不含 page，切页后仍从第一页开始 */
const FILTER_KEYS = ['mode', 'kind', 'date', 'filter'] as const

/** 侧栏跳回排行榜时用它恢复上次筛选，避免 NavLink 的 /ranking 丢掉 query */
export const RANKING_FILTER_KEY = 'pixiv:ranking:filters';

/** 界面用 YYYY-MM-DD（原生日期控件），接口要 YYYYMMDD */
function toInputDate(value: string): string {
  const text = String(value || '').trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function toApiDate(value: string): string {
  const text = toInputDate(value);
  return text.replace(/-/g, '');
}

function formatApiDate(value: string): string {
  return toInputDate(value) || value;
}

/**
 * 官方排行榜页，按登录状态分两套：
 * - 未登录：网页 ranking.php，只展示它仍然可用的 4 个周期榜；
 * - 已连接 App API：/v1/illust/ranking，把 19 个 mode 拆成「内容 / 周期 / 分类 / 分级」四个维度，
 *   选完再拼回 App 的 mode 字符串，附带内容过滤参数。
 * 筛选区可折叠，折叠后只留一行摘要，避免占掉过多高度。
 */
export function RankingPage({
  oauth,
}: {
  oauth: OAuthStatus | null;
}): React.JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  /** 默认折叠，需要时再展开 */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** keep-alive 缓存期间 useSearchParams 读到的是全局位置，切走时不能拿别的页面的空参数覆盖记录 */
  const active = usePageActive();

  /**
   * 侧栏 NavLink 固定跳到 /ranking，会把 URL 里的筛选参数清空。
   * 这里把最后一次筛选存起来，排行榜入口再点回来时由导航带着它恢复。
   */
  useEffect(() => {
    if (!active) return;
    const saved = new URLSearchParams();
    FILTER_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) saved.set(key, value);
    });
    try {
      localStorage.setItem(RANKING_FILTER_KEY, saved.toString());
    } catch {
      // 存储不可用时只影响「切页保留筛选」，不影响页面本身
    }
  }, [params, active]);

  const loggedIn = oauth?.connected === true;
  const kind: WorkSearchKind =
    params.get('kind') === 'manga' ? 'manga' : 'illust';

  const rawMode = params.get('mode') || '';
  const webMode: RankingMode = WEB_MODES.includes(rawMode as RankingMode)
    ? (rawMode as RankingMode)
    : 'daily';
  /** URL 里存的是拼好的 App mode；旧链接里的网页 mode 会按 kind 落到默认的 App 榜单 */
  const appMode: AppRankingMode = APP_PARTS.has(rawMode as AppRankingMode)
    ? (rawMode as AppRankingMode)
    : kind === 'manga'
      ? 'day_manga'
      : 'day';
  const appParts = APP_PARTS.get(appMode) ?? DEFAULT_PARTS;
  const mode: RankingMode | AppRankingMode = loggedIn ? appMode : webMode;

  const filter: AppRankingFilter =
    params.get('filter') === 'for_ios' ? 'for_ios' : 'for_android';
  /** URL 里保留 YYYY-MM-DD，便于日期控件直接回填 */
  const date = toInputDate(params.get('date') || '');
  const page = Math.max(1, Math.round(Number(params.get('page') || 1) || 1));

  /** 滚动位置记忆：本页的滚动容器就是外层 main，keep-alive 激活时由 hook 拨回原位 */
  const scroll = useKeepAliveScroll<HTMLElement>('ranking');

  const {
    data: result,
    loading,
    reload,
  } = usePagedQuery<RankingResult>({
    page,
    signature: [loggedIn ? 'app' : 'web', kind, mode, date, filter].join('|'),
    scroll,
    // 凭据状态还没读到时先不请求，避免先打一遍网页接口再切到 App
    skip: oauth === null,
    query: (next) =>
      window.pixiv.listRanking({
        kind,
        mode,
        page: next,
        date: toApiDate(date),
        filter,
      }),
  });

  const apply = (patch: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  };

  /** 网页榜单：切榜单或换日期都要回到第一页 */
  const switchWebMode = (next: RankingMode): void => {
    apply({ mode: next === 'daily' ? '' : next, page: '' });
  };

  /** App 维度选择：把组合收敛到合法榜单后再写回 URL（kind 跟着内容维度走） */
  const updatePart = (
    patch: Partial<AppModeParts>,
    changed: keyof AppModeParts
  ): void => {
    const nextParts = resolveSelection({ ...appParts, ...patch }, changed);
    const nextMode = APP_MODE_BY_KEY.get(PARTS_KEY(nextParts)) ?? appMode;
    apply({
      mode: nextMode,
      kind: nextParts.content === 'illust' ? '' : nextParts.content,
      page: '',
    });
  };

  const modeButtonClass = (active: boolean): string =>
    active
      ? 'rounded-md bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary'
      : 'rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60';

  const groupLabel = 'w-9 shrink-0 text-[11px] text-muted-foreground/70';

  /** 折叠时的一行摘要，保证不开筛选也知道当前选了什么 */
  const summary = (
    loggedIn
      ? [
          t(CONTENT_KEYS[appParts.content]),
          t(PERIOD_KEYS[appParts.period]),
          t(CATEGORY_KEYS[appParts.category]),
          t(RATING_KEYS[appParts.rating]),
          t(
            filter === 'for_ios'
              ? 'ranking.filter.ios'
              : 'ranking.filter.android'
          ),
        ]
      : [
          t(kind === 'manga' ? 'ranking.kind.manga' : 'ranking.kind.illust'),
          t(WEB_MODE_KEYS[webMode]),
        ]
  )
    .concat(date ? [formatApiDate(date)] : [])
    .join(' · ');

  return (
    <main className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 text-primary" />
          {t('ranking.title')}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t('ranking.hint')}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-xs"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            />
            {t('ranking.filters')}
          </Button>
          <span className="text-[11px] text-muted-foreground/70">
            {summary}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={loading}
              onClick={reload}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t('ranking.refresh')}
            </Button>
          </div>
        </div>

        <div
          className="grid transition-all duration-300"
          style={{
            gridTemplateRows: filtersOpen ? '1fr' : '0fr',
          }}
        >
          <div className="flex flex-col gap-2 overflow-hidden border-t border-border/40 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* App 榜单的内容由「内容」维度决定，登录后不再需要插画 / 漫画切换 */}
              {loggedIn ? null : (
                <div className="flex overflow-hidden rounded-md border border-border/70">
                  {(['illust', 'manga'] as WorkSearchKind[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        apply({ kind: key === 'illust' ? '' : key, page: '' })
                      }
                      className={
                        kind === key
                          ? 'bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary'
                          : 'px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50'
                      }
                    >
                      {key === 'illust'
                        ? t('ranking.kind.illust')
                        : t('ranking.kind.manga')}
                    </button>
                  ))}
                </div>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                <Input
                  type="date"
                  value={date}
                  onChange={(event) =>
                    apply({ date: event.target.value, page: '' })
                  }
                  className="w-38 h-8 text-xs"
                />
                {date ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => apply({ date: '', page: '' })}
                  >
                    {t('ranking.latest')}
                  </Button>
                ) : null}
              </div>
            </div>

            {loggedIn ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <span className={groupLabel}>{t('ranking.content')}</span>
                  {CONTENTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => updatePart({ content: item }, 'content')}
                      className={modeButtonClass(appParts.content === item)}
                    >
                      {t(CONTENT_KEYS[item])}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <span className={groupLabel}>{t('ranking.period')}</span>
                  {PERIODS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => updatePart({ period: item }, 'period')}
                      className={modeButtonClass(appParts.period === item)}
                    >
                      {t(PERIOD_KEYS[item])}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <span className={groupLabel}>{t('ranking.category')}</span>
                  {CATEGORIES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => updatePart({ category: item }, 'category')}
                      className={modeButtonClass(appParts.category === item)}
                    >
                      {t(CATEGORY_KEYS[item])}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <span className={groupLabel}>{t('ranking.rating')}</span>
                  {RATINGS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => updatePart({ rating: item }, 'rating')}
                      className={modeButtonClass(appParts.rating === item)}
                    >
                      {t(RATING_KEYS[item])}
                    </button>
                  ))}

                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground/70">
                      {t('ranking.filter')}
                    </span>
                    <div className="flex overflow-hidden rounded-md border border-border/70">
                      {FILTERS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() =>
                            apply({
                              filter: item === 'for_android' ? '' : item,
                              page: '',
                            })
                          }
                          className={
                            filter === item
                              ? 'bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary'
                              : 'px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/50'
                          }
                        >
                          {item === 'for_android'
                            ? t('ranking.filter.android')
                            : t('ranking.filter.ios')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[11px] text-muted-foreground/70">
                  {t('ranking.group.web')}
                </span>
                {WEB_MODES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => switchWebMode(item)}
                    className={modeButtonClass(mode === item)}
                  >
                    {t(WEB_MODE_KEYS[item])}
                  </button>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/80">
              {t('ranking.dateHint')}
            </p>
          </div>
        </div>
      </div>

      {result ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {result.source === 'app'
              ? t('ranking.countApp', { count: result.total })
              : t('ranking.count', { count: result.total })}
          </span>
          <span>
            ·{' '}
            {t(
              result.source === 'app'
                ? 'ranking.source.app'
                : 'ranking.source.web'
            )}
          </span>
          {result.date ? (
            <span>
              · {t('ranking.date', { date: formatApiDate(result.date) })}
            </span>
          ) : null}
          {result.nextDate ? (
            <span className="text-muted-foreground/70">
              ·{' '}
              {t('ranking.nextDate', { date: formatApiDate(result.nextDate) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading && !result ? (
        <div className="h-42 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('works.loading')}
        </div>
      ) : null}

      {result && result.works.length > 0 ? (
        <SearchWorksGrid ref={scroll.ref} works={result.works} />
      ) : null}

      {!loading && result && result.works.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          {t('ranking.empty')}
        </div>
      ) : null}

      {result && result.lastPage > 1 ? (
        <Pager
          page={page}
          lastPage={result.lastPage}
          onChange={(next) => apply({ page: next === 1 ? '' : String(next) })}
          disabled={loading}
        />
      ) : null}
    </main>
  );
}
