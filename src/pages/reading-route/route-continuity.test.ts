import { describe, expect, test } from "vitest";
import { buildReadingRouteContinuity } from "./route-continuity";
import type { ReadingRoute, ReadingRouteBookInput } from "../../lib/types";

describe("reading route continuity", () => {
  test("builds handoff guidance for the next book in a cross-book route", () => {
    const continuity = buildReadingRouteContinuity(
      createRoute(),
      {
        bookId: "book-current",
        title: "当前书",
        author: "作者 A"
      },
      true
    );

    expect(continuity).toEqual({
      currentTitle: "当前书",
      nextTitle: "下一本书",
      nextMeta: "作者 B · 2 个 45 分钟阅读时段",
      handoffReason: "先用当前书建立概念，再读下一本做实践校准。",
      switchCondition: "完成当前书的复盘输出后再切换。",
      continuationAction: "打开《下一本书》，先按路线里的阅读目的完成第一轮阅读。"
    });
  });

  test("returns undefined for single-book guide", () => {
    expect(buildReadingRouteContinuity(createRoute(), undefined, false)).toBeUndefined();
  });
});

function createRoute(): ReadingRoute {
  return {
    routeOverview: "先读当前书，再读下一本做实践校准。",
    books: [
      {
        bookId: "book-current",
        title: "当前书",
        author: "作者 A",
        order: 1,
        role: "当前书",
        readingPurpose: "先完成当前书的关键章节，形成一页复盘。",
        estimatedEffort: "1 个 45 分钟阅读时段",
        localStatus: "reading",
        basis: "当前进度 68%，已有复盘点。"
      },
      {
        bookId: "book-next",
        title: "下一本书",
        author: "作者 B",
        order: 2,
        role: "候选书",
        readingPurpose: "带着当前书形成的问题，验证实践路径。",
        estimatedEffort: "2 个 45 分钟阅读时段",
        localStatus: "candidate",
        basis: "候选书与当前主题相关。"
      }
    ],
    dependencies: [
      {
        fromBookId: "book-current",
        toBookId: "book-next",
        reason: "先用当前书建立概念，再读下一本做实践校准。"
      }
    ],
    reviewCheckpoints: [
      {
        timing: "完成当前书后",
        question: "当前书留下了哪个可验证问题？",
        suggestedOutput: "写 1 页复盘，保留 2 条下一本要验证的问题。"
      }
    ],
    nextActions: ["完成当前书的复盘输出后再切换。"],
    sourceStats: {
      currentBookCount: 1,
      candidateCount: 1,
      summaryCount: 0,
      statsSignalCount: 0,
      localStatusCount: 1
    },
    generatedAt: "1710000000",
    promptVersion: "reading-route-v2.1",
    basisNotice: "基于当前书和候选书生成。"
  };
}
