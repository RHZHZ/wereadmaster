import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../../components/ToastProvider";
import { buildAiActionItemId, createAiActionFeedbackRecord } from "../../lib/ai-action-items";
import { ReadingRouteResultPanel, formatReadingRouteActionChecklist } from "./ReadingRouteResultPanel";
import type { ReadingRoute, ReadingRouteResponse } from "../../lib/types";

describe("reading route result panel", () => {
  test("shows actionable checklist section for next actions", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <ReadingRouteResultPanel
          route={createRoute()}
          routeResponse={createRouteResponse()}
          isCrossBookRoute={false}
          resultTitle="本书指南图"
        />
      </ToastProvider>
    );

    expect(markup).toContain("下一步行动");
    expect(markup).toContain("已完成 0 / 共 2 项");
    expect(markup).toContain("待处理");
    expect(markup).toContain("记录反馈");
    expect(markup).toContain("复制行动清单");
    expect(markup).toContain("结构化约束：JSON Schema");
  });

  test("formats action checklist with completion markers", () => {
    const firstActionText = "今天安排45分钟读完第2章，写下3条专注规则。";
    const checklist = formatReadingRouteActionChecklist(
      [
        { title: "今天安排45分钟读完第2章", done: "写下3条专注规则。" },
        { title: "周末输出1页复盘", done: "保留2条下周继续执行的动作。" }
      ],
      {
        [buildAiActionItemId(firstActionText, 0)]: createAiActionFeedbackRecord(
          "completed",
          "已写入复盘\n\n保留两条动作",
          "2024-01-01T00:00:00.000Z"
        )
      }
    );

    expect(checklist).toContain("## 下一步行动");
    expect(checklist).toContain("- [x] 今天安排45分钟读完第2章，完成标准：写下3条专注规则。（已完成）");
    expect(checklist).toContain("反馈记录：已写入复盘");
    expect(checklist).toContain("反馈记录：保留两条动作");
    expect(checklist).toContain("- [ ] 周末输出1页复盘，完成标准：保留2条下周继续执行的动作。");
  });

  test("shows route continuity guidance for cross-book route", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <ReadingRouteResultPanel
          currentBook={{ bookId: "book-deep-work", title: "深度工作", author: "卡尔·纽波特" }}
          route={createCrossBookRoute()}
          routeResponse={createRouteResponse(createCrossBookRoute())}
          isCrossBookRoute={true}
          resultTitle="跨书路线图"
        />
      </ToastProvider>
    );

    expect(markup).toContain("接续下一本");
    expect(markup).toContain("深度工作 -&gt; 原子习惯");
    expect(markup).toContain("为什么切换");
    expect(markup).toContain("何时切换");
    expect(markup).toContain("接续动作");
    expect(markup).toContain("打开《原子习惯》");
  });
});

function createRoute(): ReadingRoute {
  return {
    routeOverview: "先围绕当前书完成一轮问题驱动阅读，再整理成复盘输出。",
    books: [
      {
        bookId: "book-deep-work",
        title: "深度工作",
        author: "卡尔·纽波特",
        order: 1,
        role: "当前书",
        readingPurpose: "先读完第 2 章到第 3 章，确认可直接执行的专注规则。",
        estimatedEffort: "2 个 45 分钟阅读时段",
        localStatus: "reading",
        basis: "当前进度 42%，最近笔记集中在专注环境。"
      }
    ],
    dependencies: [],
    reviewCheckpoints: [
      {
        timing: "读完第 3 章后",
        question: "哪些干扰最常打断你的深度工作？",
        suggestedOutput: "写 3 条干扰清单，并为每条补 1 个阻断动作。"
      }
    ],
    nextActions: [
      "今天安排45分钟读完第2章，并写下3条专注规则。",
      "周末输出1页复盘，完成标准：保留2条下周继续执行的动作。"
    ],
    sourceStats: {
      currentBookCount: 1,
      candidateCount: 0,
      summaryCount: 1,
      statsSignalCount: 1,
      localStatusCount: 1
    },
    generatedAt: "1710000000",
    promptVersion: "reading-route-v2.1",
    responseFormat: "json_schema",
    basisNotice: "基于当前书和本地状态生成。"
  };
}

function createRouteResponse(route = createRoute()): ReadingRouteResponse {
  return {
    bookId: "book-deep-work",
    scopeId: "book:book-deep-work",
    promptVersion: "reading-route-v2.1",
    inputHash: "route-hash-v2",
    source: "cache",
    route,
    cachedUpdatedAt: "1710000000"
  };
}

function createCrossBookRoute(): ReadingRoute {
  return {
    ...createRoute(),
    routeOverview: "先完成深度工作复盘，再接原子习惯做实践校准。",
    books: [
      ...createRoute().books,
      {
        bookId: "book-atomic-habits",
        title: "原子习惯",
        author: "詹姆斯·克利尔",
        order: 2,
        role: "候选书",
        readingPurpose: "用习惯设计校准深度工作的执行方式。",
        estimatedEffort: "2 个 45 分钟阅读时段",
        localStatus: "candidate",
        basis: "与当前主题存在实践衔接。"
      }
    ],
    dependencies: [
      {
        fromBookId: "book-deep-work",
        toBookId: "book-atomic-habits",
        reason: "先建立专注框架，再用习惯系统固化执行。"
      }
    ],
    nextActions: ["完成《深度工作》一页复盘后，再打开《原子习惯》。"]
  };
}
