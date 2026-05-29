import { Database, Download, Loader2, RefreshCw, Share2 } from "lucide-react";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingStatsAiReview, ReadingStats } from "../../../lib/types";
import {
  formatReadingStatsPeriodMetricLabel,
  formatReadingStatsPeriodTitle,
  type ReadingStatsPeriod
} from "../../../pages/reading-stats-period";
import type { ReviewStatus } from "../review-page-helpers";

type ReviewHeroSectionProps = {
  activePeriod: ReadingStatsPeriod;
  canGenerate: boolean;
  exportDisabled: boolean;
  hasReview: boolean;
  isExporting: boolean;
  isLoadingReviewCache: boolean;
  isSyncing: boolean;
  review?: ReadingStatsAiReview;
  stats?: ReadingStats;
  status: ReviewStatus;
  statusMeta: { label: string; tone: "warning" | "neutral" | "success" };
  reportActionLabel: string;
  reportDisabled: boolean;
  reportDisabledReason?: string;
  syncDisabled: boolean;
  onExport: () => void;
  onGenerate: () => void;
  onOpenReport: () => void;
  onRegenerate: () => void;
  onSyncStats: () => void;
};

export function ReviewHeroSection({
  activePeriod,
  canGenerate,
  exportDisabled,
  hasReview,
  isExporting,
  isLoadingReviewCache,
  isSyncing,
  review,
  stats,
  status,
  statusMeta,
  reportActionLabel,
  reportDisabled,
  reportDisabledReason,
  syncDisabled,
  onExport,
  onGenerate,
  onOpenReport,
  onRegenerate,
  onSyncStats
}: ReviewHeroSectionProps) {
  return (
    <section className="review-cover-card">
      <div className="review-cover-main">
        <p className="section-kicker">AI 阅读体检报告</p>
        <h3>{formatReadingStatsPeriodTitle(activePeriod, "review")}</h3>
        <p>
          {review?.overview ??
            "把结构化统计转成可行动的复盘报告，并支持在总计、年份、月份之间继续下钻。"}
        </p>
        <div className="review-cover-actions" aria-label="阅读复盘操作">
          <div className="review-cover-action-group" aria-label="复盘生成">
            <button
              className="review-action-button review-action-button--primary"
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate || hasReview}
            >
              {status === "generating" || isLoadingReviewCache ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Database aria-hidden="true" size={18} />
              )}
              {status === "generating"
                ? "生成中"
                : isLoadingReviewCache
                  ? "读取缓存中"
                  : "生成复盘"}
            </button>
            <button
              className="review-action-button review-action-button--secondary"
              type="button"
              onClick={onOpenReport}
              disabled={reportDisabled}
              title={reportDisabledReason}
            >
              <Share2 aria-hidden="true" size={18} />
              {reportActionLabel}
            </button>
            <button
              className="review-action-button review-action-button--secondary"
              type="button"
              onClick={onRegenerate}
              disabled={!canGenerate || !hasReview}
            >
              <RefreshCw aria-hidden="true" size={18} />
              重新生成
            </button>
          </div>
          <div className="review-cover-action-group review-cover-action-group--utility" aria-label="数据与导出">
            <button
              className="review-action-button review-action-button--ghost"
              type="button"
              onClick={onSyncStats}
              disabled={syncDisabled}
            >
              {isSyncing ? (
                <Loader2 aria-hidden="true" size={16} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={16} />
              )}
              {isSyncing ? "同步中" : "同步统计"}
            </button>
            <button
              className="review-action-button review-action-button--secondary"
              type="button"
              onClick={onExport}
              disabled={exportDisabled}
            >
              {isExporting ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isExporting ? "导出中" : "导出 Markdown"}
            </button>
          </div>
        </div>
      </div>
      <div className="review-cover-side">
        <span className={`ai-summary-badge ai-summary-badge--${statusMeta.tone}`}>
          {statusMeta.label}
        </span>
        <strong>{formatDuration(stats?.totalReadTimeSeconds)}</strong>
        <small>{formatReadingStatsPeriodMetricLabel(activePeriod)}总阅读/收听时长</small>
      </div>
    </section>
  );
}
