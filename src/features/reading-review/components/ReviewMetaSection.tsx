import {
  formatAiResponseFormat,
  formatAiTimestamp,
} from "../../../lib/formatters";
import type {
  ReadingStats,
  ReadingStatsAiReview,
  ReadingStatsAiReviewResponse,
} from "../../../lib/types";

type ReviewMetaSectionProps = {
  review?: ReadingStatsAiReview;
  reviewResponse?: ReadingStatsAiReviewResponse;
  stats: ReadingStats;
};

export function ReviewMetaSection({
  review,
  reviewResponse,
  stats,
}: ReviewMetaSectionProps) {
  return (
    <>
      <section className="ai-summary-source-card" aria-label="复盘数据依据">
        <div>
          <strong>数据依据</strong>
          <small>
            只发送结构化统计：周期、阅读天数、总时长、趋势分桶、最长内容和分类偏好。
          </small>
        </div>
        <div className="ai-summary-stats">
          <SummaryStat label="分桶" value={stats.buckets.length} />
          <SummaryStat label="最长内容" value={stats.longestItems.length} />
          <SummaryStat label="分类" value={stats.categories.length} />
          <SummaryStat label="阅读天数" value={stats.readDays ?? 0} />
        </div>
      </section>

      <div className="ai-summary-meta">
        <span>
          生成时间：{formatAiTimestamp(review?.generatedAt) || "尚未生成"}
        </span>
        <span>
          Prompt：{review?.promptVersion ?? "reading-stats-review-v2"}
        </span>
        {review?.responseFormat ? (
          <span>{formatAiResponseFormat(review.responseFormat)}</span>
        ) : null}
        {reviewResponse?.providerModel ? (
          <span>模型：{reviewResponse.providerModel}</span>
        ) : null}
        {reviewResponse?.cachedUpdatedAt ? (
          <span>
            缓存更新：{formatAiTimestamp(reviewResponse.cachedUpdatedAt)}
          </span>
        ) : null}
      </div>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}
