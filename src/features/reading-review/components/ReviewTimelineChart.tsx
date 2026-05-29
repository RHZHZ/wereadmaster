import { BarChart3 } from "lucide-react";
import { formatDuration } from "../../../lib/formatters";
import type { ReadingStatsMode, ReadingTimeBucket } from "../../../lib/types";
import { ReviewEmptyBlock } from "./ReviewEmptyBlock";

type ReviewTimelineChartProps = {
  mode: ReadingStatsMode;
  buckets: ReadingTimeBucket[];
};

type TimelinePoint = {
  key: string;
  label: string;
  shortLabel: string;
  startTime: number;
  readTimeSeconds: number;
};

type ChartModel = {
  averageSeconds: number;
  chartKind: "bar" | "area";
  effectiveCount: number;
  maxSeconds: number;
  peak?: TimelinePoint;
  points: TimelinePoint[];
  totalSeconds: number;
};

const SVG_WIDTH = 720;
const BAR_HEIGHT = 250;
const AREA_HEIGHT = 300;
const CHART_PADDING = {
  bottom: 34,
  left: 38,
  right: 18,
  top: 22
};

export function ReviewTimelineChart({ mode, buckets }: ReviewTimelineChartProps) {
  const model = buildReviewTimelineChartModel(mode, buckets);

  if (!model) {
    return <ReviewEmptyBlock icon={<BarChart3 aria-hidden="true" size={22} />} text="暂无趋势分桶。" />;
  }

  return (
    <section className={`review-timeline-chart is-${mode}`} aria-label={timelineChartLabel(mode)}>
      <div className="review-timeline-chart-summary" aria-label="时间轴摘要">
        <span>
          <strong>{model.effectiveCount}</strong>
          有效分桶
        </span>
        <span>
          <strong>{formatDuration(model.totalSeconds)}</strong>
          合计投入
        </span>
        <span>
          <strong>{model.peak ? model.peak.shortLabel : "-"}</strong>
          高峰 · {model.peak ? formatDuration(model.peak.readTimeSeconds) : "-"}
        </span>
        <span>
          <strong>{formatDuration(model.averageSeconds)}</strong>
          平均投入
        </span>
      </div>

      {model.chartKind === "bar" ? <TimelineBarChart model={model} /> : <TimelineAreaChart model={model} />}
    </section>
  );
}

function TimelineBarChart({ model }: { model: ChartModel }) {
  const height = BAR_HEIGHT;
  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const slotWidth = innerWidth / model.points.length;
  const barWidth = clamp(slotWidth * 0.56, 16, model.points.length <= 2 ? 66 : 58);
  const averageY = valueToY(model.averageSeconds, model.maxSeconds, innerHeight);

  return (
    <div className="review-timeline-chart-stage">
      <svg className="review-timeline-chart-svg" viewBox={`0 0 ${SVG_WIDTH} ${height}`} role="img">
        <title>{`阅读时间轴柱状图，最高投入 ${
          model.peak ? `${model.peak.label} ${formatDuration(model.peak.readTimeSeconds)}` : "暂无"
        }`}</title>
        <line className="review-timeline-axis" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={height - CHART_PADDING.bottom} y2={height - CHART_PADDING.bottom} />
        <line className="review-timeline-average-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={averageY} y2={averageY} />
        <text className="review-timeline-average-label" x={SVG_WIDTH - CHART_PADDING.right} y={Math.max(averageY - 6, 12)} textAnchor="end">
          平均
        </text>

        {model.points.map((point, index) => {
          const x = CHART_PADDING.left + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = valueToY(point.readTimeSeconds, model.maxSeconds, innerHeight);
          const barHeight = height - CHART_PADDING.bottom - y;
          const isPeak = model.peak?.key === point.key;

          return (
            <g className={`review-timeline-bar-group${isPeak ? " is-peak" : ""}`} key={point.key}>
              <title>{`${point.label} · ${formatDuration(point.readTimeSeconds)}`}</title>
              <rect className="review-timeline-bar-hit" x={x - 3} y={CHART_PADDING.top} width={barWidth + 6} height={innerHeight} rx="8" />
              <rect
                className={`review-timeline-bar${isPeak ? " is-peak" : ""}`}
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, point.readTimeSeconds > 0 ? 4 : 0)}
                rx="8"
              />
              {isPeak ? (
                <circle className="review-timeline-peak-dot" cx={x + barWidth / 2} cy={Math.max(y - 8, CHART_PADDING.top)} r="4" />
              ) : null}
              <text className="review-timeline-chart-label" x={x + barWidth / 2} y={height - 10} textAnchor="middle">
                {point.shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TimelineAreaChart({ model }: { model: ChartModel }) {
  const height = AREA_HEIGHT;
  const innerWidth = SVG_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const coordinates = model.points.map((point, index) => {
    const x =
      model.points.length === 1
        ? CHART_PADDING.left + innerWidth / 2
        : CHART_PADDING.left + (innerWidth * index) / (model.points.length - 1);
    const y = valueToY(point.readTimeSeconds, model.maxSeconds, innerHeight);

    return {
      point,
      x,
      y
    };
  });
  const linePath = buildLinePath(coordinates);
  const areaPath = buildAreaPath(coordinates, height - CHART_PADDING.bottom);
  const averageY = valueToY(model.averageSeconds, model.maxSeconds, innerHeight);
  const peakCoordinate = coordinates.find((item) => item.point.key === model.peak?.key);
  const labelStep = resolveLabelStep(model.points.length);
  const gradientId = `review-timeline-area-${model.points[0]?.key ?? "empty"}-${model.points.length}`;

  return (
    <div className="review-timeline-chart-stage">
      <svg className="review-timeline-chart-svg" viewBox={`0 0 ${SVG_WIDTH} ${height}`} role="img">
        <title>{`阅读时间轴面积趋势图，最高投入 ${
          model.peak ? `${model.peak.label} ${formatDuration(model.peak.readTimeSeconds)}` : "暂无"
        }`}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(47, 111, 94, 0.30)" />
            <stop offset="100%" stopColor="rgba(47, 111, 94, 0.03)" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = CHART_PADDING.top + innerHeight * ratio;
          return <line className="review-timeline-grid-line" key={ratio} x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={y} y2={y} />;
        })}
        <line className="review-timeline-axis" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={height - CHART_PADDING.bottom} y2={height - CHART_PADDING.bottom} />
        <line className="review-timeline-average-line" x1={CHART_PADDING.left} x2={SVG_WIDTH - CHART_PADDING.right} y1={averageY} y2={averageY} />
        <text className="review-timeline-average-label" x={SVG_WIDTH - CHART_PADDING.right} y={Math.max(averageY - 6, 12)} textAnchor="end">
          平均
        </text>

        <path className="review-timeline-area" d={areaPath} fill={`url(#${gradientId})`} />
        <path className="review-timeline-line" d={linePath} />

        {coordinates.map((item, index) => {
          const isPeak = model.peak?.key === item.point.key;

          return (
            <g className={`review-timeline-point-group${isPeak ? " is-peak" : ""}`} key={item.point.key}>
              <title>{`${item.point.label} · ${formatDuration(item.point.readTimeSeconds)}`}</title>
              <circle className="review-timeline-point-hit" cx={item.x} cy={item.y} r="13" />
              <circle className={`review-timeline-point${isPeak ? " is-peak" : ""}`} cx={item.x} cy={item.y} r={isPeak ? "5.5" : "4"} />
              {index % labelStep === 0 || index === coordinates.length - 1 ? (
                <text className="review-timeline-chart-label" x={item.x} y={height - 10} textAnchor="middle">
                  {item.point.shortLabel}
                </text>
              ) : null}
            </g>
          );
        })}

        {peakCoordinate ? (
          <g className="review-timeline-peak-label">
            <rect x={clamp(peakCoordinate.x - 44, CHART_PADDING.left, SVG_WIDTH - CHART_PADDING.right - 88)} y={Math.max(peakCoordinate.y - 34, 4)} width="88" height="22" rx="11" />
            <text x={clamp(peakCoordinate.x, CHART_PADDING.left + 44, SVG_WIDTH - CHART_PADDING.right - 44)} y={Math.max(peakCoordinate.y - 19, 18)} textAnchor="middle">
              高峰 {formatDuration(peakCoordinate.point.readTimeSeconds)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function buildReviewTimelineChartModel(mode: ReadingStatsMode, buckets: ReadingTimeBucket[]): ChartModel | undefined {
  const sortedBuckets = buckets
    .slice()
    .filter((bucket) => bucket.startTime > 0)
    .sort((left, right) => left.startTime - right.startTime);

  if (sortedBuckets.length === 0) {
    return undefined;
  }

  const points = buildTimelinePoints(mode, sortedBuckets);
  const effectivePoints = points.filter((point) => point.readTimeSeconds > 0);

  if (effectivePoints.length === 0) {
    return undefined;
  }

  const totalSeconds = effectivePoints.reduce((sum, point) => sum + point.readTimeSeconds, 0);
  const maxSeconds = Math.max(...effectivePoints.map((point) => point.readTimeSeconds), 1);
  const peak = effectivePoints.reduce((currentPeak, point) =>
    point.readTimeSeconds > currentPeak.readTimeSeconds ? point : currentPeak
  );
  const averageSeconds = Math.round(totalSeconds / effectivePoints.length);

  return {
    averageSeconds,
    chartKind: mode === "weekly" || mode === "annually" || (mode === "overall" && points.length <= 2) ? "bar" : "area",
    effectiveCount: effectivePoints.length,
    maxSeconds,
    peak,
    points,
    totalSeconds
  };
}

function buildTimelinePoints(mode: ReadingStatsMode, buckets: ReadingTimeBucket[]): TimelinePoint[] {
  if (mode === "weekly") {
    return buildWeeklyPoints(buckets);
  }

  if (mode === "monthly") {
    return buildMonthlyPoints(buckets);
  }

  if (mode === "annually") {
    return buildAnnualPoints(buckets);
  }

  return buildOverallPoints(buckets);
}

function buildWeeklyPoints(buckets: ReadingTimeBucket[]): TimelinePoint[] {
  const firstBucket = buckets[0];
  const firstDate = new Date(firstBucket ? firstBucket.startTime * 1000 : Date.now());
  const weekStart = startOfWeek(firstDate);
  const values = aggregateByDateKey(buckets, (date) => dateKey(date));
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  return labels.map((label, index) => {
    const date = addDays(weekStart, index);
    const key = dateKey(date);

    return {
      key,
      label: `${formatMonthDay(date)} ${label}`,
      shortLabel: label,
      startTime: toUnixSeconds(date),
      readTimeSeconds: values.get(key) ?? 0
    };
  });
}

function buildMonthlyPoints(buckets: ReadingTimeBucket[]): TimelinePoint[] {
  const firstBucket = buckets[0];
  const firstDate = new Date(firstBucket ? firstBucket.startTime * 1000 : Date.now());
  const year = firstDate.getFullYear();
  const month = firstDate.getMonth();
  const values = aggregateByDateKey(buckets, (date) => dateKey(date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month, day);
    const key = dateKey(date);

    return {
      key,
      label: `${month + 1}月${day}日`,
      shortLabel: `${month + 1}/${day}`,
      startTime: toUnixSeconds(date),
      readTimeSeconds: values.get(key) ?? 0
    };
  });
}

function buildAnnualPoints(buckets: ReadingTimeBucket[]): TimelinePoint[] {
  const firstBucket = buckets[0];
  const firstDate = new Date(firstBucket ? firstBucket.startTime * 1000 : Date.now());
  const year = firstDate.getFullYear();
  const values = aggregateByDateKey(buckets, (date) => `${date.getFullYear()}-${date.getMonth() + 1}`);

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, index, 1);
    const key = `${year}-${index + 1}`;

    return {
      key,
      label: `${year}年${index + 1}月`,
      shortLabel: `${index + 1}月`,
      startTime: toUnixSeconds(date),
      readTimeSeconds: values.get(key) ?? 0
    };
  });
}

function buildOverallPoints(buckets: ReadingTimeBucket[]): TimelinePoint[] {
  const values = aggregateByDateKey(buckets, (date) => String(date.getFullYear()));
  const years = Array.from(values.keys())
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year))
    .sort((left, right) => left - right);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  if (firstYear === undefined || lastYear === undefined) {
    return [];
  }

  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
    const year = firstYear + index;
    const date = new Date(year, 0, 1);
    const key = String(year);

    return {
      key,
      label: `${year}年`,
      shortLabel: String(year),
      startTime: toUnixSeconds(date),
      readTimeSeconds: values.get(key) ?? 0
    };
  });
}

function aggregateByDateKey(
  buckets: ReadingTimeBucket[],
  getKey: (date: Date) => string
): Map<string, number> {
  const values = new Map<string, number>();

  buckets.forEach((bucket) => {
    const date = new Date(bucket.startTime * 1000);

    if (!Number.isFinite(date.getTime())) {
      return;
    }

    const key = getKey(date);
    values.set(key, (values.get(key) ?? 0) + Math.max(0, bucket.readTimeSeconds));
  });

  return values;
}

function timelineChartLabel(mode: ReadingStatsMode): string {
  if (mode === "weekly") {
    return "周度阅读时间轴";
  }

  if (mode === "monthly") {
    return "月度阅读时间轴";
  }

  if (mode === "annually") {
    return "年度阅读时间轴";
  }

  return "总计阅读时间轴";
}

function valueToY(value: number, maxValue: number, innerHeight: number): number {
  const ratio = maxValue > 0 ? value / maxValue : 0;
  return CHART_PADDING.top + (1 - ratio) * innerHeight;
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baselineY: number): string {
  if (points.length === 0) {
    return "";
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  if (!firstPoint || !lastPoint) {
    return "";
  }

  return `${buildLinePath(points)} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}

function resolveLabelStep(pointCount: number): number {
  if (pointCount <= 8) {
    return 1;
  }

  if (pointCount <= 16) {
    return 2;
  }

  return 5;
}

function startOfWeek(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
