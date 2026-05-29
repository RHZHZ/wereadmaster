import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStatsResponse } from "../../lib/reading-api";
import { buildStatsSummarySparklineSeries } from "./stats-sparkline-helpers";

describe("stats sparkline helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 24, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores future cached periods when building weekly sparklines", () => {
    const currentWeek = toLocalTimestamp(2026, 4, 18);
    const futureWeek = toLocalTimestamp(2026, 5, 29);
    const stats = buildStatsResponse("weekly", currentWeek, 3090, 2);
    const series = buildStatsSummarySparklineSeries(
      [stats, buildStatsResponse("weekly", futureWeek, 0, 0)],
      stats.stats
    );

    expect(series.totalReadTimeSeconds.labels).toEqual([String(currentWeek)]);
    expect(series.totalReadTimeSeconds.values).toEqual([3090]);
    expect(series.readDays.values).toEqual([2]);
  });
});

function buildStatsResponse(
  mode: "weekly" | "monthly" | "annually" | "overall",
  baseTime: number,
  totalReadTimeSeconds: number,
  readDays: number
): ReadingStatsResponse {
  return {
    stats: {
      mode,
      baseTime,
      totalReadTimeSeconds,
      readDays,
      buckets: [],
      longestItems: [],
      categories: []
    }
  };
}

function toLocalTimestamp(year: number, monthIndex: number, day: number): number {
  return Math.floor(new Date(year, monthIndex, day).getTime() / 1000);
}
