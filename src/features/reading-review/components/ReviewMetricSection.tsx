import type { ReactNode } from "react";
import { BarChart3, CalendarDays, Clock3, Compass } from "lucide-react";
import { formatDuration } from "../../../lib/formatters";
import type {
  ReadingCategory,
  ReadingStats,
  ReadingStatsMode,
  ReadingTimeBucket
} from "../../../lib/types";
import { formatReadingStatsBucketLabel } from "../../../pages/reading-stats-period";
import {
  formatReviewAverageDuration,
  formatReviewCategoryValue
} from "../review-formatters";

type ReviewMetricSectionProps = {
  activeMode: ReadingStatsMode;
  peakBucket?: ReadingTimeBucket;
  stats: ReadingStats;
  topCategory?: ReadingCategory;
};

export function ReviewMetricSection({
  activeMode,
  peakBucket,
  stats,
  topCategory
}: ReviewMetricSectionProps) {
  return (
    <section className="review-metric-grid" aria-label="复盘指标">
      <ReviewMetricCard
        icon={<CalendarDays aria-hidden="true" size={20} />}
        label="阅读天数"
        value={`${stats.readDays ?? 0}天`}
        detail="单日满 1 分钟计入"
      />
      <ReviewMetricCard
        icon={<Clock3 aria-hidden="true" size={20} />}
        label={activeMode === "overall" ? "长期日均" : "自然日均"}
        value={formatReviewAverageDuration(stats)}
        detail={activeMode === "overall" ? "总计周期不强推自然日均" : "用于判断稳定性"}
      />
      <ReviewMetricCard
        icon={<BarChart3 aria-hidden="true" size={20} />}
        label={
          activeMode === "overall"
            ? "高峰年份"
            : activeMode === "annually"
              ? "高峰月份"
              : "高峰分桶"
        }
        value={peakBucket ? formatReadingStatsBucketLabel(stats.mode, peakBucket.startTime) : "暂无"}
        detail={peakBucket ? formatDuration(peakBucket.readTimeSeconds) : "同步后展示"}
      />
      <ReviewMetricCard
        icon={<Compass aria-hidden="true" size={20} />}
        label="主要偏好"
        value={topCategory?.title ?? "暂无"}
        detail={topCategory ? formatReviewCategoryValue(topCategory) : "分类数据不足"}
      />
    </section>
  );
}

function ReviewMetricCard({
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
    <article className="review-metric-card">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
