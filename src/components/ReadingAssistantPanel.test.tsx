import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ReadingAssistantBookReviewAction,
  ReadingAssistantCategoryBooksAction,
  ReadingAssistantMarkdownLite,
  ReadingAssistantNoteCountAction,
  ReadingAssistantNoteSearchAction,
  ReadingAssistantNoteSynthesisStatus,
  mergeReadingAssistantNoteSearchPages,
  ReadingAssistantRecommendedBookCard,
  formatReadingAssistantUsedContext,
  getReadingAssistantContextLabel
} from "./ReadingAssistantPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

describe("ReadingAssistantBookReviewAction", () => {
  it("uses distinct labels for AI assets and reading memory", () => {
    expect(getReadingAssistantContextLabel("aiAssetSummary")).toBe("资产摘要");
    expect(getReadingAssistantContextLabel("readingMemory")).toBe("阅读记忆");
    expect(getReadingAssistantContextLabel("aiAssetSummary")).not.toBe(
      getReadingAssistantContextLabel("readingMemory")
    );
  });

  it("renders the book review target and action button", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantBookReviewAction
        action={{
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          author: "罗伯特·清崎",
          message: "这类笔记总结应进入书籍复盘，不走阅读指南。",
          ctaLabel: "生成书籍复盘"
        }}
        onOpenBookReview={() => undefined}
      />
    );

    expect(markup).toContain("这类笔记总结应进入书籍复盘，不走阅读指南。");
    expect(markup).toContain("富爸爸穷爸爸");
    expect(markup).toContain("罗伯特·清崎");
    expect(markup).toContain("生成书籍复盘");
    expect(markup).toContain("reading-assistant-book-review-button");
  });

  it("keeps the target visible when navigation is unavailable", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantBookReviewAction
        action={{
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          message: "这类笔记总结应进入书籍复盘，不走阅读指南。",
          ctaLabel: "生成书籍复盘"
        }}
      />
    );

    expect(markup).toContain("富爸爸穷爸爸");
    expect(markup).not.toContain("reading-assistant-book-review-button");
  });
});

describe("ReadingAssistant M2 note synthesis status", () => {
  it("renders queued progress and only exposes an explicit continue action", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteSynthesisStatus
        job={{
          id: "job-1",
          bookId: "book-1",
          status: "queued",
          sourceSnapshotHash: "hash",
          totalCount: 12,
          processedCount: 0,
          batchCount: 2,
          completedBatchCount: 0,
          failedBatchCount: 0,
          providerModel: "test-model",
          providerLabel: "Test Provider",
          consentConfirmedAt: "100",
          failedBatches: [],
          coverage: {
            totalCount: 12,
            processedCount: 0,
            pendingCount: 12,
            skippedEmptyCount: 0,
            skippedDuplicateCount: 0,
            failedItemCount: 0,
            fullSnapshot: false
          },
          createdAt: "100",
          updatedAt: "100"
        }}
        loading={false}
        onContinue={() => undefined}
        onRetry={() => undefined}
        onCancel={() => undefined}
      />
    );

    expect(markup).toContain("全量归纳已创建，等待继续");
    expect(markup).toContain("已处理 0 / 12 条");
    expect(markup).toContain("继续归纳");
    expect(markup).toContain("取消");
    expect(markup).not.toContain("重试失败批次");
  });

  it("renders failed batches with retry and never offers terminal continue", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteSynthesisStatus
        job={{
          id: "job-2",
          bookId: "book-1",
          status: "failed",
          sourceSnapshotHash: "hash",
          totalCount: 12,
          processedCount: 6,
          batchCount: 2,
          completedBatchCount: 1,
          failedBatchCount: 1,
          providerModel: "test-model",
          providerLabel: "Test Provider",
          consentConfirmedAt: "100",
          failedBatches: [{ batchIndex: 1, sourceCount: 6, attemptCount: 1 }],
          coverage: {
            totalCount: 12,
            processedCount: 6,
            pendingCount: 6,
            skippedEmptyCount: 0,
            skippedDuplicateCount: 0,
            failedItemCount: 0,
            fullSnapshot: false
          },
          createdAt: "100",
          updatedAt: "100"
        }}
        loading={false}
        onContinue={() => undefined}
        onRetry={() => undefined}
        onCancel={() => undefined}
      />
    );

    expect(markup).toContain("失败批次：2");
    expect(markup).toContain("重试失败批次");
    expect(markup).not.toContain("继续归纳");
  });

  it("keeps a completed task actionable for opening the book review", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteSynthesisStatus
        job={{
          id: "job-3",
          bookId: "book-1",
          status: "completed",
          sourceSnapshotHash: "hash",
          totalCount: 12,
          processedCount: 12,
          batchCount: 2,
          completedBatchCount: 2,
          failedBatchCount: 0,
          providerModel: "test-model",
          providerLabel: "Test Provider",
          consentConfirmedAt: "100",
          failedBatches: [],
          coverage: {
            totalCount: 12,
            processedCount: 12,
            pendingCount: 0,
            skippedEmptyCount: 0,
            skippedDuplicateCount: 0,
            failedItemCount: 0,
            fullSnapshot: true
          },
          createdAt: "100",
          updatedAt: "100"
        }}
        loading={false}
        onContinue={() => undefined}
        onRetry={() => undefined}
        onCancel={() => undefined}
        onOpenBookReview={() => undefined}
      />
    );

    expect(markup).toContain("全量归纳已完成");
    expect(markup).toContain("查看书籍复盘");
    expect(markup).not.toContain("继续归纳");
  });
});

describe("ReadingAssistant M0 note context", () => {
  it("formats sampled raw notes with included and available counts", () => {
    expect(
      formatReadingAssistantUsedContext({
        contextType: "rawBookNotes",
        label: "原始笔记",
        sourceRefs: ["notes:book_1"],
        itemCount: 20,
        availableItemCount: 592,
        coverage: "sampled",
        truncated: true
      })
    ).toBe("原始笔记 · 已调用 20 / 本地 592 · 抽样");
  });

  it("keeps the legacy context format when no available count exists", () => {
    expect(
      formatReadingAssistantUsedContext({
        contextType: "rawBookNotes",
        label: "原始笔记片段",
        sourceRefs: ["notes:book_1"],
        itemCount: 20
      })
    ).toBe("原始笔记片段 · 20");
  });

  it("renders deterministic note counts", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteCountAction
        action={{
          bookId: "book_1",
          title: "深度工作",
          totalCount: 592,
          highlightCount: 530,
          thoughtCount: 62,
          message: "本地可验证笔记数量"
        }}
      />
    );

    expect(markup).toContain("《深度工作》");
    expect(markup).toContain("592");
    expect(markup).toContain("530");
    expect(markup).toContain("62");
    expect(markup).toContain("笔记总数");
  });
});

describe("ReadingAssistantRecommendedBookCard", () => {
  it("keeps recommendation actions below the book detail sections", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantRecommendedBookCard
        book={{
          title: "创业维艰",
          author: "本·霍洛维茨",
          reason: "硅谷顶级创业者的实战回忆录，聚焦公司生死存亡时刻的真实决策。",
          fit: "能补足《奥尔特曼传》的组织管理视角，适合在技术阅读之间切换语境。",
          risk: "管理案例密度较高，不适合想轻松阅读时打开。"
        }}
      />
    );

    expect(markup).toContain("reading-assistant-recommendation-footer");
    expect(markup).toContain("为什么推荐");
    expect(markup).toContain("适合你");
    expect(markup).toContain("取舍");
    expect(markup).toContain("搜索确认");
    expect(markup).toContain("加入本地候选");
    expect(markup.indexOf("reading-assistant-recommendation-body")).toBeLessThan(
      markup.indexOf("reading-assistant-recommendation-actions")
    );
  });
});

describe("ReadingAssistantMarkdownLite", () => {
  it("marks compact section labels and their following lists", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantMarkdownLite
        content={"当前可验证口径：全部历史。\n\n下一步：\n- 确认作者和版本。\n- 加入本地候选。"}
      />
    );

    expect(markup).toContain("reading-assistant-markdown-lite-label");
    expect(markup).toContain("reading-assistant-markdown-lite-list is-after-label");
    expect(markup).toContain("确认作者和版本");
    expect(markup).toContain("加入本地候选");
  });
});

describe("ReadingAssistantCategoryBooksAction", () => {
  it("renders local category books with separate stats count", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 4,
          totalStatReadingTimeText: "3小时28分钟",
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book_money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              readingTimeText: "1小时",
              source: "书架"
            }
          ]
        }}
      />
    );

    expect(markup).toContain("经济理财 · 本地可列 1 本 / 统计 4 本");
    expect(markup).toContain("小狗钱钱");
    expect(markup).toContain("博多·舍费尔");
    expect(markup).toContain("已读完");
    expect(markup).toContain("统计阅读时长 3小时28分钟");
  });

  it("renders openable local books as buttons", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "found",
          totalStatCount: 1,
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book-money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              source: "书架"
            }
          ]
        }}
        onOpenBookDetail={() => undefined}
        canOpenBookDetail={() => true}
      />
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("reading-assistant-category-book is-clickable");
    expect(markup).toContain("小狗钱钱");
  });

  it("renders note search coverage and keeps protected note text hidden", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteSearchAction
        action={{
          bookId: "book_1",
          title: "深度工作",
          queryText: "宽恕",
          mode: "lexical",
          coverage: "exhaustiveMatch",
          matchedItemCount: 2,
          includedItemCount: 1,
          truncated: true,
          hasMore: false,
          noteTypes: ["highlight", "thought"],
          items: [
            {
              documentId: "note:highlight:h1",
              sourceId: "h1",
              noteType: "highlight",
              chapterTitle: "第二章"
            }
          ]
        }}
      />
    );

    expect(markup).toContain("词面全部匹配");
    expect(markup).toContain("匹配 2 条 · 展示 1 条");
    expect(markup).toContain("第二章");
    expect(markup).toContain("开启原始笔记展示后可查看正文");
  });

  it("labels hybrid fallback note searches as local lexical retrieval", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantNoteSearchAction
        action={{
          bookId: "book_1",
          queryText: "宽恕",
          mode: "hybridFallback",
          coverage: "sampled",
          matchedItemCount: 1,
          includedItemCount: 1,
          truncated: false,
          hasMore: false,
          noteTypes: ["highlight"],
          items: []
        }}
      />
    );

    expect(markup).toContain("本地词法回退");
  });

  it("deduplicates replayed note pages and derives the displayed count", () => {
    const current = {
      bookId: "book_1",
      queryText: "宽恕",
      mode: "lexical" as const,
      coverage: "exhaustiveMatch" as const,
      matchedItemCount: 3,
      includedItemCount: 1,
      truncated: true,
      hasMore: true,
      nextCursor: "sort:1:100:note:highlight:h1",
      noteTypes: ["highlight" as const],
      items: [
        {
          documentId: "note:highlight:h1",
          sourceId: "h1",
          noteType: "highlight" as const
        }
      ]
    };
    const next = {
      ...current,
      includedItemCount: 2,
      hasMore: false,
      nextCursor: undefined,
      items: [
        current.items[0],
        {
          documentId: "note:thought:t1",
          sourceId: "t1",
          noteType: "thought" as const
        }
      ]
    };

    expect(mergeReadingAssistantNoteSearchPages(current, next)).toMatchObject({
      includedItemCount: 2,
      truncated: true,
      hasMore: false,
      nextCursor: undefined,
      items: [
        { documentId: "note:highlight:h1" },
        { documentId: "note:thought:t1" }
      ]
    });
  });

  it("keeps category books static when the book is not available in the shelf", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 1,
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book-money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              source: "统计缓存"
            }
          ]
        }}
        onOpenBookDetail={() => undefined}
        canOpenBookDetail={() => false}
      />
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("is-clickable");
    expect(markup).toContain("小狗钱钱");
  });

  it("keeps the missing-details boundary visible", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 34,
          listedCount: 0,
          message: "统计有聚合，但本地无明细。",
          books: []
        }}
      />
    );

    expect(markup).toContain("经济理财 · 本地可列 0 本 / 统计 34 本");
    expect(markup).toContain("统计总数不会被展开成伪书名");
  });
});
