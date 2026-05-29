import { useId } from "react";
import { ChartTooltip } from "./chart-tooltip/ChartTooltip";
import { useChartTooltip } from "./chart-tooltip/useChartTooltip";
import { buildTrendTooltipData } from "./reading-trend-tooltip";
import type { ReadingStatsMode, ReadingTimeBucket } from "../lib/types";

type BarTrendProps = {
  buckets: ReadingTimeBucket[];
  chartHeight: number;
  maxSeconds: number;
  mode: ReadingStatsMode;
  peakStartTime: number;
  totalSeconds: number;
  formatBucketLabel: (mode: ReadingStatsMode, timestamp: number) => string;
};

export function BarTrend({
  buckets,
  chartHeight,
  maxSeconds,
  mode,
  peakStartTime,
  totalSeconds,
  formatBucketLabel
}: BarTrendProps) {
  const tooltipId = useId();
  const { containerRef, getTriggerProps, isActive } = useChartTooltip<number, HTMLDivElement>();

  return (
    <div className="trend-bars" ref={containerRef} style={{ minHeight: chartHeight }}>
      {buckets.map((bucket, index) => {
        const height = Math.max(10, Math.round((bucket.readTimeSeconds / maxSeconds) * chartHeight));
        const isPeak = bucket.startTime === peakStartTime;
        const isCurrent = isActive(bucket.startTime);
        const label = formatBucketLabel(mode, bucket.startTime);
        const tooltipData = buildTrendTooltipData({
          bucket,
          isPeak,
          label,
          totalSeconds
        });
        const align = index === 0 ? "start" : index === buckets.length - 1 ? "end" : "center";
        const currentTooltipId = `${tooltipId}-${bucket.startTime}`;

        return (
          <div
            className={`trend-column${isPeak ? " is-peak" : ""}${isCurrent ? " is-active" : ""}`}
            key={bucket.startTime}
          >
            {isPeak ? <em className="trend-peak-badge">高峰</em> : null}
            <button
              type="button"
              className={`trend-column-hit${isCurrent ? " is-active" : ""}`}
              style={{ minHeight: chartHeight }}
              aria-label={`${label} ${tooltipData.rows[0]?.value ?? ""}`}
              {...getTriggerProps(bucket.startTime, currentTooltipId)}
            >
              {isCurrent ? (
                <ChartTooltip
                  align={align}
                  badge={tooltipData.badge}
                  className="trend-column-tooltip"
                  id={currentTooltipId}
                  rows={tooltipData.rows}
                  title={tooltipData.title}
                />
              ) : null}
              <span className={`trend-bar${isPeak ? " is-peak" : ""}${isCurrent ? " is-active" : ""}`} style={{ height }} />
            </button>
            <small className={isCurrent ? "is-active" : undefined}>{label}</small>
          </div>
        );
      })}
    </div>
  );
}
