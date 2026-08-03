import { describe, expect, test } from "vitest";
import {
  getCandidateQueue,
  getOrganizeQueue,
  isCandidateQueueItem
} from "./reading-selectors";
import type { NotebookBook, ReadingItemState } from "./types";

function buildState(overrides: Partial<ReadingItemState> = {}): ReadingItemState {
  return {
    itemId: "book-1",
    itemType: "book",
    status: "reading",
    title: "测试书籍",
    createdAt: "100",
    updatedAt: "100",
    ...overrides
  };
}

function buildBook(overrides: Partial<NotebookBook> = {}): NotebookBook {
  return {
    bookId: "book-1",
    title: "测试书籍",
    reviewCount: 1,
    noteCount: 2,
    bookmarkCount: 0,
    totalNoteCount: 3,
    sort: 100,
    ...overrides
  };
}

describe("getOrganizeQueue", () => {
  test("manual items stay ahead of suggestions and win duplicate qualification", () => {
    const manualBook = buildBook({ bookId: "manual", title: "手动书", reviewCount: 0 });
    const suggestedBook = buildBook({ bookId: "suggested", title: "建议书", reviewCount: 99 });

    const result = getOrganizeQueue({
      items: [
        buildState({ itemId: "manual", organizeStatus: "to_organize" }),
        buildState({ itemId: "suggested", organizeStatus: "none" })
      ],
      notebooks: [manualBook, suggestedBook],
      reviewedBookIds: new Set(),
      limit: 10
    });

    expect(result.map((item) => [item.book.bookId, item.source])).toEqual([
      ["manual", "manual"],
      ["suggested", "suggested"]
    ]);
    expect(result.filter((item) => item.book.bookId === "manual")).toHaveLength(1);
  });

  test("explicit dimension values override legacy reviewing and organized states", () => {
    const result = getOrganizeQueue({
      items: [
        buildState({ itemId: "explicit-none", status: "reviewing", organizeStatus: "none" }),
        buildState({ itemId: "explicit-organized", status: "reviewing", organizeStatus: "organized" }),
        buildState({ itemId: "legacy-reviewing", status: "reviewing", organizeStatus: undefined }),
        buildState({ itemId: "legacy-organized", status: "organized", organizeStatus: undefined })
      ],
      notebooks: [
        buildBook({ bookId: "explicit-none" }),
        buildBook({ bookId: "explicit-organized" }),
        buildBook({ bookId: "legacy-reviewing" }),
        buildBook({ bookId: "legacy-organized" })
      ],
      reviewedBookIds: new Set(),
      limit: 10
    });

    expect(result.map((item) => [item.book.bookId, item.source])).toEqual([
      ["legacy-reviewing", "manual"],
      ["explicit-none", "suggested"]
    ]);
  });

  test("suggestions require exportable notes and exclude reviewed or organized books", () => {
    const result = getOrganizeQueue({
      items: [
        buildState({ itemId: "organized", organizeStatus: "organized" }),
        buildState({ itemId: "manual-reviewed", organizeStatus: "to_organize" })
      ],
      notebooks: [
        buildBook({ bookId: "valid" }),
        buildBook({ bookId: "empty", reviewCount: 0, noteCount: 0, bookmarkCount: 0 }),
        buildBook({ bookId: "reviewed" }),
        buildBook({ bookId: "organized" }),
        buildBook({ bookId: "manual-reviewed" })
      ],
      reviewedBookIds: new Set(["reviewed", "manual-reviewed"]),
      limit: 10
    });

    expect(result.map((item) => [item.book.bookId, item.source])).toEqual([
      ["manual-reviewed", "manual"],
      ["valid", "suggested"]
    ]);
  });

  test("manual items without notebook data use honest zero-count shells", () => {
    const [candidate] = getOrganizeQueue({
      items: [
        buildState({
          itemId: "manual-shell",
          title: "仅状态书籍",
          author: "作者",
          organizeStatus: "to_organize"
        })
      ],
      notebooks: [],
      reviewedBookIds: new Set()
    });

    expect(candidate).toEqual({
      source: "manual",
      reason: "手动标记待整理",
      book: {
        bookId: "manual-shell",
        title: "仅状态书籍",
        author: "作者",
        cover: undefined,
        reviewCount: 0,
        noteCount: 0,
        bookmarkCount: 0,
        totalNoteCount: 0
      }
    });
  });

  test("sorts by thoughts, total notes, recent signal and stable book id", () => {
    const result = getOrganizeQueue({
      items: [],
      notebooks: [
        buildBook({ bookId: "d", reviewCount: 1, noteCount: 3, sort: 10 }),
        buildBook({ bookId: "c", reviewCount: 2, noteCount: 0, bookmarkCount: 0, sort: 5 }),
        buildBook({ bookId: "b", reviewCount: 1, noteCount: 3, sort: 20 }),
        buildBook({ bookId: "a", reviewCount: 1, noteCount: 3, sort: 20 })
      ],
      reviewedBookIds: new Set(),
      limit: 10
    });

    expect(result.map((item) => item.book.bookId)).toEqual(["c", "a", "b", "d"]);
  });

  test("uses updatedAt as the recent fallback for manual shells", () => {
    const result = getOrganizeQueue({
      items: [
        buildState({ itemId: "old", organizeStatus: "to_organize", updatedAt: "100" }),
        buildState({ itemId: "new", organizeStatus: "to_organize", updatedAt: "2026-08-01T10:00:00Z" })
      ],
      notebooks: [],
      reviewedBookIds: new Set(),
      limit: 10
    });

    expect(result.map((item) => item.book.bookId)).toEqual(["new", "old"]);
  });

  test("applies limits without mutating input arrays", () => {
    const items = [buildState({ itemId: "manual", organizeStatus: "to_organize" })];
    const notebooks = [buildBook({ bookId: "suggested" })];
    const itemsSnapshot = structuredClone(items);
    const notebooksSnapshot = structuredClone(notebooks);

    expect(
      getOrganizeQueue({ items, notebooks, reviewedBookIds: new Set(), limit: 1 })
    ).toHaveLength(1);
    expect(
      getOrganizeQueue({ items, notebooks, reviewedBookIds: new Set(), limit: 0 })
    ).toEqual([]);
    expect(
      getOrganizeQueue({ items, notebooks, reviewedBookIds: new Set(), limit: -1 })
    ).toEqual([]);
    expect(items).toEqual(itemsSnapshot);
    expect(notebooks).toEqual(notebooksSnapshot);
  });
});

describe("getCandidateQueue", () => {
  test("dimension candidate identity includes books and light candidates regardless of organize status", () => {
    const result = getCandidateQueue([
      buildState({ itemId: "book", itemType: "book", status: "reading", isCandidate: true, organizeStatus: "organized" }),
      buildState({ itemId: "light", itemType: "album", status: "reading", isCandidate: true, candidateSource: "light" })
    ]);

    expect(result.map((item) => item.itemId)).toEqual(["book", "light"]);
  });

  test("explicit false overrides legacy candidate fields", () => {
    const explicitFalse = buildState({
      itemType: "candidate",
      status: "toRead",
      isCandidate: false
    });

    expect(isCandidateQueueItem(explicitFalse)).toBe(false);
    expect(getCandidateQueue([explicitFalse])).toEqual([]);
  });

  test.each(["candidate", "album", "mp"] as const)(
    "keeps legacy %s toRead compatibility when dimension is missing",
    (itemType) => {
      const item = buildState({ itemId: itemType, itemType, status: "toRead", isCandidate: undefined });
      expect(getCandidateQueue([item])).toEqual([item]);
    }
  );

  test("sorts numeric and ISO timestamps with stable invalid-time fallback", () => {
    const result = getCandidateQueue([
      buildState({ itemId: "invalid-b", isCandidate: true, updatedAt: "invalid" }),
      buildState({ itemId: "numeric", isCandidate: true, updatedAt: "200" }),
      buildState({ itemId: "iso", isCandidate: true, updatedAt: "2026-08-01T10:00:00Z" }),
      buildState({ itemId: "invalid-a", isCandidate: true, updatedAt: "" })
    ]);

    expect(result.map((item) => item.itemId)).toEqual([
      "iso",
      "numeric",
      "invalid-a",
      "invalid-b"
    ]);
  });

  test("deduplicates by id, preserves structured source fields and applies limits immutably", () => {
    const sourceMeta = { savedFrom: "shelf" };
    const older = buildState({ itemId: "same", isCandidate: true, updatedAt: "100" });
    const newer = buildState({
      itemId: "same",
      isCandidate: true,
      candidateSource: "light",
      sourceMeta,
      note: "旧魔法文本不应被解析",
      updatedAt: "200"
    });
    const other = buildState({ itemId: "other", isCandidate: true, updatedAt: "150" });
    const items = [older, newer, other];
    const snapshot = structuredClone(items);

    const result = getCandidateQueue(items, 1);

    expect(result).toEqual([newer]);
    expect(result[0].candidateSource).toBe("light");
    expect(result[0].sourceMeta).toEqual(sourceMeta);
    expect(getCandidateQueue(items, 0)).toEqual([]);
    expect(items).toEqual(snapshot);
  });
});
