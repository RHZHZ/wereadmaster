import { EXPORT_TARGET_ORDER, summarizeAssetExportOutcome } from "./asset-export-dialog";
import type {
  BookNotesSummariesExportOptions,
  BookNotesSummariesTargetExportRequest,
  BookNotesSummariesTargetExportResponse,
  BookNotesSummaryTargetSelection,
  ExportTargetResult,
  ExternalExportTarget
} from "./types";

export type BookReviewBulkExportOutcome = ReturnType<typeof summarizeAssetExportOutcome>;

export type BookReviewBulkExportSummary = {
  outcome: BookReviewBulkExportOutcome;
  succeeded: number;
  failed: number;
  skipped: number;
  total: number;
};

export function buildBookReviewBulkExportRequest({
  bookIds,
  targets,
  options
}: {
  bookIds: string[];
  targets: ExternalExportTarget[];
  options: BookNotesSummariesExportOptions;
}): BookNotesSummariesTargetExportRequest {
  return {
    items: bookIds.map((bookId) => ({
      bookId,
      targets: orderTargets(targets)
    })),
    options
  };
}

export function buildBookReviewBulkRetryRequest(
  response: BookNotesSummariesTargetExportResponse,
  options: BookNotesSummariesExportOptions
): BookNotesSummariesTargetExportRequest | undefined {
  const items = response.items
    .map<BookNotesSummaryTargetSelection | undefined>((item) => {
      const targets = orderTargets(
        item.results
          .filter((result) => result.status === "failed" || result.status === "skipped")
          .map((result) => result.target)
      );
      if (targets.length === 0) {
        return undefined;
      }

      const knownObsidianPath = item.results.find(
        (result) => result.target === "obsidian" && result.status === "succeeded"
      )?.path;
      return {
        bookId: item.bookId,
        targets,
        ...(targets.includes("notion") && knownObsidianPath ? { knownObsidianPath } : {})
      };
    })
    .filter((item): item is BookNotesSummaryTargetSelection => Boolean(item));

  return items.length > 0 ? { items, options } : undefined;
}

export function mergeBookReviewBulkExportResponses(
  current: BookNotesSummariesTargetExportResponse,
  retry: BookNotesSummariesTargetExportResponse
): BookNotesSummariesTargetExportResponse {
  const retryItems = new Map(retry.items.map((item) => [item.bookId, item]));
  const currentBookIds = new Set(current.items.map((item) => item.bookId));
  const items = current.items.map((item) => {
    const retryItem = retryItems.get(item.bookId);
    if (!retryItem) {
      return item;
    }

    const retryTargets = new Set(retryItem.results.map((result) => result.target));
    return {
      ...item,
      title: retryItem.title || item.title,
      author: retryItem.author ?? item.author,
      results: orderResults([
        ...item.results.filter((result) => !retryTargets.has(result.target)),
        ...retryItem.results
      ])
    };
  });

  for (const item of retry.items) {
    if (!currentBookIds.has(item.bookId)) {
      items.push({ ...item, results: orderResults(item.results) });
    }
  }

  return {
    exportId: current.exportId,
    exportedAt: retry.exportedAt || current.exportedAt,
    markdownBatch: retry.markdownBatch ?? current.markdownBatch,
    items
  };
}

export function summarizeBookReviewBulkExport(
  response: BookNotesSummariesTargetExportResponse
): BookReviewBulkExportSummary {
  const results = response.items.flatMap((item) => item.results);
  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return {
    outcome: summarizeAssetExportOutcome(results),
    succeeded,
    failed,
    skipped,
    total: results.length
  };
}

function orderTargets(targets: ExternalExportTarget[]): ExternalExportTarget[] {
  const selected = new Set(targets);
  return EXPORT_TARGET_ORDER.filter((target) => selected.has(target));
}

function orderResults(results: ExportTargetResult[]): ExportTargetResult[] {
  const byTarget = new Map(results.map((result) => [result.target, result]));
  return EXPORT_TARGET_ORDER.flatMap((target) => {
    const result = byTarget.get(target);
    return result ? [result] : [];
  });
}
