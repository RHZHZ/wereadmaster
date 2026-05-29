import { useId, type CSSProperties } from "react";
import { ChartTooltip } from "./chart-tooltip/ChartTooltip";
import { useChartTooltip } from "./chart-tooltip/useChartTooltip";
import { buildTrendTooltipData } from "./reading-trend-tooltip";
import type { ReadingStatsMode, ReadingTimeBucket } from "../lib/types";

type LineTrendProps = {
  buckets: ReadingTimeBucket[];
  maxSeconds: number;
  mode: ReadingStatsMode;
  peakStartTime: number;
  totalSeconds: number;
  formatBucketLabel: (mode: ReadingStatsMode, timestamp: number) => string;
};

type ChartPoint = {
  bucket: ReadingTimeBucket;
  key: number;
  label: string;
  x: number;
  y: number;
};

export function LineTrend({
  buckets,
  maxSeconds,
  mode,
  peakStartTime,
  totalSeconds,
  formatBucketLabel
}: LineTrendProps) {
  const chartHeight = 188;
  const chartWidth = Math.max(360, buckets.length * 72);
  const topPadding = 18;
  const bottomPadding = 26;
  const horizontalPadding = 18;
  const innerWidth = Math.max(chartWidth - horizontalPadding * 2, 1);
  const innerHeight = Math.max(chartHeight - topPadding - bottomPadding, 1);
  const points: ChartPoint[] = buckets.map((bucket, index) => {
    const ratio = maxSeconds > 0 ? bucket.readTimeSeconds / maxSeconds : 0;
    const x =
      buckets.length === 1
        ? chartWidth / 2
        : horizontalPadding + (innerWidth * index) / (buckets.length - 1);
    const y = topPadding + (1 - ratio) * innerHeight;

    return {
      bucket,
      key: bucket.startTime,
      label: formatBucketLabel(mode, bucket.startTime),
      x,
      y
    };
  });

  const linePath = buildLinePath(points);
  const areaPath = buildAreaPath(points, chartHeight - bottomPadding);
  const lineId = `trend-area-${mode}-${buckets[0]?.startTime ?? 0}-${buckets.length}`;
  const peakPoint = points.find((point) => point.key === peakStartTime);
  const tooltipDataByKey = new Map(
    points.map((point) => [
      point.key,
      buildTrendTooltipData({
        bucket: point.bucket,
        isPeak: point.key === peakStartTime,
        label: point.label,
        totalSeconds
      })
    ])
  );
  const tooltipId = useId();
  const { activeKey, containerRef, getTriggerProps, isActive } = useChartTooltip<
    number,
    HTMLDivElement
  >();
  const activePoint = points.find((point) => point.key === activeKey) ?? null;
  const activePointIndex = activePoint ? points.findIndex((point) => point.key === activePoint.key) : -1;
  const activeTooltipId = activePoint ? `${tooltipId}-${activePoint.key}` : undefined;
  const labelStyle = {
    gridTemplateColumns: `repeat(${points.length}, minmax(48px, 1fr))`,
    minWidth: `${chartWidth}px`
  } satisfies CSSProperties;
  const hotspotHeight = chartHeight - bottomPadding + 10;
  const activeTooltipData = activePoint ? tooltipDataByKey.get(activePoint.key) ?? null : null;

  return (
    <div className="trend-line-wrap">
      <div className="trend-line-stage" ref={containerRef} style={{ minWidth: chartWidth }}>
        <svg
          className="trend-line-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          aria-label="阅读趋势折线图"
          role="img"
        >
          <defs>
            <linearGradient id={lineId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(47, 111, 94, 0.32)" />
              <stop offset="100%" stopColor="rgba(47, 111, 94, 0.02)" />
            </linearGradient>
          </defs>

          {[0.2, 0.5, 0.8].map((ratio) => {
            const y = topPadding + innerHeight * ratio;
            return (
              <line
                key={ratio}
                className="trend-line-grid"
                x1={horizontalPadding}
                y1={y}
                x2={chartWidth - horizontalPadding}
                y2={y}
              />
            );
          })}

          <path className="trend-line-area" d={areaPath} fill={`url(#${lineId})`} />
          <path className="trend-line-path" d={linePath} />

          {points.map((point) => {
            const isPeak = point.key === peakStartTime;
            const isCurrent = isActive(point.key);

            return (
              <g key={point.key}>
                {isPeak ? (
                  <circle className="trend-line-peak-ring" cx={point.x} cy={point.y} r="9" />
                ) : null}
                {isCurrent ? (
                  <circle className="trend-line-active-ring" cx={point.x} cy={point.y} r="11" />
                ) : null}
                <circle
                  className={`trend-line-dot${isPeak ? " is-peak" : ""}${isCurrent ? " is-active" : ""}`}
                  cx={point.x}
                  cy={point.y}
                  r={isCurrent ? "5.5" : "4.5"}
                />
              </g>
            );
          })}

          {peakPoint ? (
            <g className="trend-line-peak-label">
              <rect
                x={Math.max(peakPoint.x - 26, horizontalPadding)}
                y={Math.max(peakPoint.y - 30, 2)}
                width="52"
                height="20"
                rx="10"
              />
              <text x={peakPoint.x} y={Math.max(peakPoint.y - 17, 16)} textAnchor="middle">
                高峰
              </text>
            </g>
          ) : null}
        </svg>

        <div className="trend-line-hotspots" style={{ height: hotspotHeight, top: 0 }}>
          {points.map((point, index) => {
            const previousX = points[index - 1]?.x ?? horizontalPadding;
            const nextX = points[index + 1]?.x ?? chartWidth - horizontalPadding;
            const left = index === 0 ? horizontalPadding : (previousX + point.x) / 2;
            const right =
              index === points.length - 1 ? chartWidth - horizontalPadding : (point.x + nextX) / 2;
            const width = Math.max(right - left, 44);
            const currentTooltipId = `${tooltipId}-${point.key}`;

            return (
              <button
                key={point.key}
                type="button"
                className={`trend-line-hotspot${isActive(point.key) ? " is-active" : ""}`}
                style={{ left, width }}
                aria-label={`${point.label} ${tooltipDataByKey.get(point.key)?.rows[0]?.value ?? ""}`}
                {...getTriggerProps(point.key, currentTooltipId)}
              />
            );
          })}
        </div>

        {activePoint && activeTooltipData ? (
          <ChartTooltip
            align={
              activePointIndex <= 0 ? "start" : activePointIndex >= points.length - 1 ? "end" : "center"
            }
            badge={activeTooltipData.badge}
            className="trend-line-tooltip"
            id={activeTooltipId ?? tooltipId}
            rows={activeTooltipData.rows}
            style={{ left: activePoint.x, top: Math.max(activePoint.y - 12, 76) }}
            title={activeTooltipData.title}
          />
        ) : null}

        <div className="trend-line-labels" style={labelStyle}>
          {points.map((point) => (
            <small className={isActive(point.key) ? "is-active" : undefined} key={point.key}>
              {point.label}
            </small>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildLinePath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function buildAreaPath(points: ChartPoint[], baselineY: number): string {
  if (points.length === 0) {
    return "";
  }

  const line = buildLinePath(points);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];

  return `${line} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}
