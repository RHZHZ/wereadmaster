import { Loader2, RefreshCw } from "lucide-react";
import reportCardBg from "../../../assets/report-card-bg.png";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingStats } from "../../../lib/types";
import {
  formatReadingStatsPeriodMetricLabel,
  formatReadingStatsPeriodTitle,
  type ReadingStatsPeriod
} from "../../../pages/reading-stats-period";

type StatsHeroSectionProps = {
  activePeriod: ReadingStatsPeriod;
  hasStatsData: boolean;
  isOverallMode: boolean;
  isReportEnabled: boolean;
  isSyncing: boolean;
  reportActionLabel?: string;
  reportDisabledReason?: string;
  stats?: ReadingStats;
  syncDisabled: boolean;
  onOpenReport: () => void;
  onOpenReview: () => void;
  onSync: () => void;
};

export function StatsHeroSection({
  activePeriod,
  hasStatsData,
  isOverallMode,
  isReportEnabled,
  isSyncing,
  reportActionLabel = "生成阅读报告",
  reportDisabledReason,
  stats,
  syncDisabled,
  onOpenReport,
  onOpenReview,
  onSync
}: StatsHeroSectionProps) {
  return (
    <section className="stats-hero">
      <img src={reportCardBg} alt="" />
      <div className="stats-hero-copy">
        <p className="section-kicker">阅读统计</p>
        <h3>{formatReadingStatsPeriodTitle(activePeriod, "stats")}</h3>
        <p>
          {hasStatsData
            ? isOverallMode
              ? `累计资产 ${formatDuration(stats?.totalReadTimeSeconds)}，用于回看长期投入方向、代表书目和稳定偏好。`
              : `总阅读/收听 ${formatDuration(stats?.totalReadTimeSeconds)}，对应 ${formatReadingStatsPeriodMetricLabel(activePeriod)} 的固定周期统计。`
            : "支持在当前页面内查看总计、历史年份和历史月份的统计表现。"}
        </p>
        <div className="stats-hero-actions">
          <button
            className="secondary-action stats-sync-action"
            type="button"
            onClick={onSync}
            disabled={syncDisabled}
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
          {isReportEnabled ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onOpenReport}
              disabled={!hasStatsData}
              title={!hasStatsData ? reportDisabledReason : undefined}
            >
              {reportActionLabel}
            </button>
          ) : null}
        </div>
        {isReportEnabled && !hasStatsData && reportDisabledReason ? (
          <small className="stats-report-availability">{reportDisabledReason}</small>
        ) : null}
      </div>
    </section>
  );
}
