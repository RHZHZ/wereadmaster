import { describe, expect, it } from "vitest";
import {
  buildBookReviewBulkExportRequest,
  buildBookReviewBulkRetryRequest,
  mergeBookReviewBulkExportResponses,
  summarizeBookReviewBulkExport
} from "./book-review-bulk-export";
import type { BookNotesSummariesTargetExportResponse } from "./types";

const options = {
  includeActionFeedback: true,
  includeReflectionFeedback: false,
  includeRepresentativeQuotes: true
};

function response(
  items: BookNotesSummariesTargetExportResponse["items"],
  suffix = "1"
): BookNotesSummariesTargetExportResponse {
  return {
    exportId: `export-${suffix}`,
    exportedAt: `time-${suffix}`,
    items
  };
}

describe("book review bulk export helpers", () => {
  it("builds one independently selected target set for every book", () => {
    expect(
      buildBookReviewBulkExportRequest({
        bookIds: ["book-a", "book-b"],
        targets: ["notion", "markdown"],
        options
      })
    ).toEqual({
      items: [
        { bookId: "book-a", targets: ["markdown", "notion"] },
        { bookId: "book-b", targets: ["markdown", "notion"] }
      ],
      options
    });
  });

  it("retries only failed or skipped book-target pairs", () => {
    const current = response([
      {
        bookId: "book-a",
        title: "A",
        results: [
          { target: "markdown", status: "succeeded", path: "a.md" },
          { target: "obsidian", status: "succeeded", path: "vault/a.md" },
          { target: "notion", status: "failed", error: { code: "failed", message: "失败" } }
        ]
      },
      {
        bookId: "book-b",
        title: "B",
        results: [
          { target: "markdown", status: "succeeded", path: "b.md" },
          { target: "notion", status: "skipped", warning: "跳过" }
        ]
      }
    ]);

    expect(buildBookReviewBulkRetryRequest(current, options)).toEqual({
      items: [
        { bookId: "book-a", targets: ["notion"], knownObsidianPath: "vault/a.md" },
        { bookId: "book-b", targets: ["notion"] }
      ],
      options
    });
  });

  it("returns no retry request after every pair succeeds", () => {
    expect(
      buildBookReviewBulkRetryRequest(
        response([
          {
            bookId: "book-a",
            title: "A",
            results: [
              { target: "markdown", status: "succeeded" },
              { target: "obsidian", status: "succeeded" },
              { target: "notion", status: "succeeded" }
            ]
          }
        ]),
        options
      )
    ).toBeUndefined();
  });

  it("merges retried pairs without replacing successful pairs", () => {
    const current = response([
      {
        bookId: "book-a",
        title: "A",
        results: [
          { target: "markdown", status: "succeeded", path: "a.md" },
          { target: "notion", status: "failed", error: { code: "failed", message: "失败" } }
        ]
      }
    ]);
    const retry = response(
      [
        {
          bookId: "book-a",
          title: "A",
          results: [{ target: "notion", status: "succeeded", url: "https://notion.so/a" }]
        }
      ],
      "2"
    );

    const merged = mergeBookReviewBulkExportResponses(current, retry);
    expect(merged.items[0].results).toEqual([
      { target: "markdown", status: "succeeded", path: "a.md" },
      { target: "notion", status: "succeeded", url: "https://notion.so/a" }
    ]);
    expect(merged.exportId).toBe("export-1");
  });

  it("summarizes all pair-level outcomes", () => {
    const summary = summarizeBookReviewBulkExport(
      response([
        {
          bookId: "book-a",
          title: "A",
          results: [
            { target: "markdown", status: "succeeded" },
            { target: "obsidian", status: "failed" },
            { target: "notion", status: "skipped" }
          ]
        }
      ])
    );

    expect(summary).toEqual({
      outcome: "partial",
      succeeded: 1,
      failed: 1,
      skipped: 1,
      total: 3
    });
  });
});
