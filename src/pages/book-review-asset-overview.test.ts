import { describe, expect, test } from "vitest";
import type { BookAiSummaryListItem, NotebookBook } from "../lib/types";
import { buildBookReviewAssetOverview } from "./book-review-asset-overview";

describe("book review asset overview", () => {
  test("prioritizes the first review candidate as the next asset to generate", () => {
    const overview = buildBookReviewAssetOverview({
      summaries: [summary({ bookId: "book-1", title: "深度工作", feedbackCount: 1 })],
      candidates: [
        candidate({ bookId: "book-2", title: "三体", reviewCount: 8, noteCount: 3, bookmarkCount: 4, readingProgress: 62 }),
        candidate({ bookId: "book-3", title: "原则", reviewCount: 2 })
      ]
    });

    expect(overview).toMatchObject({
      label: "复盘进行中",
      title: "还有书可以生成阅读报告",
      generatedCount: 1,
      pendingCount: 2,
      feedbackCount: 1,
      nextActionLabel: "优先生成",
      nextActionTitle: "《三体》",
      nextActionReason: "8 条想法 · 15 条笔记 · 进度 62%",
      nextActionButtonLabel: "开始复盘",
      nextActionTarget: "candidate",
      nextActionBookId: "book-2",
      tone: "active"
    });
  });

  test("keeps generated reviews useful when there are no pending candidates", () => {
    const overview = buildBookReviewAssetOverview({
      summaries: [
        summary({ bookId: "book-1", title: "深度工作", feedbackCount: 2 }),
        summary({ bookId: "book-2", title: "刻意练习", feedbackCount: 0 })
      ],
      candidates: []
    });

    expect(overview).toMatchObject({
      label: "复盘已生成",
      title: "当前没有待生成复盘的书",
      generatedCount: 2,
      pendingCount: 0,
      feedbackCount: 1,
      nextActionLabel: "继续使用",
      nextActionTitle: "回看《深度工作》",
      nextActionButtonLabel: "查看复盘",
      nextActionTarget: "summary",
      nextActionBookId: "book-1",
      tone: "complete"
    });
    expect(overview.body).toContain("其中 1 本有本地反馈");
    expect(overview.nextActionReason).toContain("已有 2 条反馈");
  });

  test("keeps candidate index loading distinct from an empty pending queue", () => {
    const overview = buildBookReviewAssetOverview({
      summaries: [summary({ bookId: "book-1", title: "深度工作", feedbackCount: 0 })],
      candidates: [],
      candidateIndexLoading: true
    });

    expect(overview).toMatchObject({
      label: "复盘缓存可用",
      title: "正在更新待生成复盘的判断",
      generatedCount: 1,
      pendingCount: 0,
      pendingCountLabel: "判断中",
      nextActionLabel: "先回看",
      nextActionTitle: "回看《深度工作》",
      nextActionButtonLabel: "查看复盘",
      nextActionTarget: "summary",
      nextActionBookId: "book-1",
      tone: "complete"
    });
    expect(overview.body).toContain("已先展示 1 本已生成复盘");
    expect(overview.title).not.toBe("当前没有待生成复盘的书");
  });

  test("does not invent asset progress when there are no summaries or candidates", () => {
    const overview = buildBookReviewAssetOverview({
      summaries: [],
      candidates: []
    });

    expect(overview).toMatchObject({
      label: "待生成",
      title: "还没有可用的书籍复盘",
      generatedCount: 0,
      pendingCount: 0,
      feedbackCount: 0,
      nextActionLabel: "先同步",
      nextActionTitle: "去笔记中心积累输入",
      nextActionButtonLabel: "去笔记中心",
      nextActionTarget: "notes",
      tone: "empty"
    });
  });
});

function summary(overrides: Partial<BookAiSummaryListItem>): BookAiSummaryListItem {
  return {
    bookId: "book-1",
    title: "测试书",
    overview: "这本书已经整理过。",
    cachedUpdatedAt: "1725955200",
    feedbackCount: 0,
    ...overrides
  };
}

function candidate(overrides: Partial<NotebookBook>): NotebookBook {
  return {
    bookId: "book-candidate",
    title: "候选书",
    reviewCount: 0,
    noteCount: 0,
    bookmarkCount: 0,
    totalNoteCount: 0,
    ...overrides
  };
}
