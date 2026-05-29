import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStatsCache } from "./reading-stats-period";
import {
  buildReadingStatsJumpMonthOptions,
  buildReadingStatsJumpWeekOptions,
  buildReadingStatsJumpYearOptions
} from "./reading-stats-period-options";

describe("reading stats jump options", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 24, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extends year options backward when cache contains older history", () => {
    const cache = {
      "annually:1388505600": {
        stats: {
          mode: "annually",
          baseTime: 1388505600,
          buckets: [],
          longestItems: [],
          categories: []
        }
      }
    } satisfies ReadingStatsCache;

    const years = buildReadingStatsJumpYearOptions(cache);

    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(2014);
  });

  it("disables future months in the current year", () => {
    const monthOptions = buildReadingStatsJumpMonthOptions(2026);

    expect(monthOptions.find((option) => option.month === 5)?.disabled).toBe(false);
    expect(monthOptions.find((option) => option.month === 6)?.disabled).toBe(true);
  });

  it("marks future weeks in the current month as disabled", () => {
    const weekOptions = buildReadingStatsJumpWeekOptions(2026, 5);

    expect(weekOptions.some((option) => option.label === "4 月 27 日当周")).toBe(true);
    expect(weekOptions.find((option) => option.label === "5 月 18 日当周")?.disabled).toBe(false);
    expect(weekOptions.find((option) => option.label === "5 月 25 日当周")?.disabled).toBe(true);
  });
});
