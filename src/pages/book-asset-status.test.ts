import { describe, expect, test } from "vitest";
import type { ReadingItemState, ReadingProgress } from "../lib/types";
import { buildBookAssetStatus, type BookAssetStatusInput } from "./book-asset-status";

const baseInput: BookAssetStatusInput = {
  shelfEntry: { isFinished: false },
  progress: {
    progressPercent: 42,
    isStarted: true,
    isFinished: false
  },
  canOpenNotes: true,
  canOpenAiSummary: true,
  canOpenReadingRoute: true
};

describe("book asset status", () => {
  test("prioritizes explicit local organized and reviewing states", () => {
    expect(
      buildBookAssetStatus({
        ...baseInput,
        readingState: state("organized"),
        progress: progress({ progressPercent: 100, isFinished: true })
      })
    ).toMatchObject({
      label: "已整理",
      title: "已经整理成阅读成果",
      progressLabel: "微信进度 已读完",
      nextActionLabel: "AI 复盘",
      tone: "organized"
    });

    expect(
      buildBookAssetStatus({
        ...baseInput,
        readingState: state("reviewing"),
        canOpenAiSummary: false
      })
    ).toMatchObject({
      label: "待复盘",
      title: "下一步是整理这本书",
      nextActionLabel: "查看笔记",
      tone: "review"
    });
  });

  test("shows candidate state before generic progress states", () => {
    const status = buildBookAssetStatus({
      ...baseInput,
      readingState: state("toRead", "candidate"),
      progress: progress({ progressPercent: 0, isStarted: false })
    });

    expect(status).toMatchObject({
      label: "本地候选",
      title: "已进入候选池",
      progressLabel: "微信进度 未开始",
      nextActionLabel: "本书阅读指南",
      tone: "candidate"
    });
  });

  test("maps finished, reading and new books to concrete next actions", () => {
    expect(
      buildBookAssetStatus({
        ...baseInput,
        progress: progress({ progressPercent: 100, isFinished: false })
      })
    ).toMatchObject({
      label: "已读完",
      progressLabel: "微信进度 已读完",
      nextActionLabel: "AI 复盘",
      tone: "finished"
    });

    expect(buildBookAssetStatus(baseInput)).toMatchObject({
      label: "阅读中",
      progressLabel: "微信进度 42%",
      nextActionLabel: "本书阅读指南",
      tone: "reading"
    });

    expect(
      buildBookAssetStatus({
        ...baseInput,
        progress: progress({ progressPercent: 0, isStarted: false }),
        canOpenReadingRoute: false
      })
    ).toMatchObject({
      label: "未开始",
      progressLabel: "微信进度 未开始",
      nextActionLabel: "加入候选",
      tone: "new"
    });
  });
});

function state(
  status: ReadingItemState["status"],
  itemType: ReadingItemState["itemType"] = "book"
): Pick<ReadingItemState, "itemType" | "status"> {
  return {
    itemType,
    status
  };
}

function progress(input: Partial<ReadingProgress>): ReadingProgress {
  return {
    bookId: "book-1",
    progressPercent: 42,
    isStarted: true,
    isFinished: false,
    ...input
  };
}
