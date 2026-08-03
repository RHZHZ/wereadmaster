import { describe, expect, it } from "vitest";
import type { ReadingStatsResponse } from "../lib/reading-api";
import type { ShelfEntry } from "../lib/types";
import {
  buildBookDecisionRecentReadingContext,
  getRecentReadingContext,
  type RecentReadingWindowMode
} from "./book-decision-context";
import type { ReadingStatsCache } from "./reading-stats-period";

function book(
  id: string,
  lastReadAt?: number,
  overrides: Partial<ShelfEntry> = {}
): ShelfEntry {
  return {
    id,
    type: "book",
    title: id,
    isTop: false,
    isSecret: false,
    lastReadAt,
    ...overrides
  };
}

describe("book decision context", () => {
  const nowSeconds = 1_760_000_000;
  const day = 86_400;

  it("uses the default 30 day window when recent reading records exist", () => {
    const context = getRecentReadingContext(
      [book("recent-1", nowSeconds - 3 * day), book("recent-2", nowSeconds - 29 * day)],
      nowSeconds
    );

    expect(context).toEqual({
      count: 2,
      label: "近 30 天有 2 本阅读记录",
      mode: "auto",
      windowDays: 30
    });
  });

  it("falls back to 60 days when the 30 day window has no records", () => {
    const context = getRecentReadingContext([book("fallback", nowSeconds - 45 * day)], nowSeconds);

    expect(context).toEqual({
      count: 1,
      label: "自动：退避到近 60 天，1 本阅读记录",
      mode: "auto",
      windowDays: 60
    });
  });

  it("uses a manual reading window without auto expanding empty results", () => {
    const context = getRecentReadingContext(
      [book("older", nowSeconds - 45 * day)],
      nowSeconds,
      30
    );

    expect(context).toEqual({
      count: 0,
      label: "近 30 天暂无阅读记录，不纳入近期上下文",
      mode: 30,
      windowDays: 30
    });
  });

  it("counts records inside the selected manual reading window", () => {
    const mode: RecentReadingWindowMode = 60;
    const context = getRecentReadingContext(
      [book("recent", nowSeconds - 10 * day), book("older", nowSeconds - 45 * day)],
      nowSeconds,
      mode
    );

    expect(context).toEqual({
      count: 2,
      label: "近 60 天有 2 本阅读记录",
      mode: 60,
      windowDays: 60
    });
  });

  it("does not turn the whole bookshelf into recent context when no record is in range", () => {
    const context = getRecentReadingContext(
      [book("old", nowSeconds - 400 * day), book("missing-time")],
      nowSeconds
    );

    expect(context).toEqual({
      count: 0,
      label: "自动：近 365 天无阅读记录，暂不使用近期上下文",
      mode: "auto"
    });
  });

  it("builds a stable bounded backend context from recent finished books and latest stats", () => {
    const entries = [
      book("finished-6", nowSeconds - day, { title: "第六本", isFinished: true }),
      book("finished-1", nowSeconds - 2 * day, { title: "第一本", isFinished: true }),
      book("finished-2", nowSeconds - 3 * day, { title: "第二本", isFinished: true }),
      book("finished-3", nowSeconds - 4 * day, { title: "第三本", isFinished: true }),
      book("finished-4", nowSeconds - 5 * day, { title: "第四本", isFinished: true }),
      book("finished-5", nowSeconds - 6 * day, { title: "第五本", isFinished: true }),
      book("unfinished", nowSeconds - day, { title: "未读完", isFinished: false }),
      book("old-finished", nowSeconds - 100 * day, { title: "过期已读", isFinished: true })
    ];
    const cache: ReadingStatsCache = {
      "monthly:100": statsResponse(100, 900, [["旧统计", 7_200]]),
      "monthly:200": statsResponse(200, 1_260, [
        ["效率", 4_200],
        ["文学", 7_800],
        ["历史", 1_800],
        ["心理", 1_200],
        ["科技", 600],
        ["艺术", 300]
      ])
    };

    expect(buildBookDecisionRecentReadingContext(entries, cache, 30, nowSeconds)).toEqual({
      finishedTitles: ["第六本", "第一本", "第二本", "第三本", "第四本"],
      activeCategories: [
        { name: "文学", minutes: 130 },
        { name: "效率", minutes: 70 },
        { name: "历史", minutes: 30 },
        { name: "心理", minutes: 20 },
        { name: "科技", minutes: 10 }
      ],
      averageDailyMinutes: 21
    });
  });
});

function statsResponse(
  baseTime: number,
  dayAverageReadTimeSeconds: number,
  categories: Array<[string, number]>
): ReadingStatsResponse {
  return {
    stats: {
      mode: "monthly",
      baseTime,
      dayAverageReadTimeSeconds,
      buckets: [],
      longestItems: [],
      categories: categories.map(([title, readingTimeSeconds]) => ({
        title,
        readingTimeSeconds
      }))
    }
  };
}
