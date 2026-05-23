import { startTransition, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  Gauge,
  LibraryBig,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import reportCardBg from "../assets/report-card-bg.png";
import { ReadingRank } from "../components/ReadingRank";
import { ReadingTrend } from "../components/ReadingTrend";
import { formatDuration, formatUnixDate } from "../lib/formatters";
import {
  getCommandErrorMessage,
  getReadingStats,
  syncReadingStats,
  type ReadingStatsResponse
} from "../lib/reading-api";
import type {
  CredentialStatus,
  ReadingCategory,
  ReadingRankItem,
  ReadingStats,
  ReadingStatsMode
} from "../lib/types";

type StatisticsPageProps = {
  credentialStatus?: CredentialStatus;
  cache: Partial<Record<ReadingStatsMode, ReadingStatsResponse>>;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
  onOpenReview: () => void;
  defaultMode?: ReadingStatsMode;
};

const periodOptions: Array<{ mode: ReadingStatsMode; label: string; description: string }> = [
  { mode: "weekly", label: "本周", description: "自然周" },
  { mode: "monthly", label: "本月", description: "默认周期" },
  { mode: "annually", label: "今年", description: "自然年" },
  { mode: "overall", label: "总计", description: "全部历史" }
];

export function StatisticsPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings,
  onOpenReview,
  defaultMode = "monthly"
}: StatisticsPageProps) {
  const [mode, setMode] = useState<ReadingStatsMode>(defaultMode);
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const hasCredential = credentialStatus?.hasCredential === true;
  const response = cache[mode];
  const stats = response?.stats;
  const isOverallMode = mode === "overall";
  const hasStatsData = Boolean(
    stats &&
      ((stats.totalReadTimeSeconds ?? 0) > 0 ||
        (stats.readDays ?? 0) > 0 ||
        stats.buckets.length > 0 ||
        stats.longestItems.length > 0 ||
        stats.categories.length > 0)
  );

  useEffect(() => {
    let isMounted = true;

    async function loadCachedStats() {
      if (cache[mode]) {
        setError(undefined);
        setIsLoadingCache(false);
        return;
      }

      setIsLoadingCache(true);
      setError(undefined);

      try {
        const cached = await getReadingStats(mode);
        if (isMounted) {
          onCacheChange(mode, cached);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingCache(false);
        }
      }
    }

    void loadCachedStats();

    return () => {
      isMounted = false;
    };
  }, [mode, cache, onCacheChange]);

  async function handleSync() {
    if (!hasCredential) {
      setError("请先在设置中保存微信读书 API Key，再同步阅读统计。");
      onOpenSettings();
      return;
    }

    setIsSyncing(true);
    setError(undefined);

    try {
      const synced = await syncReadingStats(mode);
      onCacheChange(mode, synced);
    } catch (syncError) {
      setError(getCommandErrorMessage(syncError));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleModeChange(nextMode: ReadingStatsMode) {
    startTransition(() => {
      setMode(nextMode);
    });
  }

  return (
    <section className="statistics-page" aria-label="阅读统计">
      <section className="stats-hero">
        <img src={reportCardBg} alt="" />
        <div className="stats-hero-copy">
          <p className="section-kicker">阅读统计</p>
          <h3>{periodTitle(mode)}</h3>
          <p>
            {hasStatsData
              ? isOverallMode
                ? `累计资产 ${formatDuration(stats?.totalReadTimeSeconds)}，用于回看长期投入方向、代表书目和稳定偏好。`
                : `总阅读/收听 ${formatDuration(stats?.totalReadTimeSeconds)}，来自微信读书固定周期统计。`
              : "默认读取本月缓存；同步后展示阅读时间、趋势分桶、最长内容和偏好分类。"}
          </p>
          <div className="stats-hero-actions">
            <button
              className="secondary-action stats-sync-action"
              type="button"
              onClick={() => void handleSync()}
              disabled={!hasCredential || isSyncing}
            >
              {isSyncing ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isSyncing ? "同步中" : "同步统计"}
            </button>
            <button
              className="hero-action stats-review-action"
              type="button"
              onClick={onOpenReview}
              disabled={!hasStatsData}
            >
              查看完整复盘
            </button>
          </div>
        </div>
      </section>

      <div className="period-tabs" role="tablist" aria-label="统计周期">
        {periodOptions.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="tab"
            aria-selected={mode === option.mode}
            className={mode === option.mode ? "is-active" : ""}
            onClick={() => handleModeChange(option.mode)}
          >
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </button>
        ))}
      </div>

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="统计同步通过本地 Rust 命令调用 /readdata/detail。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error status-message--actionable" aria-label="统计同步错误">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => void handleSync()}
            disabled={!hasCredential || isSyncing}
          >
            {isSyncing ? "同步中" : "重试同步"}
          </button>
        </div>
      ) : null}

      {response?.syncState?.lastSuccessAt ? (
        <div className="status-message status-message--neutral">
          <CalendarDays aria-hidden="true" size={18} />
          <span>最近成功同步：{formatSyncDate(response.syncState.lastSuccessAt)}</span>
        </div>
      ) : null}

      {isLoadingCache ? (
        <section className="book-detail-loading" aria-label="正在读取统计缓存">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取本地统计缓存</h3>
            <p>如果没有缓存，可以点击同步统计获取当前周期数据。</p>
          </div>
        </section>
      ) : null}

      {!isLoadingCache ? (
        <>
          <section className="stats-summary-row" aria-label="统计摘要">
            {isOverallMode ? (
              <>
                <StatTile
                  icon={<Clock3 aria-hidden="true" size={20} />}
                  label="累计时长"
                  value={formatDuration(stats?.totalReadTimeSeconds)}
                  detail="全部历史累计资产"
                />
                <StatTile
                  icon={<CalendarDays aria-hidden="true" size={20} />}
                  label="长期阅读天数"
                  value={`${stats?.readDays ?? 0}天`}
                  detail="长期持续投入记录"
                />
                <StatTile
                  icon={<Target aria-hidden="true" size={20} />}
                  label="代表方向"
                  value={getTopCategoryTitle(stats)}
                  detail="长期投入最高分类"
                />
                <StatTile
                  icon={<LibraryBig aria-hidden="true" size={20} />}
                  label="长读书目"
                  value={`${stats?.longestItems.length ?? 0}本`}
                  detail="长期高投入内容"
                />
              </>
            ) : (
              <>
                <StatTile
                  icon={<Clock3 aria-hidden="true" size={20} />}
                  label="总时长"
                  value={formatDuration(stats?.totalReadTimeSeconds)}
                  detail="按当前周期累计"
                />
                <StatTile
                  icon={<CalendarDays aria-hidden="true" size={20} />}
                  label="阅读天数"
                  value={`${stats?.readDays ?? 0}天`}
                  detail="单日满 1 分钟计入"
                />
                <StatTile
                  icon={<Clock3 aria-hidden="true" size={20} />}
                  label="自然日均"
                  value={formatDuration(stats?.dayAverageReadTimeSeconds)}
                  detail="不是阅读日均"
                />
                <StatTile
                  icon={compareIcon(stats?.compare)}
                  label="环比"
                  value={formatCompare(stats?.compare)}
                  detail="只在接口返回时展示"
                />
              </>
            )}
          </section>

          {!hasStatsData ? (
            <section className="empty-inline stats-empty" aria-label="统计为空">
              <CalendarDays aria-hidden="true" size={28} />
              <h3>还没有统计缓存</h3>
              <p>选择周期后点击同步统计；自定义日期区间需要后续按固定周期组合计算。</p>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void handleSync()}
                disabled={!hasCredential || isSyncing}
              >
                {isSyncing ? "同步中" : "同步统计"}
              </button>
            </section>
          ) : null}

          {stats ? (
            <div className="stats-layout">
              <ReadingTrend mode={mode} buckets={stats.buckets} />
              <ReadingRank items={stats.longestItems} variant={isOverallMode ? "overall" : "period"} />
              <StatsLocalInsights stats={stats} mode={mode} />
              <AuthorPreferences items={stats.longestItems} mode={mode} />
              <PreferenceCategories categories={stats.categories} mode={mode} />
              <StatsFootnote mode={mode} baseTime={stats.baseTime} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type AuthorPreference = {
  author: string;
  readTimeSeconds: number;
  count: number;
};

function StatsLocalInsights({ stats, mode }: { stats: ReadingStats; mode: ReadingStatsMode }) {
  const insights = buildStatsLocalInsights(stats, mode);

  if (insights.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label="本地统计解读为空">
        <Sparkles aria-hidden="true" size={28} />
        <h3>暂无本地解读</h3>
        <p>同步更多统计数据后，这里会用本地规则解释投入结构，不调用 AI。</p>
      </section>
    );
  }

  return (
    <section className="stats-card stats-local-insights" aria-label="本地统计解读">
      <div className="stats-card-heading">
        <div>
          <p className="section-kicker">本地解读</p>
          <h3>这组数据说明什么</h3>
        </div>
        <span>非 AI</span>
      </div>

      <div className="stats-insight-list">
        {insights.map((insight) => (
          <article className={`stats-insight-card is-${insight.tone}`} key={insight.label}>
            <span className="stats-insight-icon">{insight.icon}</span>
            <div>
              <strong>{insight.label}</strong>
              <p>{insight.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AuthorPreferences({ items, mode }: { items: ReadingRankItem[]; mode: ReadingStatsMode }) {
  const authors = buildAuthorPreferences(items);
  const maxReadTime = Math.max(...authors.map((author) => author.readTimeSeconds), 1);
  const isOverallMode = mode === "overall";

  if (authors.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label="暂无作者偏好">
        <LibraryBig aria-hidden="true" size={28} />
        <h3>暂无作者偏好</h3>
        <p>当前周期缺少可聚合的作者信息时，这里会保持为空。</p>
      </section>
    );
  }

  return (
    <section className="stats-card author-preference-card" aria-label="作者偏好">
      <div className="stats-card-heading">
        <div>
          <p className="section-kicker">作者偏好</p>
          <h3>{isOverallMode ? "长期常读作者" : "读得最多的作者"}</h3>
        </div>
        <span>{authors.length} 位</span>
      </div>

      <div className="author-cloud stats-scroll-list">
        {authors.map((author) => {
          const weight = Math.max(0.72, author.readTimeSeconds / maxReadTime);
          const chipStyle = {
            "--weight-alpha": String(0.06 + weight * 0.12),
            "--weight-size": `${14 + weight * 5}px`
          } as CSSProperties;

          return (
            <article className="author-chip" key={author.author} style={chipStyle}>
              <strong>{author.author}</strong>
              <small>
                {formatDuration(author.readTimeSeconds)} · {author.count} 本
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="stats-tile">
      <span className="stats-tile-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function buildAuthorPreferences(items: ReadingRankItem[]): AuthorPreference[] {
  const authorMap = new Map<string, AuthorPreference>();

  for (const item of items) {
    const author = normalizeAuthorName(item.author);
    if (!author) {
      continue;
    }

    const current = authorMap.get(author) ?? { author, readTimeSeconds: 0, count: 0 };
    authorMap.set(author, {
      ...current,
      readTimeSeconds: current.readTimeSeconds + Math.max(0, item.readTimeSeconds),
      count: current.count + 1
    });
  }

  return Array.from(authorMap.values()).sort((left, right) => {
    if (right.readTimeSeconds !== left.readTimeSeconds) {
      return right.readTimeSeconds - left.readTimeSeconds;
    }

    return right.count - left.count;
  });
}

function normalizeAuthorName(author?: string): string | undefined {
  const normalized = author?.trim();
  if (!normalized || normalized === "有声内容" || normalized === "电子书") {
    return undefined;
  }

  return normalized;
}

function buildStatsLocalInsights(stats: ReadingStats, mode: ReadingStatsMode): Array<{
  label: string;
  text: string;
  tone: "green" | "blue" | "gold";
  icon: ReactNode;
}> {
  if (mode === "overall") {
    return buildOverallStatsLocalInsights(stats);
  }

  const totalReadTimeSeconds = Math.max(0, stats.totalReadTimeSeconds ?? 0);
  const insights: Array<{
    label: string;
    text: string;
    tone: "green" | "blue" | "gold";
    icon: ReactNode;
  }> = [];
  const topCategory = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];
  const categoryTotal = stats.categories.reduce((sum, category) => sum + categoryValue(category), 0);

  if (topCategory) {
    const share = formatPercent(safeRatio(categoryValue(topCategory), categoryTotal || totalReadTimeSeconds));
    insights.push({
      label: "投入最多的分类",
      text: `${topCategory.title} 是当前周期最重投入的方向，约占分类投入 ${share}。`,
      tone: "green",
      icon: <Target aria-hidden="true" size={18} />
    });
  }

  const topItem = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)[0];
  const longestTotal = stats.longestItems.reduce((sum, item) => sum + Math.max(0, item.readTimeSeconds), 0);

  if (topItem) {
    const share = formatPercent(safeRatio(topItem.readTimeSeconds, longestTotal || totalReadTimeSeconds));
    insights.push({
      label: "最长内容占比",
      text: `《${topItem.title}》贡献了重点内容时长的 ${share}，${Number.parseInt(share, 10) >= 50 ? "说明注意力较集中" : "说明投入没有被单本内容完全占据"}。`,
      tone: "blue",
      icon: <Gauge aria-hidden="true" size={18} />
    });
  }

  const activeBuckets = stats.buckets.filter((bucket) => bucket.readTimeSeconds > 0);
  if (activeBuckets.length > 0) {
    const bucketTotal = activeBuckets.reduce((sum, bucket) => sum + Math.max(0, bucket.readTimeSeconds), 0);
    const peakBucket = activeBuckets.reduce((peak, bucket) =>
      bucket.readTimeSeconds > peak.readTimeSeconds ? bucket : peak
    );
    const peakShare = safeRatio(peakBucket.readTimeSeconds, bucketTotal);
    insights.push({
      label: "节奏集中度",
      text:
        peakShare >= 0.5
          ? `最高分桶占有效分桶时长 ${formatPercent(peakShare)}，阅读明显集中在少数时间段。`
          : `最高分桶占有效分桶时长 ${formatPercent(peakShare)}，阅读节奏相对分散。`,
      tone: "gold",
      icon: <Clock3 aria-hidden="true" size={18} />
    });
  }

  if (Number.isFinite(stats.compare)) {
    const compare = stats.compare ?? 0;
    insights.push({
      label: "周期变化",
      text:
        compare > 0
          ? `阅读时长较上一周期增加 ${formatPercent(compare)}，可以继续观察这是否来自固定习惯。`
          : compare < 0
            ? `阅读时长较上一周期减少 ${formatPercent(Math.abs(compare))}，适合检查是否被单个事件打断。`
            : "阅读时长和上一周期基本持平，节奏暂时稳定。",
      tone: compare < 0 ? "gold" : "green",
      icon:
        compare < 0 ? (
          <TrendingDown aria-hidden="true" size={18} />
        ) : (
          <TrendingUp aria-hidden="true" size={18} />
        )
    });
  }

  return insights.slice(0, 4);
}

function buildOverallStatsLocalInsights(stats: ReadingStats): Array<{
  label: string;
  text: string;
  tone: "green" | "blue" | "gold";
  icon: ReactNode;
}> {
  const insights: Array<{
    label: string;
    text: string;
    tone: "green" | "blue" | "gold";
    icon: ReactNode;
  }> = [];
  const totalReadTimeSeconds = Math.max(0, stats.totalReadTimeSeconds ?? 0);
  const topCategory = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];
  const categoryTotal = stats.categories.reduce((sum, category) => sum + categoryValue(category), 0);

  if (topCategory) {
    insights.push({
      label: "长期投入方向",
      text: `${topCategory.title} 是长期投入最高的代表方向，约占分类投入 ${formatPercent(safeRatio(categoryValue(topCategory), categoryTotal || totalReadTimeSeconds))}。`,
      tone: "green",
      icon: <Target aria-hidden="true" size={18} />
    });
  }

  const topItem = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)[0];
  const longestTotal = stats.longestItems.reduce((sum, item) => sum + Math.max(0, item.readTimeSeconds), 0);

  if (topItem) {
    insights.push({
      label: "长期代表书目",
      text: `《${topItem.title}》是长期高投入内容之一，占长读书目时长 ${formatPercent(safeRatio(topItem.readTimeSeconds, longestTotal || totalReadTimeSeconds))}。`,
      tone: "blue",
      icon: <Gauge aria-hidden="true" size={18} />
    });
  }

  const activeBuckets = stats.buckets.filter((bucket) => bucket.readTimeSeconds > 0);
  if (activeBuckets.length > 0) {
    const peakBucket = activeBuckets.reduce((peak, bucket) =>
      bucket.readTimeSeconds > peak.readTimeSeconds ? bucket : peak
    );
    insights.push({
      label: "年度高峰",
      text: `长期记录中最高投入分桶为 ${formatDuration(peakBucket.readTimeSeconds)}，适合作为回看阅读高峰的锚点。`,
      tone: "gold",
      icon: <Clock3 aria-hidden="true" size={18} />
    });
  }

  return insights.slice(0, 4);
}

function PreferenceCategories({ categories, mode }: { categories: ReadingCategory[]; mode: ReadingStatsMode }) {
  if (categories.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label="暂无偏好分类">
        <CalendarDays aria-hidden="true" size={28} />
        <h3>暂无偏好分类</h3>
        <p>当前周期分类数据不足时，这里会保持为空。</p>
      </section>
    );
  }

  const maxValue = Math.max(
    ...categories.map((category) => category.readingTimeSeconds ?? category.value ?? 0),
    1
  );
  const isOverallMode = mode === "overall";

  return (
    <section className="stats-card preference-card" aria-label="分类偏好">
      <div role="group" aria-label="偏好分类">
        <div className="stats-card-heading">
          <div>
            <p className="section-kicker">偏好分析</p>
            <h3>{isOverallMode ? "长期分类投入" : "阅读分类偏好"}</h3>
          </div>
          <span>最多 8 类</span>
        </div>

        <div className="category-list stats-scroll-list">
          {categories.map((category) => {
            const value = category.readingTimeSeconds ?? category.value ?? 0;
            const width = `${Math.max(6, Math.round((value / maxValue) * 100))}%`;

            return (
              <article className="category-row" key={`${category.categoryId ?? category.title}-${category.title}`}>
                <div>
                  <strong>{category.title}</strong>
                  <small>
                    {category.parentTitle ? `${category.parentTitle} · ` : ""}
                    {category.readingCount !== undefined ? `${category.readingCount} 本` : "分类权重"}
                  </small>
                </div>
                <span>{category.readingTimeSeconds !== undefined ? formatDuration(category.readingTimeSeconds) : ""}</span>
                <i style={{ width }} />
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function categoryValue(category: ReadingCategory): number {
  return Math.max(0, category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0);
}

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return value / total;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.round(value * 100))}%`;
}

function StatsFootnote({ mode, baseTime }: { mode: ReadingStatsMode; baseTime: number }) {
  return (
    <section className="stats-footnote">
      <strong>口径说明</strong>
      <p>
        当前周期：{periodLabel(mode)}；
        {baseTime > 0 ? `统计基准日 ${formatUnixDate(baseTime) || "未知"}` : "总计口径覆盖全部历史"}。
        总时长、阅读天数、趋势变化和分类偏好都来自微信读书的结构化统计缓存。
      </p>
    </section>
  );
}

function periodTitle(mode: ReadingStatsMode): string {
  if (mode === "weekly") {
    return "本周阅读报告";
  }

  if (mode === "annually") {
    return "年度阅读报告";
  }

  if (mode === "overall") {
    return "长期阅读资产";
  }

  return "本月阅读报告";
}

function periodLabel(mode: ReadingStatsMode): string {
  return periodOptions.find((option) => option.mode === mode)?.label ?? "本月";
}

function getTopCategoryTitle(stats?: ReadingStats): string {
  const topCategory = stats?.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];

  return topCategory?.title ?? "暂无";
}

function formatCompare(compare?: number): string {
  if (!Number.isFinite(compare) || compare === undefined) {
    return "暂无";
  }

  const percent = Math.round(Math.abs(compare) * 100);

  if (compare > 0) {
    return `+${percent}%`;
  }

  if (compare < 0) {
    return `-${percent}%`;
  }

  return "持平";
}

function compareIcon(compare?: number) {
  if ((compare ?? 0) < 0) {
    return <TrendingDown aria-hidden="true" size={20} />;
  }

  return <TrendingUp aria-hidden="true" size={20} />;
}

function formatSyncDate(value: string): string {
  const timestamp = Number(value);
  return formatUnixDate(timestamp) || "已同步";
}
