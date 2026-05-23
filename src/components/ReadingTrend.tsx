import { BarChart3 } from "lucide-react";
import { formatDuration, formatUnixDate } from "../lib/formatters";
import type { ReadingStatsMode, ReadingTimeBucket } from "../lib/types";

type ReadingTrendProps = {
  mode: ReadingStatsMode;
  buckets: ReadingTimeBucket[];
};

export function ReadingTrend({ mode, buckets }: ReadingTrendProps) {
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

      <div className="trend-bars" style={{ minHeight: chartHeight }}>
        {visibleBuckets.map((bucket) => {
          const height = Math.max(10, Math.round((bucket.readTimeSeconds / maxSeconds) * chartHeight));

          return (
            <div className="trend-column" key={bucket.startTime}>
              <span
                className="trend-bar"
                style={{ height }}
                aria-label={`${formatBucketLabel(mode, bucket.startTime)} ${formatDuration(
                  bucket.readTimeSeconds
                )}`}
              />
              <small>{formatBucketLabel(mode, bucket.startTime)}</small>
            </div>
          );
        })}
      </div>
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
