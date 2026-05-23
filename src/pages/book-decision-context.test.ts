import { describe, expect, it } from "vitest";
import type { ShelfEntry } from "../lib/types";
import { getRecentReadingContext, type RecentReadingWindowMode } from "./book-decision-context";

function book(id: string, lastReadAt?: number): ShelfEntry {
  return {
    id,
    type: "book",
    title: id,
    isTop: false,
    isSecret: false,
    lastReadAt
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
});
