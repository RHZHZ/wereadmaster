import { describe, expect, test } from "vitest";
import {
  buildAiActionItemId,
  buildAiAssetActionItemMatchKey,
  buildAiAssetActionItemStateKey,
  buildAiActionItemStateKey,
  buildAiReflectionQuestionId,
  buildAiReflectionQuestionStateKey,
  buildAiReviewFeedbackStateKey,
  createAiActionFeedbackRecord,
  deriveAiAssetActionFeedbackMatchKeys,
  deriveAiAssetActionItemFeedback,
  deriveAiAssetCompletedMatchKeys,
  deriveCompletedAiAssetActionItemIds,
  normalizeAiActionFeedbackNote,
  readAiAssetActionItemState,
  readAiAssetActionItemFeedback,
  readExactAiAssetActionItemFeedback,
  readAiActionItemFeedback,
  readAiReflectionQuestionFeedback,
  readAiReviewFeedback,
  readAiActionItemState,
  summarizeAiActionFeedback,
  writeAiAssetActionItemFeedback,
  writeAiAssetActionItemState,
  writeAiActionItemFeedback,
  writeAiReflectionQuestionFeedback,
  writeAiReviewFeedback,
  writeAiActionItemState,
  type AiActionItemStorage
} from "./ai-action-items";

function createMemoryStorage(initial?: Record<string, string>): AiActionItemStorage {
  const values = new Map(Object.entries(initial ?? {}));

  return {
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

describe("AI action item state", () => {
  test("builds a stable storage key scoped by book and input hash", () => {
    expect(buildAiActionItemStateKey("book-deep-work", "summary-hash")).toBe(
      "wxreadmaster.aiActionItems.v1:book-deep-work:summary-hash"
    );
  });

  test("builds a stable action item id from index and normalized text", () => {
    expect(buildAiActionItemId("  为阅读保留固定深度时段  ", 0)).toBe("0:为阅读保留固定深度时段");
  });

  test("reads an empty set when storage is missing or invalid", () => {
    const key = buildAiActionItemStateKey("book-deep-work", "summary-hash");

    expect(readAiActionItemState(createMemoryStorage(), "book-deep-work", "summary-hash")).toEqual(new Set());
    expect(readAiActionItemState(createMemoryStorage({ [key]: "{" }), "book-deep-work", "summary-hash")).toEqual(
      new Set()
    );
    expect(
      readAiActionItemState(createMemoryStorage({ [key]: JSON.stringify({ completedItemIds: [42] }) }), "book-deep-work", "summary-hash")
    ).toEqual(new Set());
  });

  test("writes and reads completed action item ids", () => {
    const storage = createMemoryStorage();
    const completed = new Set([
      buildAiActionItemId("为阅读保留固定深度时段", 0),
      buildAiActionItemId("把原则放进每日复盘", 1)
    ]);

    writeAiActionItemState(storage, "book-deep-work", "summary-hash", completed);

    expect(readAiActionItemState(storage, "book-deep-work", "summary-hash")).toEqual(completed);
  });

  test("writes and reads four-state feedback while preserving completed compatibility", () => {
    const storage = createMemoryStorage();
    const completedId = buildAiActionItemId("写一页复盘", 0);
    const skippedId = buildAiActionItemId("整理成分享稿", 1);

    writeAiActionItemFeedback(storage, "book-deep-work", "summary-hash", {
      [completedId]: createAiActionFeedbackRecord("completed", "已写 500 字复盘", "2024-01-01T00:00:00.000Z"),
      [skippedId]: createAiActionFeedbackRecord("skipped", "本周不做", "2024-01-02T00:00:00.000Z")
    });

    expect(readAiActionItemState(storage, "book-deep-work", "summary-hash")).toEqual(new Set([completedId]));
    expect(readAiActionItemFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      [completedId]: {
        status: "completed",
        note: "已写 500 字复盘",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      [skippedId]: {
        status: "skipped",
        note: "本周不做",
        updatedAt: "2024-01-02T00:00:00.000Z"
      }
    });
  });

  test("migrates legacy completed ids into completed feedback records", () => {
    const legacyId = buildAiActionItemId("把原则放进每日复盘", 0);
    const key = buildAiActionItemStateKey("book-deep-work", "summary-hash");
    const storage = createMemoryStorage({
      [key]: JSON.stringify({ completedItemIds: [legacyId] })
    });

    expect(readAiActionItemFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      [legacyId]: {
        status: "completed",
        updatedAt: "1970-01-01T00:00:00.000Z"
      }
    });
  });

  test("normalizes feedback notes and summarizes action feedback", () => {
    const ids = ["action-1", "action-2", "action-3", "action-4"];
    const longNote = "  已完成\n\n并补充到复盘文档  ".repeat(50);

    expect(normalizeAiActionFeedbackNote(longNote)).toHaveLength(500);
    expect(normalizeAiActionFeedbackNote("  第一段  \r\n\r\n\r\n  第二段\t补充  ")).toBe("第一段\n\n第二段 补充");
    expect(
      summarizeAiActionFeedback(ids, {
        "action-1": createAiActionFeedbackRecord("completed", "已完成"),
        "action-2": createAiActionFeedbackRecord("skipped"),
        "action-4": createAiActionFeedbackRecord("notApplicable", "不适合当前阶段")
      })
    ).toEqual({
      total: 4,
      todo: 1,
      completed: 1,
      skipped: 1,
      notApplicable: 1,
      withNote: 2
    });
  });

  test("stores legacy reflection question feedback separately from action item feedback", () => {
    const storage = createMemoryStorage();
    const actionId = buildAiActionItemId("写一页复盘", 0);
    const questionId = buildAiReflectionQuestionId("你如何定义自己的成功？", 0);

    expect(buildAiReflectionQuestionStateKey("book-deep-work", "summary-hash")).toBe(
      "wxreadmaster.aiReflectionQuestions.v1:book-deep-work:summary-hash"
    );

    writeAiActionItemFeedback(storage, "book-deep-work", "summary-hash", {
      [actionId]: createAiActionFeedbackRecord("completed", "已写行动清单", "2024-01-01T00:00:00.000Z")
    });
    writeAiReflectionQuestionFeedback(storage, "book-deep-work", "summary-hash", {
      [questionId]: createAiActionFeedbackRecord("completed", "已写 300 字回答", "2024-01-02T00:00:00.000Z")
    });

    expect(readAiActionItemFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      [actionId]: {
        status: "completed",
        note: "已写行动清单",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    });
    expect(readAiReflectionQuestionFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      [questionId]: {
        status: "completed",
        note: "已写 300 字回答",
        updatedAt: "2024-01-02T00:00:00.000Z"
      }
    });
  });

  test("writes and reads unified review feedback scoped by book and input hash", () => {
    const storage = createMemoryStorage();
    const actionId = buildAiActionItemId("写一页复盘", 0);
    const questionId = buildAiReflectionQuestionId("你如何定义自己的成功？", 0);

    expect(buildAiReviewFeedbackStateKey("book-deep-work", "summary-hash")).toBe(
      "wxreadmaster.aiReviewFeedback.v1:book-deep-work:summary-hash"
    );

    writeAiReviewFeedback(storage, "book-deep-work", "summary-hash", {
      actionItems: {
        [actionId]: createAiActionFeedbackRecord("completed", "已写行动清单", "2024-01-01T00:00:00.000Z")
      },
      reflectionQuestions: {
        [questionId]: createAiActionFeedbackRecord("completed", "已写 300 字回答", "2024-01-02T00:00:00.000Z")
      }
    });

    expect(readAiReviewFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      actionItems: {
        [actionId]: {
          status: "completed",
          note: "已写行动清单",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      },
      reflectionQuestions: {
        [questionId]: {
          status: "completed",
          note: "已写 300 字回答",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      }
    });
  });

  test("migrates legacy action and reflection feedback into unified review feedback when unified key is missing", () => {
    const storage = createMemoryStorage();
    const actionId = buildAiActionItemId("写一页复盘", 0);
    const questionId = buildAiReflectionQuestionId("你如何定义自己的成功？", 0);

    writeAiActionItemFeedback(storage, "book-deep-work", "summary-hash", {
      [actionId]: createAiActionFeedbackRecord("completed", "已写行动清单", "2024-01-01T00:00:00.000Z")
    });
    writeAiReflectionQuestionFeedback(storage, "book-deep-work", "summary-hash", {
      [questionId]: createAiActionFeedbackRecord("skipped", "暂不回答", "2024-01-02T00:00:00.000Z")
    });

    expect(readAiReviewFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      actionItems: {
        [actionId]: {
          status: "completed",
          note: "已写行动清单",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      },
      reflectionQuestions: {
        [questionId]: {
          status: "skipped",
          note: "暂不回答",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      }
    });
  });

  test("prefers unified review feedback over legacy split keys", () => {
    const storage = createMemoryStorage();
    const actionId = buildAiActionItemId("写一页复盘", 0);
    const questionId = buildAiReflectionQuestionId("你如何定义自己的成功？", 0);

    writeAiActionItemFeedback(storage, "book-deep-work", "summary-hash", {
      [actionId]: createAiActionFeedbackRecord("completed", "旧行动", "2024-01-01T00:00:00.000Z")
    });
    writeAiReflectionQuestionFeedback(storage, "book-deep-work", "summary-hash", {
      [questionId]: createAiActionFeedbackRecord("completed", "旧回答", "2024-01-01T00:00:00.000Z")
    });
    writeAiReviewFeedback(storage, "book-deep-work", "summary-hash", {
      actionItems: {
        [actionId]: createAiActionFeedbackRecord("skipped", "新行动", "2024-01-02T00:00:00.000Z")
      },
      reflectionQuestions: {}
    });

    expect(readAiReviewFeedback(storage, "book-deep-work", "summary-hash")).toEqual({
      actionItems: {
        [actionId]: {
          status: "skipped",
          note: "新行动",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      },
      reflectionQuestions: {}
    });
  });

  test("builds a stable asset action state key scoped by feature, scope and input hash", () => {
    expect(buildAiAssetActionItemStateKey("reading-route", "book:deep-work", "route-hash-v2")).toBe(
      "wxreadmaster.aiAssetActionItems.v1:reading-route:book:deep-work:route-hash-v2"
    );
  });

  test("inherits reusable completed route actions from previous version within the same scope", () => {
    const storage = createMemoryStorage();
    const previousCompleted = new Set([buildAiAssetActionItemMatchKey("今天安排 45 分钟读完第 2 章，并标出 3 条专注规则。")]);

    writeAiAssetActionItemState(storage, "reading-route", "book:deep-work", "route-hash-v1", previousCompleted);

    const inherited = readAiAssetActionItemState(storage, "reading-route", "book:deep-work", "route-hash-v2");
    const completedIds = deriveCompletedAiAssetActionItemIds(
      [
        "今天安排45分钟读完第2章，并写下3条专注规则。",
        "周末输出1页复盘，完成标准：保留2条下周继续执行的动作。"
      ],
      inherited
    );

    expect(completedIds).toEqual(
      new Set([buildAiActionItemId("今天安排45分钟读完第2章，并写下3条专注规则。", 0)])
    );
  });

  test("converts current completed item ids back into reusable asset action match keys", () => {
    const items = [
      "今天安排45分钟读完第2章，并写下3条专注规则。",
      "周末输出1页复盘，完成标准：保留2条下周继续执行的动作。"
    ];

    expect(
      deriveAiAssetCompletedMatchKeys(items, new Set([buildAiActionItemId(items[1], 1)]))
    ).toEqual(new Set([buildAiAssetActionItemMatchKey(items[1])]));
  });

  test("inherits reusable four-state feedback from previous asset versions", () => {
    const storage = createMemoryStorage();
    const previousItems = [
      "今天安排45分钟读完第2章，并写下3条专注规则。",
      "周末输出1页复盘，完成标准：保留2条下周继续执行的动作。"
    ];
    const currentItems = [
      "今天安排 45 分钟读完第 2 章，并标出 3 条专注规则。",
      "下周整理候选书，完成标准：保留1本继续读。"
    ];

    writeAiAssetActionItemFeedback(
      storage,
      "reading-route",
      "book:deep-work",
      "route-hash-v1",
      deriveAiAssetActionFeedbackMatchKeys(previousItems, {
        [buildAiActionItemId(previousItems[0], 0)]: createAiActionFeedbackRecord(
          "completed",
          "已写进复盘",
          "2024-01-01T00:00:00.000Z"
        ),
        [buildAiActionItemId(previousItems[1], 1)]: createAiActionFeedbackRecord(
          "notApplicable",
          "路线已调整",
          "2024-01-02T00:00:00.000Z"
        )
      })
    );

    const inherited = deriveAiAssetActionItemFeedback(
      currentItems,
      readAiAssetActionItemFeedback(storage, "reading-route", "book:deep-work", "route-hash-v2")
    );

    expect(inherited).toEqual({
      [buildAiActionItemId(currentItems[0], 0)]: {
        status: "completed",
        note: "已写进复盘",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    });
  });

  test("can read exact asset feedback without inheriting previous versions", () => {
    const storage = createMemoryStorage();
    const previousItems = ["今天安排45分钟读完第2章，并写下3条专注规则。"];

    writeAiAssetActionItemFeedback(
      storage,
      "reading-route",
      "book:deep-work",
      "route-hash-v1",
      deriveAiAssetActionFeedbackMatchKeys(previousItems, {
        [buildAiActionItemId(previousItems[0], 0)]: createAiActionFeedbackRecord(
          "completed",
          "旧版本反馈",
          "2024-01-01T00:00:00.000Z"
        )
      })
    );

    expect(readAiAssetActionItemFeedback(storage, "reading-route", "book:deep-work", "route-hash-v2")).toEqual({
      [buildAiAssetActionItemMatchKey(previousItems[0])]: {
        status: "completed",
        note: "旧版本反馈",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    });
    expect(readExactAiAssetActionItemFeedback(storage, "reading-route", "book:deep-work", "route-hash-v2")).toEqual({
      feedbackByItemId: {},
      hasReadableState: false
    });

    writeAiAssetActionItemFeedback(storage, "reading-route", "book:deep-work", "route-hash-v2", {});

    expect(readExactAiAssetActionItemFeedback(storage, "reading-route", "book:deep-work", "route-hash-v2")).toEqual({
      feedbackByItemId: {},
      hasReadableState: true
    });
  });
});
