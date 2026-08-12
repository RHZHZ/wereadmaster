import { AlertCircle, Loader2, MessageSquare, RefreshCw, Star } from "lucide-react";
import { formatUnixDate } from "../lib/formatters";
import type { CommandErrorInfo } from "../lib/reading-api";
import type { PublicReview, PublicReviewsResult } from "../lib/types";
import { SkillUpgradeNotice } from "./SkillUpgradeNotice";

type PublicReviewsPanelProps = {
  result?: PublicReviewsResult;
  reviewListType?: number;
  isLoading: boolean;
  isLoadingMore?: boolean;
  error?: CommandErrorInfo;
  paginationError?: CommandErrorInfo;
  onReviewListTypeChange?: (reviewListType: number) => void;
  onRefresh: () => void;
  onLoadMore?: () => void;
};

const publicReviewFilters = [
  { value: 0, label: "全部" },
  { value: 1, label: "推荐" },
  { value: 2, label: "不行" },
  { value: 3, label: "最新" },
  { value: 4, label: "一般" }
] as const;

export function PublicReviewsPanel({
  result,
  reviewListType = result?.reviewListType ?? 0,
  isLoading,
  isLoadingMore = false,
  error,
  paginationError,
  onReviewListTypeChange,
  onRefresh,
  onLoadMore
}: PublicReviewsPanelProps) {
  if (error?.code === "upgrade_required") {
    return <SkillUpgradeNotice error={error} onRetry={onRefresh} className="public-content-panel public-reviews-panel" />;
  }

  const reviews = result?.reviews ?? [];

  return (
    <section className="public-content-panel public-reviews-panel" aria-label="公开点评">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">公开点评</p>
          <h3>其他读者怎么看</h3>
          <p>来自微信读书公开内容，不计入个人笔记。</p>
        </div>
        <button
          className="secondary-action"
          type="button"
          onClick={onRefresh}
          disabled={isLoading || isLoadingMore}
        >
          {isLoading ? <Loader2 aria-hidden="true" size={16} className="spin" /> : <RefreshCw aria-hidden="true" size={16} />}
          {isLoading ? "加载中" : "刷新点评"}
        </button>
      </div>

      <div className="segmented-control public-review-filters" role="group" aria-label="点评筛选">
        {publicReviewFilters.map((filter) => (
          <button
            key={filter.value}
            className={reviewListType === filter.value ? "is-active" : undefined}
            type="button"
            aria-pressed={reviewListType === filter.value}
            onClick={() => onReviewListTypeChange?.(filter.value)}
            disabled={isLoading || isLoadingMore}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="public-content-status is-error" role="status">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{formatPublicReviewError(error)}</span>
        </div>
      ) : null}

      {isLoading && reviews.length === 0 ? (
        <div className="public-content-status" role="status">
          <Loader2 aria-hidden="true" size={18} className="spin" />
          <span>正在读取公开点评</span>
        </div>
      ) : null}

      {!isLoading && !error && reviews.length === 0 ? (
        <div className="public-content-empty">
          <MessageSquare aria-hidden="true" size={24} />
          <strong>暂无可展示公开点评</strong>
          <span>可以稍后刷新，或先根据个人进度和笔记决定下一步。</span>
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <ul className="public-content-list public-review-list">
          {reviews.map((review) => (
            <PublicReviewItem key={review.reviewId} review={review} />
          ))}
        </ul>
      ) : null}

      {paginationError ? (
        <div className="public-content-status is-error" role="status">
          <AlertCircle aria-hidden="true" size={18} />
          <span>更多点评加载失败：{formatPublicReviewError(paginationError)}</span>
        </div>
      ) : null}

      {reviews.length > 0 && result?.hasMore && onLoadMore ? (
        <div className="public-review-pagination">
          <button
            className="secondary-action"
            type="button"
            onClick={onLoadMore}
            disabled={isLoading || isLoadingMore}
          >
            {isLoadingMore ? <Loader2 aria-hidden="true" size={16} className="spin" /> : null}
            {isLoadingMore ? "正在加载" : "加载更多点评"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PublicReviewItem({ review }: { review: PublicReview }) {
  const authorName = review.author?.name || "微信读书用户";
  const starText = formatPublicReviewStars(review.starLevel);
  const timeText = review.createTime ? formatUnixDate(review.createTime) : undefined;

  return (
    <li className="public-content-item public-review-item">
      <div className="public-content-meta public-review-meta">
        <strong>{authorName}</strong>
        {starText ? (
          <span>
            <Star aria-hidden="true" size={14} />
            {starText}
          </span>
        ) : null}
        {review.chapterName ? <span>{review.chapterName}</span> : null}
        {timeText ? <span>{timeText}</span> : null}
      </div>
      <p className="public-review-body">{review.content}</p>
    </li>
  );
}

function formatPublicReviewStars(starLevel?: number): string | undefined {
  if (!starLevel || starLevel < 1) {
    return undefined;
  }

  const labels = ["一星", "二星", "三星", "四星", "五星"];
  return labels[Math.min(Math.trunc(starLevel), 5) - 1];
}

function formatPublicReviewError(error: CommandErrorInfo): string {
  return error.detail && error.detail !== error.message
    ? `${error.message} 诊断：${error.detail}`
    : error.message;
}
