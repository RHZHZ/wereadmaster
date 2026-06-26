import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/ToastProvider";
import {
  buildAiActionItemId,
  buildAiAssetActionItemMatchKey,
  buildAiAssetActionItemStateKey,
  buildAiActionItemStateKey,
  buildAiReflectionQuestionId,
  buildAiReflectionQuestionStateKey,
  createAiActionFeedbackRecord
} from "../lib/ai-action-items";
import { AIAssetDetailView, AIAssetVersionDetailView, AssetVersionHistorySection, ReadingHubPage } from "./ReadingHubPage";
import type { AIAssetDetail, AIAssetVersionDetail, AIAssetVersionSummary, AssetVersionRef } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading hub asset history section", () => {
  test("renders workflow templates as existing-page entry points", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <ReadingHubPage
          credentialStatus={{ hasCredential: true }}
          cache={{}}
          onCacheChange={() => undefined}
          onOpenSettings={() => undefined}
          activeTab="books"
          onOpenBookSummary={() => undefined}
          onPrepareAssetUpdate={() => undefined}
          onOpenNotes={() => undefined}
          onOpenReadingAssets={() => undefined}
          onOpenReadingReport={() => undefined}
          onOpenCandidateShelf={() => undefined}
          onNotesOverviewChange={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("阅读工作流模板");
    expect(markup).toContain("整理一本书");
    expect(markup).toContain("规划当前书");
    expect(markup).toContain("回顾一段时间");
    expect(markup).toContain("决定下一本");
    expect(markup).toContain("模板连接现有页面和已确认输入范围");
  });

  test("renders collapsed lightweight history rows with required metadata", () => {
    const markup = renderToStaticMarkup(
      <AssetVersionHistorySection
        title="历史版本"
        versions={[
          {
            ...createHistoryItem(),
            previousVersion: createHistoryRef("上一版阅读指南")
          }
        ]}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).toContain("历史版本");
    expect(markup).not.toContain("reading-route-v1.9");
    expect(markup).toContain("建立框架");
    expect(markup).toContain("进度 36%");
    expect(markup).toContain("阅读阶段变化");
    expect(markup).toContain("本地缓存");
    expect(markup).toContain("上一版：上一版阅读指南");
    expect(markup).toContain("查看该版本");
  });

  test("renders empty state when no history exists", () => {
    const markup = renderToStaticMarkup(
      <AssetVersionHistorySection
        title="历史版本"
        versions={[]}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).toContain("暂无历史版本");
    expect(markup).toContain("只有生成过旧版本后，这里才会出现可回看的历史记录。");
  });

  test("renders grouped route histories in one history section", () => {
    const markup = renderToStaticMarkup(
      <AssetVersionHistorySection
        title="跨书路线历史"
        versions={[
          createHistoryItem(),
          {
            ...createHistoryItem(),
            scopeId: "book:book-1:candidates:b",
            title: "参与路线 B",
            promptVersion: "route-prompt-b"
          }
        ]}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).toContain("跨书路线历史");
    expect(markup).not.toContain("reading-route-v1.9");
    expect(markup).toContain("参与路线 B");
    expect((markup.match(/ai-asset-history-row/g) ?? []).length).toBe(2);
  });

  test("keeps version update context behind the prepare update entry", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView
          detail={createRouteVersionDetail({
            inputHash: "route-v2",
            progress: 68,
            readingStageLabel: "收束整理",
            refreshReason: "notes_changed",
            promptVersion: "reading-route-v2.1",
            routeOverview: "先收束当前书，再整理成一页复盘。",
            nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"],
            reviewQuestion: "哪些规则值得下周继续执行？"
          })}
          previousDetail={createRouteVersionDetail({
            inputHash: "route-v1",
            progress: 36,
            readingStageLabel: "建立主线",
            refreshReason: "stage_changed",
            promptVersion: "reading-route-v2.0",
            routeOverview: "先验证当前书是否值得继续深读。",
            nextActions: ["今天读完第2章，并记下3条判断。"],
            reviewQuestion: "这本书当前最值得验证的问题是什么？"
          })}
          isLoading={false}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("准备更新指南");
    expect(markup).not.toContain("与上一版相比");
    expect(markup).not.toContain("阅读阶段：建立主线 -&gt; 收束整理");
    expect(markup).not.toContain("阅读进度：36% -&gt; 68%");
    expect(markup).not.toContain("主线结论已更新。");
    expect(markup).toContain("上一版：2024-02-27 10:13 · reading-route-v2.0");
  });

  test("shows previous version reference in asset version detail header", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView
          detail={{
            ...createRouteVersionDetail({
              inputHash: "route-v2",
              progress: 68,
              readingStageLabel: "收束整理",
              refreshReason: "notes_changed",
              promptVersion: "reading-route-v2.1",
              routeOverview: "先收束当前书，再整理成一页复盘。",
              nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"],
              reviewQuestion: "哪些规则值得下周继续执行？"
            }),
            previousVersion: createHistoryRef("上一版阅读指南")
          }}
          isLoading={false}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("上一版：上一版阅读指南");
    expect(markup).toContain("当前本书阅读指南");
    expect(markup).toContain("更新依据");
    expect(markup).toContain("结构化约束：JSON Schema");
  });

  test("renders feedback outcome summary when the asset version provides one", () => {
    const detail = createRouteVersionDetail({
      inputHash: "route-v2",
      progress: 68,
      readingStageLabel: "收束整理",
      refreshReason: "notes_changed",
      promptVersion: "reading-route-v2.1",
      routeOverview: "先收束当前书，再整理成一页复盘。",
      nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"],
      reviewQuestion: "哪些规则值得下周继续执行？"
    });
    detail.readingRoute = {
      ...detail.readingRoute!,
      feedbackOutcomeSummary: {
        summary: "上一版已完成观点整理，本次改为压缩输出一页复盘。",
        appliedChanges: ["不再重复生成观点整理动作", "保留现实应用相关输出"]
      }
    };

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView detail={detail} isLoading={false} onBack={() => undefined} />
      </ToastProvider>
    );

    expect(markup).toContain("上次沉淀");
    expect(markup).toContain("上一版已完成观点整理，本次改为压缩输出一页复盘。");
    expect(markup).toContain("不再重复生成观点整理动作");
  });

  test("does not render feedback outcome summary when the asset version omits one", () => {
    const detail = createRouteVersionDetail({
      inputHash: "route-v2",
      progress: 68,
      readingStageLabel: "收束整理",
      refreshReason: "notes_changed",
      promptVersion: "reading-route-v2.1",
      routeOverview: "先收束当前书，再整理成一页复盘。",
      nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"],
      reviewQuestion: "哪些规则值得下周继续执行？"
    });

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView detail={detail} isLoading={false} onBack={() => undefined} />
      </ToastProvider>
    );

    expect(markup).not.toContain("上次沉淀");
  });

  test("renders local action feedback summary and regeneration boundary", () => {
    const detail = createRouteVersionDetail({
      inputHash: "route-v2",
      progress: 68,
      readingStageLabel: "收束整理",
      refreshReason: "notes_changed",
      promptVersion: "reading-route-v2.1",
      routeOverview: "先收束当前书，再整理成一页复盘。",
      nextActions: ["本周完成1页复盘，保留2条继续执行的动作。"],
      reviewQuestion: "哪些规则值得下周继续执行？"
    });
    const itemText = "本周完成1页复盘，保留2条继续执行的动作。";
    const itemMatchKey = buildAiAssetActionItemMatchKey(itemText);

    const localStorage = createMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(
      buildAiAssetActionItemStateKey(detail.feature, detail.scopeId, detail.inputHash),
      JSON.stringify({
        feedbackByItemId: {
          [itemMatchKey]: createAiActionFeedbackRecord(
            "completed",
            "已完成初稿",
            "2024-01-01T00:00:00.000Z"
          )
        },
        completedItemIds: [itemMatchKey]
      })
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView detail={detail} isLoading={false} onBack={() => undefined} />
      </ToastProvider>
    );

    expect(markup).toContain("准备更新指南");
    expect(markup).not.toContain("当前版本行动反馈摘要");
    expect(markup).not.toContain("<dt>反馈记录</dt><dd>1</dd>");
    expect(markup).not.toContain("重新生成前应核对");
    expect(markup).not.toContain("行动反馈摘要：已完成 1，暂不做 0，不适合 0，有记录 1");
  });

  test("uses stable version title instead of AI overview text", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView
          detail={createBookReviewVersionDetail({
            title: "这份复盘基于你当前导出的本地划线与想法，无法覆盖全书所有内容与论证细节。"
          })}
          assetBook={createAssetDetailWithGuide()}
          isLoading={false}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("<h3>《测试书籍》书籍复盘</h3>");
    expect(markup).not.toContain(
      "<h3>这份复盘基于你当前导出的本地划线与想法，无法覆盖全书所有内容与论证细节。</h3>"
    );
    expect(markup).toContain("结构化约束：JSON Object");
  });

  test("renders editable action feedback controls for book review version detail", () => {
    const detail = createBookReviewVersionDetail();
    const itemText = detail.bookSummary?.actionItems[0] ?? "";
    const localStorage = createMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(
      buildAiActionItemStateKey(detail.scopeId, detail.inputHash),
      JSON.stringify({
        feedbackByItemId: {
          [buildAiActionItemId(itemText, 0)]: createAiActionFeedbackRecord(
            "completed",
            "已完成复盘",
            "2024-01-01T00:00:00.000Z"
          )
        },
        completedItemIds: [buildAiActionItemId(itemText, 0)]
      })
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView detail={detail} isLoading={false} onBack={() => undefined} />
      </ToastProvider>
    );

    expect(markup).toContain("准备更新复盘");
    expect(markup).not.toContain("当前版本行动反馈摘要");
    expect(markup).not.toContain("<dt>已完成</dt><dd>1</dd>");
    expect(markup).not.toContain("重新生成前应核对");
    expect(markup).toContain("已完成");
    expect(markup).toContain("编辑反馈");
    expect(markup).toContain("已完成 1 / 共 1 项，记录 1");
    expect(markup).toContain("已完成复盘");
  });

  test("renders editable reflection question feedback controls for book review version detail", () => {
    const detail = createBookReviewVersionDetail();
    const questionText = detail.bookSummary?.reflectionQuestions[0] ?? "";
    const localStorage = createMemoryLocalStorage();
    vi.stubGlobal("window", { localStorage });

    localStorage.setItem(
      buildAiReflectionQuestionStateKey(detail.scopeId, detail.inputHash),
      JSON.stringify({
        feedbackByItemId: {
          [buildAiReflectionQuestionId(questionText, 0)]: createAiActionFeedbackRecord(
            "completed",
            "已写入复盘",
            "2024-01-01T00:00:00.000Z"
          )
        },
        completedItemIds: [buildAiReflectionQuestionId(questionText, 0)]
      })
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <AIAssetVersionDetailView detail={detail} isLoading={false} onBack={() => undefined} />
      </ToastProvider>
    );

    expect(markup).toContain("复盘问题");
    expect(markup).toContain("已回答 1 / 共 1 项");
    expect(markup).toContain("已回答");
    expect(markup).toContain("编辑反馈");
    expect(markup).toContain("记录 1");
    expect(markup).toContain("已写入复盘");
  });

  test("keeps book decision entry out of route asset detail", () => {
    const markup = renderToStaticMarkup(
      <AIAssetDetailView
        detail={createAssetDetailWithRoutes()}
        isLoading={false}
        activeTab="routes"
        onTabChange={() => undefined}
        onBack={() => undefined}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).not.toContain("用候选书架继续做取舍");
    expect(markup).not.toContain("去推荐下一本");
  });

  test("renders current asset refs as user-facing summary cards", () => {
    const markup = renderToStaticMarkup(
      <AIAssetDetailView
        detail={createAssetDetailWithGuide()}
        isLoading={false}
        activeTab="guide"
        onTabChange={() => undefined}
        onBack={() => undefined}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).toContain("《测试书籍》阅读指南");
    expect(markup).toContain("本书指南");
    expect(markup).toContain("本地缓存");
    expect(markup).not.toContain("技术信息：Prompt reading-route-v2.1");
    expect(markup).toContain("查看指南");
    expect(markup).toContain("ai-asset-ref-heading-actions");
    expect(markup).toContain("button");
    expect(markup).not.toContain("<dt>Prompt</dt>");
    expect(markup).not.toContain("Scope");
    expect(markup).not.toContain("gpt-4.1-mini</dd>");
    expect(markup).not.toContain("href=");
  });

  test("does not render AI overview text in asset ref card", () => {
    const detail = createAssetDetailWithGuide();
    detail.currentGuide = createRouteRef(
      "这份复盘基于你当前导出的本地划线与想法，无法覆盖全书所有内容与论证细节。",
      "book:book-1",
      "reading-route-v2.1"
    );

    const markup = renderToStaticMarkup(
      <AIAssetDetailView
        detail={detail}
        isLoading={false}
        activeTab="guide"
        onTabChange={() => undefined}
        onBack={() => undefined}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).toContain("《测试书籍》阅读指南");
    expect(markup).not.toContain("这份复盘基于你当前导出的本地划线与想法");
  });

  test("keeps asset ref card compact without footer wrapper", () => {
    const markup = renderToStaticMarkup(
      <AIAssetDetailView
        detail={createAssetDetailWithGuide()}
        isLoading={false}
        activeTab="guide"
        onTabChange={() => undefined}
        onBack={() => undefined}
        onOpenVersion={() => undefined}
      />
    );

    expect(markup).not.toContain("ai-asset-ref-footer");
  });
});

function createHistoryItem(): AIAssetVersionSummary {
  return {
    feature: "reading-route",
    scopeId: "book:book-1",
    inputHash: "guide-history-1",
    promptVersion: "reading-route-v1.9",
    generatedAt: "1709000000",
    updatedAt: "1709000000",
    source: "cache",
    title: "上一版阅读指南",
    providerModel: "gpt-4.1-mini",
    readingStage: "framing",
    readingStageLabel: "建立框架",
    progress: 36,
    refreshReason: "stage_changed",
    isCurrent: false
  };
}

function createHistoryRef(title: string): AssetVersionRef {
  return {
    feature: "reading-route",
    scopeId: "book:book-1",
    inputHash: "guide-history-0",
    promptVersion: "reading-route-v1.8",
    generatedAt: "1708000000",
    updatedAt: "1708000000",
    source: "cache",
    title,
    providerModel: "gpt-4.1-mini"
  };
}

function createMemoryLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

function createRouteRef(title: string, scopeId: string, promptVersion: string): AssetVersionRef {
  return {
    feature: "reading-route",
    scopeId,
    inputHash: `${scopeId}-hash`,
    promptVersion,
    generatedAt: "1709000000",
    updatedAt: "1709000000",
    source: "cache",
    title,
    providerModel: "gpt-4.1-mini"
  };
}

function createAssetDetailWithRoutes(): AIAssetDetail {
  return {
    bookId: "book-1",
    title: "测试书籍",
    author: "测试作者",
    progress: 42,
    readingStage: "framing",
    readingStageLabel: "建立主线",
    refreshState: "none",
    mainCrossRoutes: [createRouteRef("主路线", "book:book-1:candidates:route-a", "reading-route-v2.1")],
    participantCrossRoutes: []
  };
}

function createAssetDetailWithGuide(): AIAssetDetail {
  return {
    bookId: "book-1",
    title: "测试书籍",
    author: "测试作者",
    progress: 42,
    readingStage: "framing",
    readingStageLabel: "建立主线",
    refreshState: "none",
    currentGuide: createRouteRef("本书指南", "book:book-1", "reading-route-v2.1"),
    mainCrossRoutes: [],
    participantCrossRoutes: []
  };
}

function createRouteVersionDetail({
  inputHash,
  progress,
  readingStageLabel,
  refreshReason,
  promptVersion,
  routeOverview,
  nextActions,
  reviewQuestion
}: {
  inputHash: string;
  progress: number;
  readingStageLabel: string;
  refreshReason: AIAssetVersionDetail["refreshReason"];
  promptVersion: string;
  routeOverview: string;
  nextActions: string[];
  reviewQuestion: string;
}): AIAssetVersionDetail {
  return {
    feature: "reading-route",
    scopeId: "book:book-1",
    inputHash,
    promptVersion,
    generatedAt: "1709000000",
    updatedAt: "1709000000",
    source: "cache",
    title: "当前阅读指南",
    providerModel: "gpt-4.1-mini",
    readingStage: "framing",
    readingStageLabel,
    progress,
    refreshReason,
    basisNotice: "基于本地缓存生成。",
    sourceStats: {},
    readingRoute: {
      routeOverview,
      books: [],
      dependencies: [],
      reviewCheckpoints: [
        {
          timing: "读完当前阶段后",
          question: reviewQuestion,
          suggestedOutput: "写 3 条判断。"
        }
      ],
      nextActions,
      sourceStats: {
        currentBookCount: 1,
        candidateCount: 0,
        summaryCount: 0,
        statsSignalCount: 0,
        localStatusCount: 0
      },
      generatedAt: "1709000000",
      promptVersion,
      responseFormat: "json_schema",
      basisNotice: "基于本地缓存生成。"
    }
  };
}

function createBookReviewVersionDetail(overrides: Partial<AIAssetVersionDetail> = {}): AIAssetVersionDetail {
  return {
    feature: "book-review",
    scopeId: "book-1",
    inputHash: "summary-v2",
    promptVersion: "book-notes-summary-v3",
    generatedAt: "1709000000",
    updatedAt: "1709000000",
    source: "cache",
    title: "当前书籍复盘",
    providerModel: "gpt-4.1-mini",
    readingStage: "closing",
    readingStageLabel: "收束整理",
    progress: 88,
    refreshReason: "notes_changed",
    basisNotice: "基于本地笔记缓存生成。",
    sourceStats: {},
    bookSummary: {
      overview: "这本书当前复盘聚焦行动转化。",
      keyIdeas: ["把深度工作固化成固定时段。"],
      myFocus: ["减少临时打断。"],
      actionItems: ["本周写一页复盘，并保留2条下周继续执行的动作。"],
      themeTags: ["专注"],
      representativeQuotes: [],
      reflectionQuestions: ["哪条规则最值得保留？"],
      sourceStats: {
        highlightCount: 3,
        thoughtCount: 2,
        bookmarkCount: 1,
        chapterCount: 2,
        includedHighlightCount: 3,
        includedThoughtCount: 2
      },
      generatedAt: "1709000000",
      promptVersion: "book-notes-summary-v3",
      responseFormat: "json_object",
      basisNotice: "基于本地笔记缓存生成。"
    },
    ...overrides
  };
}
