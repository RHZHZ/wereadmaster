import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import type {
  BookAiSummaryResponse,
  BookNotes,
  NoteSynthesisJob,
  NoteSynthesisPreview
} from "../lib/types";
import {
  BookAiSummaryPage,
  isActiveNoteSynthesisJob,
  isNoteSynthesisSnapshotStale,
  isVerifiedFullSnapshotSummary,
  NoteSynthesisJobCard
} from "./BookAiSummaryPage";

describe("BookAiSummaryPage M2 synthesis states", () => {
  test("active M2 jobs block the legacy single-pass generation path", () => {
    for (const status of ["queued", "snapshotting", "batching", "summarizing", "merging"] as const) {
      expect(isActiveNoteSynthesisJob(createJob(status))).toBe(true);
    }

    for (const status of ["completed", "partial", "failed", "cancelled"] as const) {
      expect(isActiveNoteSynthesisJob(createJob(status))).toBe(false);
    }
  });

  test("renders terminal tasks instead of dropping them after a reload", () => {
    const markup = renderCard(createJob("completed"));

    expect(markup).toContain("完整复盘已完成");
    expect(markup).toContain("已处理 12 / 12");
    expect(markup).toContain("批次 2 / 2");
    expect(markup).toContain("查看完整复盘");
  });

  test("uses immutable snapshot counts after a full task is created", () => {
    const markup = renderCard(
      createJob("completed"),
      { totalCount: 99, highlightCount: 80, thoughtCount: 19, estimatedBatchCount: 9 }
    );

    expect(markup).toContain("任务快照已固定：12 条笔记，2 个批次。");
    expect(markup).not.toContain("当前可处理笔记：99 条");
  });

  test("does not duplicate the full-result jump action when result is visible", () => {
    const markup = renderCard(createJob("completed"), {}, true);

    expect(markup).not.toContain("查看完整复盘");
  });

  test("marks completed results stale only when the current source hash changed", () => {
    const completed = createJob("completed");
    const changedPreview = createPreview(completed, {
      currentSourceHash: "changed-source-hash"
    });

    expect(isNoteSynthesisSnapshotStale(createPreview(completed), completed)).toBe(false);
    expect(isNoteSynthesisSnapshotStale(changedPreview, completed)).toBe(true);
    expect(
      isNoteSynthesisSnapshotStale(changedPreview, createJob("failed"))
    ).toBe(false);
    expect(
      isNoteSynthesisSnapshotStale(changedPreview, createJob("partial"))
    ).toBe(false);
  });

  test("completed stale snapshot offers a new snapshot action", () => {
    const job = createJob("completed");
    const markup = renderCard(job, { currentSourceHash: "changed-source-hash" });

    expect(markup).toContain("完整复盘已完成 · 旧快照");
    expect(markup).toContain("当前书籍已有新笔记或修改；本复盘基于旧快照，未包含这些变化。");
    expect(markup).toContain("创建新快照");
    expect(markup).toContain("查看完整复盘");
  });

  test("failed task without retryable batches tells the user to create a fresh snapshot", () => {
    const markup = renderCard(createJob("failed"));

    expect(markup).toContain("任务失败");
    expect(markup).toContain("该任务无法继续或重试；请创建新的快照任务后再归纳。");
    expect(markup).not.toContain("重试失败批次");
  });

  test("partial task exposes only the failed-batch retry action", () => {
    const markup = renderCard(createJob("partial", { failedBatches: [createFailedBatch()] }));

    expect(markup).toContain("部分批次失败");
    expect(markup).toContain("失败批次：2，可单独重试。");
    expect(markup).toContain("重试失败批次");
    expect(markup).not.toContain("取消任务");
  });

  test("page source keeps completed polling on the persisted full summary read path", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("./BookAiSummaryPage.tsx", import.meta.url), "utf8")
    );

    expect(source).toContain('if (nextJob.status === "completed")');
    expect(source).toContain("const variants = await getBookNotesSummaryVariants(targetBookId);");
    expect(source).toContain("setSummaryResponses(variants);");
  });

  test("quick review discloses the 80 highlight and 20 thought sampling budget", () => {
    const notes = createBookNotes(488, 20);
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookAiSummaryPage
          bookId="book-1"
          notes={notes}
          onOpenSettings={() => undefined}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("快速复盘最多使用 100 / 508 条");
    expect(markup).toContain("按章节分层抽样，不代表全量覆盖");
  });

  test("full snapshot source requires verified coverage and a matching result reference", () => {
    const job = createJob("completed", {
      result: {
        feature: "book-notes-summary",
        promptVersion: "book-notes-summary-full-v1",
        inputHash: "full-input-hash"
      }
    });
    const response = createSummaryResponse("full-input-hash");

    expect(isVerifiedFullSnapshotSummary(job, response)).toBe(true);
    expect(
      isVerifiedFullSnapshotSummary(
        { ...job, processedCount: 11 },
        response
      )
    ).toBe(false);
    expect(
      isVerifiedFullSnapshotSummary(
        { ...job, failedBatchCount: 1 },
        response
      )
    ).toBe(false);
    expect(isVerifiedFullSnapshotSummary(job, createSummaryResponse("other-hash"))).toBe(false);
  });
});

function renderCard(
  job: NoteSynthesisJob,
  previewOverrides: Partial<NoteSynthesisPreview> = {},
  resultVisible = false
): string {
  return renderToStaticMarkup(
    <NoteSynthesisJobCard
      preview={createPreview(job, previewOverrides)}
      job={job}
      resultVisible={resultVisible}
      consent={false}
      loading={false}
      onConsentChange={() => undefined}
      onStart={() => undefined}
      onContinue={() => undefined}
      onRetry={() => undefined}
      onCancel={() => undefined}
      onViewResult={() => undefined}
      onCreateNew={() => undefined}
    />
  );
}

function createPreview(
  job: NoteSynthesisJob,
  overrides: Partial<NoteSynthesisPreview> = {}
): NoteSynthesisPreview {
  return {
    bookId: "book-1",
    totalCount: 12,
    highlightCount: 8,
    thoughtCount: 4,
    estimatedBatchCount: 2,
    estimatedCharCount: 2400,
    currentSourceHash: "snapshot-hash",
    providerModel: "test-model",
    providerLabel: "测试 Provider",
    activeJob: job,
    ...overrides
  };
}

function createJob(
  status: NoteSynthesisJob["status"],
  overrides: Partial<NoteSynthesisJob> = {}
): NoteSynthesisJob {
  return {
    id: "job-1",
    bookId: "book-1",
    status,
    sourceSnapshotHash: "snapshot-hash",
    totalCount: 12,
    processedCount: 12,
    batchCount: 2,
    completedBatchCount: 2,
    failedBatchCount: 0,
    providerModel: "test-model",
    providerLabel: "测试 Provider",
    consentConfirmedAt: "2026-08-05T00:00:00.000Z",
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
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides
  };
}

function createFailedBatch() {
  return {
    batchIndex: 1,
    sourceCount: 6,
    attemptCount: 1,
    errorCode: "provider_network_error",
    errorMessage: "Provider request failed"
  };
}

function createBookNotes(highlightCount: number, thoughtCount: number): BookNotes {
  return {
    bookId: "book-1",
    book: {
      bookId: "book-1",
      title: "测试书籍",
      reviewCount: thoughtCount,
      noteCount: highlightCount,
      bookmarkCount: 0,
      totalNoteCount: highlightCount + thoughtCount
    },
    highlights: Array.from({ length: highlightCount }, (_, index) => ({
      bookmarkId: `highlight-${index}`,
      bookId: "book-1",
      chapterUid: index % 20,
      chapterTitle: `第 ${index % 20} 章`,
      markText: `划线 ${index}`
    })),
    thoughts: Array.from({ length: thoughtCount }, (_, index) => ({
      reviewId: `thought-${index}`,
      bookId: "book-1",
      chapterUid: index % 20,
      chapterName: `第 ${index % 20} 章`,
      content: `想法 ${index}`
    })),
    chapters: [],
    chapterGroups: [],
    bookmarkCount: 0,
    exportableCount: highlightCount + thoughtCount,
    bookmarkContentNotice: ""
  };
}

function createSummaryResponse(inputHash: string): BookAiSummaryResponse {
  return {
    bookId: "book-1",
    promptVersion: "book-notes-summary-full-v1",
    inputHash,
    source: "cache",
    summary: {
      overview: "完整复盘",
      keyIdeas: [],
      myFocus: [],
      actionItems: [],
      themeTags: [],
      representativeQuotes: [],
      reflectionQuestions: [],
      sourceStats: {
        highlightCount: 8,
        thoughtCount: 4,
        bookmarkCount: 0,
        chapterCount: 2,
        includedHighlightCount: 8,
        includedThoughtCount: 4
      },
      generatedAt: "100",
      promptVersion: "book-notes-summary-full-v1",
      basisNotice: "基于完整快照生成。"
    }
  };
}
