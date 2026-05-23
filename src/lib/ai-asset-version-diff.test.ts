import { describe, expect, test } from "vitest";
import { assetRefreshReasonLabel, buildAssetVersionChangeSummary } from "./ai-asset-version-diff";
import type { AIAssetVersionDetail } from "./types";

describe("ai asset version diff", () => {
  test("summarizes reading route changes against previous version", () => {
    const summary = buildAssetVersionChangeSummary(
      createReadingRouteDetail({
        inputHash: "route-v2",
        promptVersion: "reading-route-v2.1",
        progress: 68,
        readingStageLabel: "收束整理",
        refreshReason: "notes_changed",
        routeOverview: "先收束当前书，再整理成一页复盘。",
        reviewQuestions: ["哪些规则值得下周继续执行？"],
        nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"]
      }),
      createReadingRouteDetail({
        inputHash: "route-v1",
        promptVersion: "reading-route-v2.0",
        progress: 36,
        readingStageLabel: "建立主线",
        refreshReason: "stage_changed",
        routeOverview: "先验证当前书是否值得继续深读。",
        reviewQuestions: ["这本书当前最值得验证的问题是什么？"],
        nextActions: ["今天读完第2章，并记下3条判断。"]
      })
    );

    expect(summary?.items).toContain("阅读阶段：建立主线 -> 收束整理");
    expect(summary?.items).toContain("阅读进度：36% -> 68%");
    expect(summary?.items).toContain("刷新原因：阅读阶段变化 -> 笔记变化");
    expect(summary?.items).toContain("Prompt：reading-route-v2.0 -> reading-route-v2.1");
    expect(summary?.items).toContain("主线结论已更新。");
    expect(summary?.items).toContain("复盘点：新增 1 条，移除 1 条，当前共 1 条。");
    expect(summary?.items).toContain("下一步行动：新增 1 条，移除 1 条，当前共 1 条。");
  });

  test("summarizes book review changes against previous version", () => {
    const summary = buildAssetVersionChangeSummary(
      createBookReviewDetail({
        inputHash: "review-v2",
        themeTags: ["专注", "习惯"],
        keyIdeas: ["专注需要环境约束", "输出能反向强化理解"],
        actionItems: ["本周写1页复盘并保留2条动作"],
        reflectionQuestions: ["下周最容易失守的干扰是什么？"],
        overview: "这一版更强调输出驱动。"
      }),
      createBookReviewDetail({
        inputHash: "review-v1",
        themeTags: ["专注"],
        keyIdeas: ["专注需要环境约束"],
        actionItems: ["今天整理3条重点摘录"],
        reflectionQuestions: ["这本书现在最打动你的观点是什么？"],
        overview: "上一版主要帮助建立理解框架。"
      })
    );

    expect(summary?.items).toContain("复盘概览已更新。");
    expect(summary?.items).toContain("主题标签：新增 1 个，当前共 2 个。");
    expect(summary?.items).toContain("关键观点：新增 1 条，当前共 2 条。");
    expect(summary?.items).toContain("行动与复盘：新增 1 条，移除 1 条，当前共 1 条。");
    expect(summary?.items).toContain("复盘问题：新增 1 条，移除 1 条，当前共 1 条。");
  });

  test("formats refresh reason labels for change summary", () => {
    expect(assetRefreshReasonLabel("stage_changed")).toBe("阅读阶段变化");
    expect(assetRefreshReasonLabel("notes_changed")).toBe("笔记变化");
    expect(assetRefreshReasonLabel("stalled")).toBe("停滞较久");
    expect(assetRefreshReasonLabel("completed")).toBe("已读完");
    expect(assetRefreshReasonLabel(undefined)).toBe("无需更新");
  });
});

function createReadingRouteDetail({
  inputHash,
  promptVersion,
  progress,
  readingStageLabel,
  refreshReason,
  routeOverview,
  reviewQuestions,
  nextActions
}: {
  inputHash: string;
  promptVersion: string;
  progress: number;
  readingStageLabel: string;
  refreshReason: AIAssetVersionDetail["refreshReason"];
  routeOverview: string;
  reviewQuestions: string[];
  nextActions: string[];
}): AIAssetVersionDetail {
  return {
    feature: "reading-route",
    scopeId: "book:deep-work",
    inputHash,
    promptVersion,
    generatedAt: "1710000000",
    updatedAt: "1710000000",
    source: "cache",
    title: "深度工作阅读指南",
    readingStage: "framing",
    readingStageLabel,
    progress,
    refreshReason,
    basisNotice: "基于本地缓存生成。",
    sourceStats: {},
    readingRoute: {
      routeOverview,
      books: [
        {
          bookId: "deep-work",
          title: "深度工作",
          author: "卡尔·纽波特",
          order: 1,
          role: "当前书",
          readingPurpose: "确认可直接执行的专注规则。",
          estimatedEffort: "2 个 45 分钟时段",
          localStatus: "reading",
          basis: "当前进度与最近笔记。"
        }
      ],
      dependencies: [],
      reviewCheckpoints: reviewQuestions.map((question) => ({
        timing: "读完当前章节后",
        question,
        suggestedOutput: "写 3 条判断。"
      })),
      nextActions,
      sourceStats: {
        currentBookCount: 1,
        candidateCount: 0,
        summaryCount: 0,
        statsSignalCount: 0,
        localStatusCount: 0
      },
      generatedAt: "1710000000",
      promptVersion,
      basisNotice: "基于本地缓存生成。"
    }
  };
}

function createBookReviewDetail({
  inputHash,
  themeTags,
  keyIdeas,
  actionItems,
  reflectionQuestions,
  overview
}: {
  inputHash: string;
  themeTags: string[];
  keyIdeas: string[];
  actionItems: string[];
  reflectionQuestions: string[];
  overview: string;
}): AIAssetVersionDetail {
  return {
    feature: "book-review",
    scopeId: "deep-work",
    inputHash,
    promptVersion: "book-notes-summary-v3",
    generatedAt: "1710000000",
    updatedAt: "1710000000",
    source: "cache",
    title: "深度工作复盘",
    readingStage: "closing",
    readingStageLabel: "收束整理",
    progress: 100,
    refreshReason: "completed",
    basisNotice: "基于本地缓存生成。",
    sourceStats: {},
    bookSummary: {
      overview,
      keyIdeas,
      myFocus: [],
      actionItems,
      themeTags,
      representativeQuotes: [],
      reflectionQuestions,
      sourceStats: {
        highlightCount: 0,
        thoughtCount: 0,
        bookmarkCount: 0,
        chapterCount: 0,
        includedHighlightCount: 0,
        includedThoughtCount: 0
      },
      generatedAt: "1710000000",
      promptVersion: "book-notes-summary-v3",
      basisNotice: "基于本地缓存生成。"
    }
  };
}
