import type { ReadingCategory, ReadingStats, ReadingTimeBucket } from "../../lib/types";
import {
  getReadingStatsDrillPeriod,
  type ReadingStatsPeriod
} from "../../pages/reading-stats-period";

export function hasReadingStatsData(stats?: ReadingStats): boolean {
  return Boolean(
    stats &&
      ((stats.totalReadTimeSeconds ?? 0) > 0 ||
        (stats.readDays ?? 0) > 0 ||
        stats.buckets.length > 0 ||
        stats.longestItems.length > 0 ||
        stats.categories.length > 0)
  );
}

export function buildReadingStatsDrillPeriods(stats?: ReadingStats): ReadingStatsPeriod[] {
  if (!stats) {
    return [];
  }

  const nextPeriods = stats.buckets
    .filter((bucket) => bucket.readTimeSeconds > 0)
    .map((bucket) => getReadingStatsDrillPeriod(stats.mode, bucket.startTime))
    .filter((period): period is ReadingStatsPeriod => Boolean(period));

  const deduped = new Map<string, ReadingStatsPeriod>();
  nextPeriods.forEach((period) => {
    deduped.set(`${period.mode}:${period.baseTime}`, period);
  });

  return Array.from(deduped.values()).sort((left, right) => right.baseTime - left.baseTime);
}

export function getPeakReadingBucket(stats?: ReadingStats): ReadingTimeBucket | undefined {
  return stats?.buckets.reduce<ReadingTimeBucket | undefined>((peak, bucket) => {
    if (bucket.readTimeSeconds <= 0) {
      return peak;
    }

    if (!peak || bucket.readTimeSeconds > peak.readTimeSeconds) {
      return bucket;
    }

    return peak;
  }, undefined);
}

export function getTopReadingCategory(categories: ReadingCategory[]): ReadingCategory | undefined {
  return categories.reduce<ReadingCategory | undefined>((top, category) => {
    const value = category.readingTimeSeconds ?? category.value ?? 0;
    const topValue = top ? top.readingTimeSeconds ?? top.value ?? 0 : -1;
    return value > topValue ? category : top;
  }, undefined);
}
