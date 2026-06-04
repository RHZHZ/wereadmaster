import { describe, expect, test } from "vitest";
import type { BookNotesReviewStatusInput } from "./book-notes-review-status";
import { buildBookNotesReviewStatus } from "./book-notes-review-status";

describe("book notes review status", () => {
  test("marks notes with highlights and thoughts as ready for review", () => {
    const status = buildBookNotesReviewStatus(notes({ highlightCount: 3, thoughtCount: 2, exportableCount: 5 }));

    expect(status).toMatchObject({
      label: "适合复盘",
      title: "这本书已经有可整理输入",
      primaryMetricLabel: "想法",
      primaryMetricValue: 2,
      secondaryMetricLabel: "划线",
      secondaryMetricValue: 3,
      nextActionLabel: "AI 复盘",
      tone: "ready"
    });
  });

  test("keeps partial notes focused on reviewing chapters first", () => {
    const status = buildBookNotesReviewStatus(notes({ highlightCount: 4, thoughtCount: 0, exportableCount: 4 }));

    expect(status).toMatchObject({
      label: "可先整理",
      title: "已有材料但还不够丰满",
      primaryMetricLabel: "划线",
      primaryMetricValue: 4,
      secondaryMetricLabel: "可导出",
      secondaryMetricValue: 4,
      nextActionLabel: "查看章节",
      tone: "partial"
    });
    expect(status.body).toContain("已有 4 条划线");
  });

  test("does not invent review readiness when notes are empty", () => {
    expect(notes({ highlightCount: 0, thoughtCount: 0, exportableCount: 0 })).toMatchObject({
      highlights: [],
      thoughts: [],
      exportableCount: 0
    });

    expect(
      buildBookNotesReviewStatus(notes({ highlightCount: 0, thoughtCount: 0, exportableCount: 0 }))
    ).toMatchObject({
      label: "待积累",
      title: "还没有可复盘输入",
      nextActionLabel: "继续阅读",
      tone: "empty"
    });
  });
});

function notes({
  highlightCount,
  thoughtCount,
  exportableCount
}: {
  highlightCount: number;
  thoughtCount: number;
  exportableCount: number;
}): BookNotesReviewStatusInput {
  const highlights = Array.from({ length: highlightCount }, (_, index) => ({
    bookmarkId: `highlight-${index + 1}`,
    bookId: "book-1",
    markText: `划线 ${index + 1}`
  }));
  const thoughts = Array.from({ length: thoughtCount }, (_, index) => ({
    reviewId: `thought-${index + 1}`,
    bookId: "book-1",
    content: `想法 ${index + 1}`
  }));

  return {
    highlights,
    thoughts,
    exportableCount,
    chapterGroups:
      highlightCount + thoughtCount > 0
        ? [
            {
              title: "第一章",
              highlights,
              thoughts
            }
          ]
        : []
  };
}
