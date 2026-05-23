import { describe, expect, it } from "vitest";
import {
  appendRecentSearchKeyword,
  buildReadingHabitProfile,
  calculateBookshelfTotal,
  calculateShelfPrivacy,
  calculateTotalNotes,
  chooseSearchScope,
  extractRepresentativeThemes,
  hasEnoughDataForHabitProfile,
  normalizeProgress,
  summarizeBookshelf
} from "./business-rules";
import { formatDuration, formatProgress, formatRating, formatReviewStars, formatUnixDate } from "./formatters";
import type { ReadingStats, ShelfEntry } from "./types";

describe("bookshelf rules", () => {
  it("counts books, albums, and mp entries as visible shelf total", () => {
    expect(calculateBookshelfTotal({ books: [{}, {}], albums: [{}], mp: {} })).toBe(4);
  });

  it("counts mp as private when present", () => {
    expect(
      calculateShelfPrivacy({
        books: [{ secret: 0 }, { secret: 1 }],
        albums: [{ albumInfoExtra: { secret: 1 } }],
        mp: {}
      })
    ).toEqual({ publicCount: 1, secretCount: 3 });
  });

  it("summarizes normalized shelf entries", () => {
    const entries: ShelfEntry[] = [
      { id: "1", type: "book", title: "Book", isTop: false, isSecret: false },
      { id: "2", type: "album", title: "Album", isTop: false, isSecret: true },
      { id: "mp", type: "mp", title: "文章收藏", isTop: false, isSecret: true }
    ];

    expect(summarizeBookshelf(entries)).toEqual({
      totalVisibleEntries: 3,
      bookCount: 1,
      albumCount: 1,
      mpCount: 1,
      publicCount: 1,
      secretCount: 2
    });
  });
});

describe("notes rules", () => {
  it("calculates total notes from review, underline, and bookmark counts", () => {
    expect(calculateTotalNotes({ reviewCount: 3, noteCount: 4, bookmarkCount: 2 })).toBe(9);
  });

  it("ignores invalid negative note counts", () => {
    expect(calculateTotalNotes({ reviewCount: -1, noteCount: 2, bookmarkCount: Number.NaN })).toBe(2);
  });
});

describe("progress rules", () => {
  it("treats progress 1 as 1 percent, not completed", () => {
    expect(normalizeProgress({ progress: 1, isStartReading: 1 })).toEqual({
      progressPercent: 1,
      isStarted: true,
      isFinished: false
    });
  });

  it("marks finished only at 100 percent with finish time", () => {
    expect(normalizeProgress({ progress: 100, finishTime: 1710000000 })).toEqual({
      progressPercent: 100,
      isStarted: true,
      isFinished: true
    });
  });
});

describe("search scope rules", () => {
  it.each([
    ["帮我搜书三体", 10],
    ["找有声书三体", 14],
    ["搜一下网络小说", 16],
    ["查作者刘慈欣", 6],
    ["书里提到了黑暗森林", 12],
    ["推荐书单", 13],
    ["搜公众号", 2],
    ["搜文章", 4],
    ["搜一下三体", 0]
  ] as const)("maps %s to scope %s", (input, expected) => {
    expect(chooseSearchScope(input)).toBe(expected);
  });

  it("keeps bookId lookup in electronic book scope regardless of case", () => {
    expect(chooseSearchScope("BOOKID 330009")).toBe(10);
  });

  it("keeps recent search keywords deduped and newest-first", () => {
    expect(appendRecentSearchKeyword(["三体", "心理学"], "三体")).toEqual(["三体", "心理学"]);
    expect(appendRecentSearchKeyword(["三体", "心理学"], "AI")).toEqual(["AI", "三体", "心理学"]);
  });
});

describe("reading habit profile rules", () => {
  const stats: ReadingStats = {
    mode: "monthly",
    baseTime: 1_725_955_200,
    readDays: 12,
    totalReadTimeSeconds: 18_900,
    dayAverageReadTimeSeconds: 1_575,
    compare: 0.18,
    buckets: [
      { startTime: 1_725_696_000, readTimeSeconds: 1_800 },
      { startTime: 1_725_782_400, readTimeSeconds: 3_600 },
      { startTime: 1_725_868_800, readTimeSeconds: 2_400 }
    ],
    longestItems: [
      {
        id: "book-deep-work",
        title: "深度工作",
        author: "卡尔·纽波特",
        type: "book",
        readTimeSeconds: 7_200,
        tags: ["效率", "专注"]
      }
    ],
    categories: [
      {
        categoryId: "efficiency",
        title: "效率",
        parentTitle: "非虚构",
        readingTimeSeconds: 9_000,
        readingCount: 3
      },
      {
        categoryId: "sci-fi",
        title: "科幻",
        parentTitle: "文学",
        readingTimeSeconds: 5_400,
        readingCount: 2
      }
    ]
  };

  it("extracts representative themes from categories and item tags", () => {
    expect(extractRepresentativeThemes(stats, 4)).toEqual(["效率", "非虚构", "科幻", "文学"]);
  });

  it("builds a non-absolute reading habit profile from local stats", () => {
    const profile = buildReadingHabitProfile(stats);
    expect(hasEnoughDataForHabitProfile(stats)).toBe(true);
    expect(profile?.primaryLabel).toBe("实用型");
    expect(profile?.basisNotice).toContain("不代表固定阅读人格");
    expect(profile?.evidence.length).toBeGreaterThan(1);
  });

  it("refuses to build a profile when data is insufficient", () => {
    expect(
      buildReadingHabitProfile({
        mode: "weekly",
        baseTime: 1_725_955_200,
        buckets: [],
        categories: [],
        longestItems: [],
        readDays: 1,
        totalReadTimeSeconds: 600
      })
    ).toBeUndefined();
  });
});

describe("formatters", () => {
  it("formats seconds as Chinese duration text", () => {
    expect(formatDuration(3660)).toBe("1小时1分钟");
    expect(formatDuration(3600)).toBe("1小时");
    expect(formatDuration(59)).toBe("1分钟");
  });

  it("formats Unix timestamps as dates", () => {
    expect(formatUnixDate(1748563200)).toBe("2025-05-30");
  });

  it("formats progress, ratings, and review stars", () => {
    expect(formatProgress(45.8)).toBe("45%");
    expect(formatRating(86)).toBe("8.6");
    expect(formatReviewStars(80)).toBe("★★★★");
  });

  it("clamps unsafe progress and handles missing rating/star values", () => {
    expect(formatProgress(180)).toBe("100%");
    expect(formatProgress(-8)).toBe("0%");
    expect(formatRating(undefined)).toBe("暂无评分");
    expect(formatReviewStars(0)).toBe("未评分");
  });
});
