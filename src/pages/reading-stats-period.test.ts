import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStatsResponse } from "../lib/reading-api";
import {
  buildReadingStatsCacheKey,
  canShiftReadingStatsPeriod,
  formatReadingStatsPeriodTitle,
  getLatestReadingStatsResponse,
  getReadingStatsResponse,
  shiftReadingStatsPeriod,
  type ReadingStatsCache
} from "./reading-stats-period";

describe("reading stats period helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 24, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds stable cache keys for mode and base time", () => {
    expect(buildReadingStatsCacheKey("overall", 0)).toBe("overall:0");
    expect(buildReadingStatsCacheKey("monthly", 1709251200)).toBe("monthly:1709251200");
  });

  it("formats absolute titles for historical year and month periods", () => {
    expect(
      formatReadingStatsPeriodTitle(
        { mode: "annually", baseTime: 1704067200 },
        "stats"
      )
    ).toBe("2024 年度阅读报告");
    expect(
      formatReadingStatsPeriodTitle(
        { mode: "monthly", baseTime: 1709251200 },
        "stats"
      )
    ).toBe("2024 年 3 月阅读报告");
    expect(
      formatReadingStatsPeriodTitle(
        { mode: "overall", baseTime: 0 },
        "review"
      )
    ).toBe("长期阅读画像");
  });

  it("reads latest-mode cache when the current period uses the latest anchor", () => {
    const cache: ReadingStatsCache = {
      [buildReadingStatsCacheKey("monthly", 1709251200)]: buildStatsResponse("monthly", 1709251200),
      [buildReadingStatsCacheKey("monthly", 1711929600)]: buildStatsResponse("monthly", 1711929600),
      [buildReadingStatsCacheKey("overall", 0)]: buildStatsResponse("overall", 0)
    };

    expect(getLatestReadingStatsResponse(cache, "monthly")?.stats.baseTime).toBe(1711929600);
    expect(getReadingStatsResponse(cache, { mode: "monthly", baseTime: 0 })?.stats.baseTime).toBe(
      1711929600
    );
    expect(getReadingStatsResponse(cache, { mode: "monthly", baseTime: 1709251200 })?.stats.baseTime).toBe(
      1709251200
    );
  });

  it("prefers the latest non-future cache when future zero-period rows already exist", () => {
    const currentWeek = toLocalTimestamp(2026, 4, 18);
    const futureWeek = toLocalTimestamp(2026, 5, 29);
    const cache: ReadingStatsCache = {
      [buildReadingStatsCacheKey("weekly", currentWeek)]: buildStatsResponse("weekly", currentWeek, {
        readDays: 2,
        totalReadTimeSeconds: 3090
      }),
      [buildReadingStatsCacheKey("weekly", futureWeek)]: buildStatsResponse("weekly", futureWeek)
    };

    expect(getLatestReadingStatsResponse(cache, "weekly")?.stats.baseTime).toBe(currentWeek);
    expect(getReadingStatsResponse(cache, { mode: "weekly", baseTime: 0 })?.stats.baseTime).toBe(currentWeek);
  });

  it("falls back to the same historical period when cache base time was normalized differently", () => {
    const localMonthStart = toLocalTimestamp(2024, 3, 1);
    const requestInSameMonth = localMonthStart + 8 * 60 * 60;
    const cache: ReadingStatsCache = {
      [buildReadingStatsCacheKey("monthly", localMonthStart)]: buildStatsResponse(
        "monthly",
        localMonthStart
      )
    };

    expect(
      getReadingStatsResponse(cache, { mode: "monthly", baseTime: requestInSameMonth })?.stats.baseTime
    ).toBe(localMonthStart);
  });

  it("moves month and year anchors to the adjacent historical period", () => {
    expect(shiftReadingStatsPeriod({ mode: "annually", baseTime: toLocalTimestamp(2024, 0, 1) }, -1)).toEqual({
      mode: "annually",
      baseTime: toLocalTimestamp(2023, 0, 1)
    });
    expect(shiftReadingStatsPeriod({ mode: "monthly", baseTime: toLocalTimestamp(2024, 2, 1) }, -1)).toEqual({
      mode: "monthly",
      baseTime: toLocalTimestamp(2024, 1, 1)
    });
    expect(shiftReadingStatsPeriod({ mode: "monthly", baseTime: toLocalTimestamp(2024, 2, 1) }, 1)).toEqual({
      mode: "monthly",
      baseTime: toLocalTimestamp(2024, 3, 1)
    });
  });

  it("does not allow stepping into future weekly monthly or annual anchors", () => {
    const currentWeek = toLocalTimestamp(2026, 4, 18);
    const previousWeek = toLocalTimestamp(2026, 4, 11);
    const currentMonth = toLocalTimestamp(2026, 4, 1);
    const previousMonth = toLocalTimestamp(2026, 3, 1);
    const currentYear = toLocalTimestamp(2026, 0, 1);
    const previousYear = toLocalTimestamp(2025, 0, 1);

    expect(canShiftReadingStatsPeriod({ mode: "weekly", baseTime: currentWeek }, 1)).toBe(false);
    expect(shiftReadingStatsPeriod({ mode: "weekly", baseTime: currentWeek }, 1)).toEqual({
      mode: "weekly",
      baseTime: currentWeek
    });
    expect(canShiftReadingStatsPeriod({ mode: "weekly", baseTime: previousWeek }, 1)).toBe(true);
    expect(shiftReadingStatsPeriod({ mode: "weekly", baseTime: previousWeek }, 1)).toEqual({
      mode: "weekly",
      baseTime: currentWeek
    });

    expect(canShiftReadingStatsPeriod({ mode: "monthly", baseTime: currentMonth }, 1)).toBe(false);
    expect(shiftReadingStatsPeriod({ mode: "monthly", baseTime: currentMonth }, 1)).toEqual({
      mode: "monthly",
      baseTime: currentMonth
    });
    expect(canShiftReadingStatsPeriod({ mode: "monthly", baseTime: previousMonth }, 1)).toBe(true);
    expect(shiftReadingStatsPeriod({ mode: "monthly", baseTime: previousMonth }, 1)).toEqual({
      mode: "monthly",
      baseTime: currentMonth
    });

    expect(canShiftReadingStatsPeriod({ mode: "annually", baseTime: currentYear }, 1)).toBe(false);
    expect(shiftReadingStatsPeriod({ mode: "annually", baseTime: currentYear }, 1)).toEqual({
      mode: "annually",
      baseTime: currentYear
    });
    expect(canShiftReadingStatsPeriod({ mode: "annually", baseTime: previousYear }, 1)).toBe(true);
    expect(shiftReadingStatsPeriod({ mode: "annually", baseTime: previousYear }, 1)).toEqual({
      mode: "annually",
      baseTime: currentYear
    });
  });
});

function buildStatsResponse(
  mode: "weekly" | "monthly" | "annually" | "overall",
  baseTime: number,
  overrides?: Partial<ReadingStatsResponse["stats"]>
): ReadingStatsResponse {
  return {
    stats: {
      mode,
      baseTime,
      readDays: overrides?.readDays,
      totalReadTimeSeconds: overrides?.totalReadTimeSeconds,
      dayAverageReadTimeSeconds: overrides?.dayAverageReadTimeSeconds,
      compare: overrides?.compare,
      buckets: [],
      longestItems: [],
      categories: []
    }
  };
}

function toLocalTimestamp(year: number, monthIndex: number, day: number): number {
  return Math.floor(new Date(year, monthIndex, day).getTime() / 1000);
}
