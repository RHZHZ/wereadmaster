import type { ReactNode } from "react";
import {
  Clock3,
  Gauge,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingStats, ReadingStatsMode } from "../../../lib/types";
import { categoryValue } from "../stats-preference-helpers";

type StatsLocalInsightsProps = {
  mode: ReadingStatsMode;
  stats: ReadingStats;
};

export function StatsLocalInsights({ mode, stats }: StatsLocalInsightsProps) {
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

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return value / total;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.round(value * 100))}%`;
}
