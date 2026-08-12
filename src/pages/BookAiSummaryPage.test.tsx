import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { NoteSynthesisJob, NoteSynthesisPreview } from "../lib/types";
import { isActiveNoteSynthesisJob, NoteSynthesisJobCard } from "./BookAiSummaryPage";

describe("BookAiSummaryPage M2 synthesis states", () => {
  test("active M2 jobs block the legacy single-pass generation path", () => {
    for (const status of ["queued", "snapshotting", "batching", "summarizing", "merging", "partial"] as const) {
      expect(isActiveNoteSynthesisJob(createJob(status))).toBe(true);
    }

    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(isActiveNoteSynthesisJob(createJob(status))).toBe(false);
    }
  });

  test("renders terminal tasks instead of dropping them after a reload", () => {
    const markup = renderCard(createJob("completed"));

    expect(markup).toContain("全量归纳已完成");
    expect(markup).toContain("已处理 12 / 12");
    expect(markup).toContain("批次 2 / 2");
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
    expect(markup).toContain("取消任务");
  });

  test("page source keeps completed polling on the persisted full summary read path", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("./BookAiSummaryPage.tsx", import.meta.url), "utf8")
    );

    expect(source).toContain('if (nextJob.status === "completed")');
    expect(source).toContain("const cached = await getLatestBookNotesSummary(targetBookId);");
    expect(source).toContain("setSummaryResponse(cached);");
  });
});

function renderCard(job: NoteSynthesisJob): string {
  return renderToStaticMarkup(
    <NoteSynthesisJobCard
      preview={createPreview(job)}
      job={job}
      consent={false}
      loading={false}
      onConsentChange={() => undefined}
      onStart={() => undefined}
      onContinue={() => undefined}
      onRetry={() => undefined}
      onCancel={() => undefined}
    />
  );
}

function createPreview(job: NoteSynthesisJob): NoteSynthesisPreview {
  return {
    bookId: "book-1",
    totalCount: 12,
    highlightCount: 8,
    thoughtCount: 4,
    estimatedBatchCount: 2,
    estimatedCharCount: 2400,
    providerModel: "test-model",
    providerLabel: "测试 Provider",
    activeJob: job
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
