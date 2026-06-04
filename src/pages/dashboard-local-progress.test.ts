import { describe, expect, test } from "vitest";
import type { ReadingItemState } from "../lib/types";
import { buildDashboardLocalProgress } from "./dashboard-local-progress";

describe("dashboard local progress", () => {
  test("prioritizes recently organized books as the progress highlight", () => {
    const progress = buildDashboardLocalProgress({
      readingStates: [
        state("book-old", "book", "organized", "旧书", "100"),
        state("book-new", "book", "organized", "深度工作", "300"),
        state("book-review", "book", "reviewing", "代码整洁之道", "400"),
        state("candidate-moon", "candidate", "toRead", "月亮与六便士", "500")
      ],
      reviewQueueCount: 1,
      candidateQueueCount: 1,
      notesBookCount: 2
    });

    expect(progress.badge).toBe("已有成果");
    expect(progress.subtitle).toBe("已有 2 本书完成整理，继续把复盘整理成稳定成果。");
    expect(progress.highlight).toMatchObject({
      title: "最近已整理《深度工作》",
      tone: "organized"
    });
    expect(progress.metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ["已整理", 2],
      ["待复盘", 1],
      ["本地候选", 1],
      ["笔记书", 2]
    ]);
  });

  test("uses queue counts when they include notebook review candidates", () => {
    const progress = buildDashboardLocalProgress({
      readingStates: [state("candidate-moon", "candidate", "toRead", "月亮与六便士", "500")],
      reviewQueueCount: 2,
      candidateQueueCount: 1,
      notesBookCount: 3
    });

    expect(progress.badge).toBe("待整理");
    expect(progress.subtitle).toBe("2 本书正在等你复盘，先处理最明确的一本。");
    expect(progress.metrics.find((metric) => metric.label === "待复盘")?.value).toBe(2);
    expect(progress.highlight).toMatchObject({
      title: "2 本书可整理",
      tone: "review"
    });
  });

  test("keeps the empty state explicit", () => {
    const progress = buildDashboardLocalProgress({
      readingStates: [],
      reviewQueueCount: 0,
      candidateQueueCount: 0,
      notesBookCount: 0
    });

    expect(progress.badge).toBe("待积累");
    expect(progress.highlight).toMatchObject({
      title: "还没有本地进展",
      tone: "empty"
    });
  });
});

function state(
  itemId: string,
  itemType: ReadingItemState["itemType"],
  status: ReadingItemState["status"],
  title: string,
  updatedAt: string
): ReadingItemState {
  return {
    itemId,
    itemType,
    status,
    title,
    createdAt: "1",
    updatedAt
  };
}
