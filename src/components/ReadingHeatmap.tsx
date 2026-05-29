import { useId } from "react";
import { formatDuration } from "../lib/formatters";
import { ChartTooltip } from "./chart-tooltip/ChartTooltip";
import { useChartTooltip } from "./chart-tooltip/useChartTooltip";
import type { ReadingTimeBucket } from "../lib/types";

type ReadingHeatmapProps = {
  buckets: ReadingTimeBucket[];
  showHeading?: boolean;
};

type ReadingHeatmapCell =
  | {
      kind: "empty";
      key: string;
    }
  | {
      day: number;
      kind: "day";
      key: string;
      level: 0 | 1 | 2 | 3 | 4;
      label: string;
      value: number;
    };

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function ReadingHeatmap({ buckets, showHeading = true }: ReadingHeatmapProps) {
  const model = buildReadingHeatmapModel(buckets);
  const tooltipId = useId();
  const { containerRef, getTriggerProps, isActive } = useChartTooltip<number, HTMLDivElement>();

  if (!model) {
    return null;
  }

  return (
    <section className="reading-heatmap" aria-label={`${model.monthLabel}阅读热力图`}>
      {showHeading ? (
        <div className="reading-heatmap-heading">
          <div>
            <p className="section-kicker">日历热力图</p>
            <h4>{model.monthLabel} 每日投入</h4>
          </div>
          <span>{model.activeDays} 天有记录</span>
        </div>
      ) : null}

      <p className="reading-heatmap-note">
        {model.peakDay
          ? `高峰日 ${model.peakDay.label}，阅读 ${formatDuration(model.peakDay.value)}。`
          : "当前月份暂无有效阅读记录。"}
      </p>

      <div className="reading-heatmap-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <small key={label}>{label}</small>
        ))}
      </div>

      <div className="reading-heatmap-grid" ref={containerRef}>
        {model.cells.map((cell, index) =>
          cell.kind === "empty" ? (
            <span className="reading-heatmap-cell reading-heatmap-cell--empty" key={cell.key} />
          ) : (
            <div
              className={`reading-heatmap-cell-wrap${isActive(cell.day) ? " is-active" : ""}`}
              key={cell.key}
            >
              <button
                type="button"
                className={`reading-heatmap-cell reading-heatmap-cell-trigger is-level-${cell.level}${
                  isActive(cell.day) ? " is-active" : ""
                }`}
                aria-label={`${cell.label} · ${formatDuration(cell.value)}`}
                {...getTriggerProps(cell.day, `${tooltipId}-${cell.key}`)}
              >
                {isActive(cell.day) ? (
                  <ChartTooltip
                    align={resolveHeatmapTooltipAlign(index)}
                    badge={cell.value === model.peakDay?.value && cell.value > 0 ? "高峰日" : undefined}
                    className="reading-heatmap-tooltip"
                    id={`${tooltipId}-${cell.key}`}
                    rows={[
                      {
                        label: "阅读时长",
                        value: formatDuration(cell.value),
                        tone: "accent"
                      },
                      {
                        label: "热度等级",
                        value: formatHeatLevelLabel(cell.level, cell.value)
                      }
                    ]}
                    title={cell.label}
                  />
                ) : null}
                {cell.day}
              </button>
            </div>
          )
        )}
      </div>

      <div className="reading-heatmap-legend" aria-hidden="true">
        <small>低</small>
        {[0, 1, 2, 3, 4].map((level) => (
          <i className={`reading-heatmap-cell is-level-${level}`} key={level} />
        ))}
        <small>高</small>
      </div>
    </section>
  );
}

function formatHeatLevelLabel(level: 0 | 1 | 2 | 3 | 4, value: number): string {
  if (value <= 0 || level === 0) {
    return "未阅读";
  }

  if (level === 4) {
    return "高";
  }

  if (level >= 2) {
    return "中";
  }

  return "低";
}

function resolveHeatmapTooltipAlign(index: number): "start" | "center" | "end" {
  const column = index % 7;

  if (column <= 1) {
    return "start";
  }

  if (column >= 5) {
    return "end";
  }

  return "center";
}

function buildReadingHeatmapModel(buckets: ReadingTimeBucket[]) {
  const sortedBuckets = buckets
    .slice()
    .filter((bucket) => bucket.startTime > 0)
    .sort((left, right) => left.startTime - right.startTime);

  const firstBucket = sortedBuckets[0];
  if (!firstBucket) {
    return undefined;
  }

  const firstDate = new Date(firstBucket.startTime * 1000);
  if (!Number.isFinite(firstDate.getTime())) {
    return undefined;
  }

  const year = firstDate.getFullYear();
  const month = firstDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const valuesByDay = new Map<number, number>();

  sortedBuckets.forEach((bucket) => {
    const date = new Date(bucket.startTime * 1000);
    if (date.getFullYear() !== year || date.getMonth() !== month) {
      return;
    }

    const day = date.getDate();
    valuesByDay.set(day, (valuesByDay.get(day) ?? 0) + Math.max(0, bucket.readTimeSeconds));
  });

  const activeValues = Array.from(valuesByDay.values()).filter((value) => value > 0);
  const maxValue = Math.max(...activeValues, 1);
  const cells: ReadingHeatmapCell[] = [];

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    cells.push({
      kind: "empty",
      key: `empty-${index}`
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = valuesByDay.get(day) ?? 0;
    cells.push({
      day,
      kind: "day",
      key: `${year}-${month + 1}-${day}`,
      label: `${year}年${month + 1}月${day}日`,
      level: resolveHeatLevel(value, maxValue),
      value
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      kind: "empty",
      key: `tail-${cells.length}`
    });
  }

  const peakDay = cells.reduce<
    | {
        label: string;
        value: number;
      }
    | undefined
  >((peak, cell) => {
    if (cell.kind !== "day" || cell.value <= 0) {
      return peak;
    }

    if (!peak || cell.value > peak.value) {
      return {
        label: cell.label,
        value: cell.value
      };
    }

    return peak;
  }, undefined);

  return {
    activeDays: activeValues.length,
    cells,
    monthLabel: `${year}年${month + 1}月`,
    peakDay
  };
}

function resolveHeatLevel(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(value) || value <= 0 || maxValue <= 0) {
    return 0;
  }

  const ratio = value / maxValue;

  if (ratio >= 0.85) {
    return 4;
  }

  if (ratio >= 0.6) {
    return 3;
  }

  if (ratio >= 0.3) {
    return 2;
  }

  return 1;
}
