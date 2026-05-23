import { describe, expect, test } from "vitest";
import {
  readBookDecisionDraft,
  writeBookDecisionDraft
} from "./book-decision-draft";

type MemoryStorage = Pick<Storage, "getItem" | "setItem">;

function createMemoryStorage(initial?: Record<string, string>): MemoryStorage {
  const values = new Map(Object.entries(initial ?? {}));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

describe("book decision draft", () => {
  test("reads undefined when storage is missing or invalid", () => {
    expect(readBookDecisionDraft(undefined)).toBeUndefined();
    expect(readBookDecisionDraft(createMemoryStorage())).toBeUndefined();
    expect(readBookDecisionDraft(createMemoryStorage({ "wxreadmaster.bookDecisionDraft.v1": "{" }))).toBeUndefined();
  });

  test("writes and reads a normalized draft", () => {
    const storage = createMemoryStorage();

    writeBookDecisionDraft(storage, {
      selectedIds: ["rec-moon", "rec-moon", "book-deep-work"],
      selectedFactorIds: ["habits", "recent"],
      decisionGoal: "推进长期书",
      recentReadingWindowMode: 60
    });

    expect(readBookDecisionDraft(storage)).toEqual({
      selectedIds: ["book-deep-work", "rec-moon"],
      selectedFactorIds: ["habits", "recent"],
      decisionGoal: "推进长期书",
      recentReadingWindowMode: 60
    });
  });

  test("falls back to safe defaults for malformed fields", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.bookDecisionDraft.v1": JSON.stringify({
        selectedIds: [42, "rec-moon"],
        selectedFactorIds: [false, "recent"],
        decisionGoal: "invalid",
        recentReadingWindowMode: "invalid"
      })
    });

    expect(readBookDecisionDraft(storage)).toEqual({
      selectedIds: ["rec-moon"],
      selectedFactorIds: ["recent"],
      decisionGoal: "轻松读",
      recentReadingWindowMode: "auto"
    });
  });
});
