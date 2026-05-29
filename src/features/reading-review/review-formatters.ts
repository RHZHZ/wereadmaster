import { formatDuration } from "../../lib/formatters";
import type { ReadingCategory, ReadingStats } from "../../lib/types";

export function formatReviewCategoryValue(category: ReadingCategory): string {
  if (category.readingTimeSeconds !== undefined) {
    return formatDuration(category.readingTimeSeconds);
  }

  if (category.readingCount !== undefined) {
    return `${category.readingCount} 本`;
  }

  return "分类偏好";
}

export function formatReviewAverageDuration(stats: ReadingStats): string {
  if (stats.dayAverageReadTimeSeconds && stats.dayAverageReadTimeSeconds > 0) {
    return formatDuration(stats.dayAverageReadTimeSeconds);
  }

  if (stats.mode === "overall" && stats.readDays && stats.readDays > 0) {
    return formatDuration((stats.totalReadTimeSeconds ?? 0) / stats.readDays);
  }

  return "暂无";
}
