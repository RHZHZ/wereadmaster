import { BarChart3, CalendarDays } from "lucide-react";
import type { ReadingStatsMode, ReadingTimeBucket } from "../../../lib/types";
import { formatReadingStatsBucketLabel } from "../../../pages/reading-stats-period";
import type { ReviewTimelineInsights, ReviewTimelineSegmentInsight } from "../review-page-helpers";
import { ReviewEmptyBlock } from "./ReviewEmptyBlock";
import { ReviewListCard } from "./ReviewListCard";
import { ReviewPanelHeading } from "./ReviewPanelHeading";
import { ReviewTimelineChart } from "./ReviewTimelineChart";

type ReviewTimelineSectionProps = {
  mode: ReadingStatsMode;
  readDays?: number;
  themes: string[];
  timelineInsights: ReviewTimelineInsights;
  buckets: ReadingTimeBucket[];
};

export function ReviewTimelineSection({
  mode,
  readDays,
  themes,
  timelineInsights,
  buckets
}: ReviewTimelineSectionProps) {
  return (
    <section className="review-panel review-timeline-panel" aria-label="阅读时间轴">
      <ReviewPanelHeading
        kicker="阅读时间轴"
        title="按阶段看阅读变化"
        badge={`${buckets.filter((bucket) => bucket.readTimeSeconds > 0).length} 个分桶`}
      />
      <ReviewTimelineChart mode={mode} buckets={buckets} />
      <ReviewTimeSegments
        mode={mode}
        readDays={readDays}
        segments={timelineInsights.segments}
        themes={themes}
        unmatchedInsights={timelineInsights.unmatchedInsights}
      />
    </section>
  );
}

function ReviewTimeSegments({
  mode,
  readDays,
  segments,
  themes,
  unmatchedInsights
}: {
  mode: ReadingStatsMode;
  readDays?: number;
  segments: ReviewTimelineSegmentInsight[];
  themes: string[];
  unmatchedInsights: string[];
}) {
  if (segments.length === 0) {
    return (
      <ReviewEmptyBlock
        icon={<CalendarDays aria-hidden="true" size={22} />}
        text="当前周期还不足以切出阶段变化。"
      />
    );
  }

  return (
    <section className="review-stage-list" aria-label="阅读阶段变化">
      <div className="review-stage-summary">
        <span>{readDays ? `${readDays} 天参与阅读` : "阅读天数不足"}</span>
        <span>{themes.length > 0 ? `${themes.length} 个代表主题` : "等待主题聚合"}</span>
      </div>
      {segments.map((segment) => (
        <article className={`review-stage-card is-${segment.tone}`} key={`${segment.anchorTime}-${segment.title}`}>
          <div className="review-stage-heading">
            <strong>{segment.title}</strong>
            <span>{formatReadingStatsBucketLabel(mode, segment.anchorTime)}</span>
          </div>
          <p>{segment.description}</p>
          {segment.aiInsight ? (
            <div className="review-stage-ai-note">
              <b>AI 对照</b>
              <span>{segment.aiInsight}</span>
            </div>
          ) : null}
        </article>
      ))}
      {themes.length > 0 ? (
        <div className="review-stage-tags" aria-label="代表主题">
          {themes.map((theme) => (
            <span key={theme}>{theme}</span>
          ))}
        </div>
      ) : null}
      {unmatchedInsights.length > 0 ? (
        <ReviewListCard
          title="补充节奏提示"
          icon={<BarChart3 aria-hidden="true" size={18} />}
          items={unmatchedInsights}
          emptyText=""
        />
      ) : null}
    </section>
  );
}
