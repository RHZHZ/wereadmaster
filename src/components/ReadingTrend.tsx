import { BarChart3 } from "lucide-react";
import { BarTrend } from "./BarTrend";
import { LineTrend } from "./LineTrend";
import { ReadingHeatmap } from "./ReadingHeatmap";
import { formatDuration, formatUnixDate } from "../lib/formatters";
import type { ReadingStatsMode, ReadingTimeBucket } from "../lib/types";

type ReadingTrendProps = {
  mode: ReadingStatsMode;
  buckets: ReadingTimeBucket[];
  compare?: number;
};

export function ReadingTrend({ mode, buckets, compare }: ReadingTrendProps) {
  const visibleBuckets = buckets.filter((bucket) => bucket.readTimeSeconds > 0);

  if (visibleBuckets.length === 0) {
    return (
      <section className="empty-inline stats-empty" aria-label="暂无趋势数据">
        <BarChart3 aria-hidden="true" size={28} />
        <h3>暂无趋势分桶</h3>
        <p>同步后会按接口返回的 readTimes 展示趋势，不用分桶反推总时长。</p>
      </section>
    );
  }

  const maxSeconds = Math.max(...visibleBuckets.map((bucket) => bucket.readTimeSeconds), 1);
  const totalSeconds = visibleBuckets.reduce((total, bucket) => total + bucket.readTimeSeconds, 0);
  const peakBucket = visibleBuckets.reduce((peak, bucket) =>
    bucket.readTimeSeconds > peak.readTimeSeconds ? bucket : peak
  );
  const averageSeconds = Math.round(totalSeconds / visibleBuckets.length);
  const chartHeight = visibleBuckets.length <= 5 ? 140 : 170;

  return (
    <section className="stats-card reading-trend" aria-label="阅读趋势">
      <div className="stats-card-heading">
        <div>
          <p className="section-kicker">趋势分桶</p>
          <h3>{trendTitle(mode)}</h3>
        </div>
        <span>{visibleBuckets.length} 个有效分桶</span>
      </div>

      <div className="trend-insights" aria-label="趋势摘要">
        <span>
          <strong>{formatDuration(totalSeconds)}</strong>
          合计阅读
        </span>
        <span>
          <strong>{formatBucketLabel(mode, peakBucket.startTime)}</strong>
          高峰分桶 · {formatDuration(peakBucket.readTimeSeconds)}
        </span>
        <span>
          <strong>{formatDuration(averageSeconds)}</strong>
          平均每个有效分桶
        </span>
      </div>

      {Number.isFinite(compare) ? (
        <p className={`trend-compare-summary ${compareToneClass(compare ?? 0)}`}>
          {formatCompareSummary(compare ?? 0)}
        </p>
      ) : null}

      {mode === "weekly" || mode === "monthly" ? (
        <BarTrend
          buckets={visibleBuckets}
          chartHeight={chartHeight}
          formatBucketLabel={formatBucketLabel}
          maxSeconds={maxSeconds}
          mode={mode}
          peakStartTime={peakBucket.startTime}
          totalSeconds={totalSeconds}
        />
      ) : (
        <LineTrend
          buckets={visibleBuckets}
          formatBucketLabel={formatBucketLabel}
          maxSeconds={maxSeconds}
          mode={mode}
          peakStartTime={peakBucket.startTime}
          totalSeconds={totalSeconds}
        />
      )}

      {mode === "monthly" ? <ReadingHeatmap buckets={buckets} /> : null}
    </section>
  );
}

function trendTitle(mode: ReadingStatsMode): string {
  if (mode === "annually") {
    return "按月阅读时间";
  }

  if (mode === "overall") {
    return "按年阅读时间";
  }

  return "按天阅读时间";
}

function formatBucketLabel(mode: ReadingStatsMode, timestamp: number): string {
  const date = new Date(timestamp * 1000);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  if (mode === "overall") {
    return String(date.getFullYear());
  }

  if (mode === "annually") {
    return `${date.getMonth() + 1}月`;
  }

  const formatted = formatUnixDate(timestamp);
  return formatted ? formatted.slice(5) : "";
}

function formatCompareSummary(compare: number): string {
  const percent = Math.round(Math.abs(compare) * 100);

  if (compare > 0) {
    return `较上一周期增加 ${percent}%`;
  }

  if (compare < 0) {
    return `较上一周期减少 ${percent}%`;
  }

  return "较上一周期基本持平";
}

function compareToneClass(compare: number): string {
  if (compare > 0) {
    return "is-positive";
  }

  if (compare < 0) {
    return "is-negative";
  }

  return "is-neutral";
}
