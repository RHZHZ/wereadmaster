import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookshelfResponse, NotebookOverviewResponse, ReadingStatsResponse } from "../lib/reading-api";
import type { ReadingStatsCache } from "./reading-stats-period";
import { DashboardPage } from "./DashboardPage";
import { buildUnprocessedInsightItem } from "./DashboardPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

describe("dashboard page reading persona overview", () => {
  test("builds a recent unprocessed insight reminder from generated reviews", () => {
    const openedBooks: string[] = [];
    const item = buildUnprocessedInsightItem({
      summaries: [
        {
          bookId: "old",
          title: "旧复盘",
          overview: "旧内容",
          cachedUpdatedAt: "2026-06-01T00:00:00.000Z",
          feedbackCount: 0
        },
        {
          bookId: "done",
          title: "已处理复盘",
          overview: "已处理",
          cachedUpdatedAt: "2026-07-01T00:00:00.000Z",
          feedbackCount: 2
        },
        {
          bookId: "latest",
          title: "最新复盘",
          author: "作者",
          overview: "新内容",
          cachedUpdatedAt: "2026-07-10T00:00:00.000Z",
          feedbackCount: 0
        }
      ],
      onOpenBookSummary: (book) => openedBooks.push(book.bookId),
      onOpenReadingReview: () => openedBooks.push("review")
    });

    expect(item?.title).toBe("最新复盘");
    expect(item?.meta).toContain("尚无反馈");

    item?.onClick();
    expect(openedBooks).toEqual(["latest"]);
  });

  test("does not build insight reminder when every generated review has feedback", () => {
    const item = buildUnprocessedInsightItem({
      summaries: [
        {
          bookId: "done",
          title: "已处理复盘",
          overview: "已处理",
          cachedUpdatedAt: "2026-07-01T00:00:00.000Z",
          feedbackCount: 1
        }
      ],
      onOpenReadingReview: () => undefined
    });

    expect(item).toBeUndefined();
  });

  test("renders daily workbench primary action before auxiliary actions", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        credentialStatus={{ hasCredential: true }}
        isLoading={false}
        isSyncing={false}
        onSync={() => undefined}
        onOpenBookshelf={() => undefined}
        onOpenNotes={() => undefined}
        onOpenStats={() => undefined}
        onOpenReadingReview={() => undefined}
        onOpenDiscovery={() => undefined}
        onOpenShelfEntry={() => undefined}
        onOpenBookNotes={() => undefined}
        onOpenCandidateBook={() => undefined}
        onOpenSettings={() => undefined}
        onOpenReadingRoute={() => undefined}
        onOpenBookDecision={() => undefined}
        readingStatsCache={{}}
        onReadingStatsCacheChange={() => undefined}
      />
    );

    expect(markup).toContain("今日阅读工作台");
    expect(markup).toContain("今日最值得做");
    expect(markup).toContain("为什么现在做");
    expect(markup).toContain("完成后得到");
    expect(markup).toContain("今日卡片");
    expect(markup).toContain("本地进展");
    expect(markup).toContain("阅读进度");
    expect(markup).toContain("先同步书架缓存");
    expect(markup).toContain("辅助动作");
    expect(markup.indexOf("今日最值得做")).toBeLessThan(markup.indexOf("辅助动作"));
    expect(markup.indexOf("辅助动作")).toBeLessThan(markup.indexOf("今日卡片"));
    expect(markup.indexOf("今日卡片")).toBeLessThan(markup.indexOf("阅读进度"));
  });

  test("renders monthly reading persona instead of the legacy habit profile card", () => {
    const readingStatsCache: ReadingStatsCache = {
      "monthly:1725955200": createMonthlyStatsResponse()
    };

    const markup = renderToStaticMarkup(
      <DashboardPage
        credentialStatus={{ hasCredential: true }}
        isLoading={false}
        isSyncing={false}
        onSync={() => undefined}
        onOpenBookshelf={() => undefined}
        onOpenNotes={() => undefined}
        onOpenStats={() => undefined}
        onOpenReadingReview={() => undefined}
        onOpenDiscovery={() => undefined}
        onOpenShelfEntry={() => undefined}
        onOpenBookNotes={() => undefined}
        onOpenCandidateBook={() => undefined}
        onOpenSettings={() => undefined}
        onOpenReadingRoute={() => undefined}
        onOpenBookDecision={() => undefined}
        readingStatsCache={readingStatsCache}
        onReadingStatsCacheChange={() => undefined}
      />
    );

    expect(markup).toContain("阅读人格");
    expect(markup).toContain("ISTJ");
    expect(markup).toContain("秩序型读者");
    expect(markup).toContain("dashboard-profile-visual-card");
    expect(markup).toContain("persona-illustration");
    expect(markup).toContain("dashboard-profile-code-pill");
    expect(markup).toContain("基于本地");
    expect(markup).toContain("本月");
    expect(markup).toContain("主题深度");
    expect(markup).toContain("实用经验");
    expect(markup).toContain("分析取向");
    expect(markup).toContain("稳定推进");
    expect(markup).toContain("本月更偏向围绕效率主线稳定深读。");
    expect(markup).not.toContain("近期画像");
    expect(markup).not.toContain("SJ 组");
    expect(markup).not.toContain("月度阅读人格");
    expect(markup).not.toContain("dashboard-profile-title\">ISTJ 型读者");
    expect(markup).not.toContain("效率 是当前投入最多的主题");
  });

  test("keeps the dashboard persona illustration hidden while samples are insufficient", () => {
    const readingStatsCache: ReadingStatsCache = {
      "monthly:1725955200": {
        stats: {
          mode: "monthly",
          baseTime: 1725955200,
          readDays: 1,
          totalReadTimeSeconds: 300,
          dayAverageReadTimeSeconds: 300,
          compare: 0,
          buckets: [{ startTime: 1725696000, readTimeSeconds: 300 }],
          longestItems: [],
          categories: []
        }
      }
    };

    const markup = renderToStaticMarkup(
      <DashboardPage
        credentialStatus={{ hasCredential: true }}
        isLoading={false}
        isSyncing={false}
        onSync={() => undefined}
        onOpenBookshelf={() => undefined}
        onOpenNotes={() => undefined}
        onOpenStats={() => undefined}
        onOpenReadingReview={() => undefined}
        onOpenDiscovery={() => undefined}
        onOpenShelfEntry={() => undefined}
        onOpenBookNotes={() => undefined}
        onOpenCandidateBook={() => undefined}
        onOpenSettings={() => undefined}
        onOpenReadingRoute={() => undefined}
        onOpenBookDecision={() => undefined}
        readingStatsCache={readingStatsCache}
        onReadingStatsCacheChange={() => undefined}
      />
    );

    expect(markup).toContain("样本积累中");
    expect(markup).toContain("dashboard-profile-code\">--");
    expect(markup).not.toContain("dashboard-profile-visual-card");
    expect(markup).not.toContain("persona-illustration");
  });

  test("renders WeRead overview from recent five ebook entries only", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage
        credentialStatus={{ hasCredential: true }}
        bookshelf={createBookshelfResponse()}
        notesOverview={createNotebookOverview()}
        isLoading={false}
        isSyncing={false}
        onSync={() => undefined}
        onOpenBookshelf={() => undefined}
        onOpenNotes={() => undefined}
        onOpenStats={() => undefined}
        onOpenReadingReview={() => undefined}
        onOpenDiscovery={() => undefined}
        onOpenShelfEntry={() => undefined}
        onOpenBookNotes={() => undefined}
        onOpenCandidateBook={() => undefined}
        onOpenSettings={() => undefined}
        onOpenReadingRoute={() => undefined}
        onOpenBookDecision={() => undefined}
        readingStatsCache={{}}
        onReadingStatsCacheChange={() => undefined}
      />
    );

    expect(markup).toContain("微信读书概况");
    expect(markup).toContain("最近阅读");
    expect(markup).toContain("最近 5 本电子书");
    expect(markup).toContain("按最后阅读时间排序");
    expect(markup).toContain("刷新进度");
    expect(markup).toContain("Book 6");
    expect(markup).toContain("Book 2");
    expect(markup).not.toContain("Book 1");
    expect(markup).not.toContain("Audio Entry");
    expect(markup).toContain("12");
    expect(markup).toContain("2 本有笔记");
    expect(markup.indexOf("今日最值得做")).toBeLessThan(markup.indexOf("最近 5 本电子书"));
  });
});

function createMonthlyStatsResponse(): ReadingStatsResponse {
  return {
    stats: {
      mode: "monthly",
      baseTime: 1725955200,
      readDays: 12,
      totalReadTimeSeconds: 18900,
      dayAverageReadTimeSeconds: 1575,
      compare: 0.18,
      buckets: [
        { startTime: 1725696000, readTimeSeconds: 1800 },
        { startTime: 1725782400, readTimeSeconds: 3600 },
        { startTime: 1725868800, readTimeSeconds: 2400 }
      ],
      longestItems: [
        {
          id: "book-deep-work",
          title: "深度工作",
          author: "卡尔·纽波特",
          type: "book",
          readTimeSeconds: 7200,
          tags: ["效率", "专注"]
        }
      ],
      categories: [
        {
          categoryId: "efficiency",
          title: "效率",
          parentTitle: "非虚构",
          readingTimeSeconds: 9000,
          readingCount: 3
        },
        {
          categoryId: "sci-fi",
          title: "科幻",
          parentTitle: "文学",
          readingTimeSeconds: 5400,
          readingCount: 2
        }
      ]
    }
  };
}

function createBookshelfResponse(): BookshelfResponse {
  return {
    snapshot: {
      entries: [
        bookEntry("book-1", "Book 1", 101),
        bookEntry("book-2", "Book 2", 102),
        bookEntry("book-3", "Book 3", 103),
        bookEntry("book-4", "Book 4", 104),
        bookEntry("book-5", "Book 5", 105),
        bookEntry("book-6", "Book 6", 106),
        {
          id: "album-1",
          type: "album",
          title: "Audio Entry",
          isTop: false,
          isSecret: false,
          lastReadAt: 999
        },
        {
          id: "mp",
          type: "mp",
          title: "文章收藏",
          isTop: false,
          isSecret: true,
          lastReadAt: 998
        }
      ],
      archives: [],
      summary: {
        totalVisibleEntries: 8,
        bookCount: 6,
        albumCount: 1,
        mpCount: 1,
        publicCount: 7,
        secretCount: 1
      }
    }
  };
}

function bookEntry(id: string, title: string, lastReadAt: number): BookshelfResponse["snapshot"]["entries"][number] {
  return {
    id,
    type: "book",
    title,
    author: "作者",
    isTop: false,
    isSecret: false,
    lastReadAt
  };
}

function createNotebookOverview(): NotebookOverviewResponse {
  return {
    books: [],
    summary: {
      totalBookCount: 2,
      totalNoteCount: 12
    }
  };
}
