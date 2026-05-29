import { formatDuration } from "../lib/formatters";
import type { ReadingTimeBucket } from "../lib/types";
import type { ChartTooltipRow } from "./chart-tooltip/ChartTooltip";

type TrendTooltipData = {
  badge?: string;
  rows: ChartTooltipRow[];
  title: string;
};

type BuildTrendTooltipDataInput = {
  bucket: ReadingTimeBucket;
  isPeak: boolean;
  label: string;
  totalSeconds: number;
};

export function buildTrendTooltipData({
  bucket,
  isPeak,
  label,
  totalSeconds
}: BuildTrendTooltipDataInput): TrendTooltipData {
  const share =
    totalSeconds > 0 ? Math.max(1, Math.round((bucket.readTimeSeconds / totalSeconds) * 100)) : 0;

  return {
    title: label,
    badge: isPeak ? "高峰" : undefined,
    rows: [
      {
        label: "阅读时长",
        value: formatDuration(bucket.readTimeSeconds),
        tone: "accent"
      },
      {
        label: "分桶占比",
        value: `${share}%`
      }
    ]
  };
}
