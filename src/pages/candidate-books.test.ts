import { describe, expect, test } from "vitest";
import {
  buildCandidateConfirmationSearchKeyword,
  buildCandidateFilteredEmptyState,
  buildConfirmedCandidateReplacementNote,
  buildCandidateSourceStats,
  canOpenCandidateDetail,
  filterCandidatesBySource,
  getCandidateSourceLabel,
  getCandidateSourceTone,
  isSavedCandidateState,
  isUnconfirmedAiCandidate,
  mapCandidateStateToSearchResult,
  resolveCandidateReplacement,
  type LocalCandidateBook
} from "./candidate-books";
import type { ReadingItemState, SearchResult } from "../lib/types";

describe("candidate books helpers", () => {
  test("keeps only saved candidate-like states", () => {
    expect(
      isSavedCandidateState({
        itemId: "book_1",
        itemType: "candidate",
        status: "toRead",
        createdAt: "1",
        updatedAt: "1"
      })
    ).toBe(true);
    expect(
      isSavedCandidateState({
        itemId: "book_1",
        itemType: "book",
        status: "toRead",
        createdAt: "1",
        updatedAt: "1"
      })
    ).toBe(false);
    expect(
      isSavedCandidateState({
        itemId: "book_1",
        itemType: "candidate",
        status: "reading",
        createdAt: "1",
        updatedAt: "1"
      })
    ).toBe(false);
  });

  test("maps reading item state to local candidate book", () => {
    const state: ReadingItemState = {
      itemId: "book_1",
      itemType: "candidate",
      status: "toRead",
      title: "可能性的艺术",
      author: "作者甲",
      note: "发现页保存的本地候选",
      createdAt: "1",
      updatedAt: "1"
    };

    expect(mapCandidateStateToSearchResult(state)).toMatchObject({
      bookId: "book_1",
      title: "可能性的艺术",
      author: "作者甲",
      localType: "candidate",
      localNote: "发现页保存的本地候选"
    });
  });

  test("builds candidate confirmation search keyword from title and author", () => {
    expect(
      buildCandidateConfirmationSearchKeyword(
        candidate({ title: "  可能性的艺术  ", author: " 作者甲 " })
      )
    ).toBe("可能性的艺术 作者甲");
    expect(buildCandidateConfirmationSearchKeyword(candidate({ author: undefined }))).toBe(
      "可能性的艺术"
    );
  });

  test("marks local AI recommendations as unconfirmed and blocks invalid detail navigation", () => {
    const book = candidate({
      bookId: "ai-rec-123",
      localNote: "来自 AI 阅读助手推荐：适合继续读。"
    });

    expect(isUnconfirmedAiCandidate(book)).toBe(true);
    expect(canOpenCandidateDetail(book)).toBe(false);
    expect(getCandidateSourceLabel(book)).toBe("AI 推荐 · 未确认书源");
    expect(getCandidateSourceTone(book)).toBe("unconfirmed");
  });

  test("marks searched AI recommendations as confirmed WeRead books", () => {
    const book = candidate({
      bookId: "book_123",
      localNote: "来自 AI 阅读助手推荐：适合继续读。\n已通过微信读书搜索确认。"
    });

    expect(isUnconfirmedAiCandidate(book)).toBe(false);
    expect(canOpenCandidateDetail(book)).toBe(true);
    expect(getCandidateSourceLabel(book)).toBe("AI 推荐 · 微信读书已确认");
    expect(getCandidateSourceTone(book)).toBe("confirmed");
  });

  test("builds confirmed replacement note without duplicating marker", () => {
    const book = candidate({
      localNote: "来自 AI 阅读助手推荐：适合继续读。"
    });
    const confirmedNote = buildConfirmedCandidateReplacementNote(book);

    expect(confirmedNote).toContain("来自 AI 阅读助手推荐");
    expect(confirmedNote).toContain("已通过微信读书搜索确认");
    expect(buildConfirmedCandidateReplacementNote({ ...book, localNote: confirmedNote })).toBe(
      confirmedNote
    );
  });

  test("resolves candidate replacement by creating confirmed candidate when no existing state exists", () => {
    const resolution = resolveCandidateReplacement(
      candidate({ bookId: "ai-rec-123", localNote: "来自 AI 阅读助手推荐：适合继续读。" }),
      searchResult({ bookId: "book_123" })
    );

    expect(resolution.status).toBe("create");
    if (resolution.status === "create") {
      expect(resolution.replacement).toMatchObject({
        bookId: "book_123",
        title: "可能性的艺术",
        localType: "candidate"
      });
      expect(resolution.replacement.localNote).toContain("已通过微信读书搜索确认");
    }
  });

  test("resolves candidate replacement by reusing existing candidate without overwriting note", () => {
    const resolution = resolveCandidateReplacement(
      candidate({ bookId: "ai-rec-123" }),
      searchResult({ bookId: "book_123" }),
      {
        itemId: "book_123",
        itemType: "candidate",
        status: "toRead",
        title: "已有候选",
        note: "用户已有备注",
        createdAt: "1",
        updatedAt: "1"
      }
    );

    expect(resolution.status).toBe("reuse");
    if (resolution.status === "reuse") {
      expect(resolution.replacement.localNote).toBe("用户已有备注");
      expect(resolution.replacement.title).toBe("已有候选");
    }
  });

  test("blocks candidate replacement when search result already has another reading state", () => {
    const resolution = resolveCandidateReplacement(
      candidate({ bookId: "ai-rec-123" }),
      searchResult({ bookId: "book_123" }),
      {
        itemId: "book_123",
        itemType: "book",
        status: "reading",
        title: "正在读",
        createdAt: "1",
        updatedAt: "1"
      }
    );

    expect(resolution.status).toBe("blocked");
  });

  test("keeps regular WeRead and light candidates distinct", () => {
    expect(getCandidateSourceLabel(candidate({ bookId: "book_1" }))).toBe(
      "微信读书书目 · 本机候选"
    );
    expect(getCandidateSourceTone(candidate({ bookId: "book_1" }))).toBe("confirmed");

    const album = candidate({ bookId: "album_1", localType: "album" });
    expect(canOpenCandidateDetail(album)).toBe(false);
    expect(getCandidateSourceLabel(album)).toBe("有声书 · 轻管理候选");
    expect(getCandidateSourceTone(album)).toBe("light");
  });

  test("builds source stats and filters candidate books by source", () => {
    const confirmed = candidate({ bookId: "book_1" });
    const unconfirmed = candidate({
      bookId: "ai-rec-123",
      localNote: "来自 AI 阅读助手推荐：适合继续读。"
    });
    const light = candidate({ bookId: "album_1", localType: "album" });
    const books = [confirmed, unconfirmed, light];

    expect(buildCandidateSourceStats(books)).toEqual({
      total: 3,
      confirmed: 1,
      unconfirmed: 1,
      light: 1
    });
    expect(filterCandidatesBySource(books, "all")).toEqual(books);
    expect(filterCandidatesBySource(books, "confirmed")).toEqual([confirmed]);
    expect(filterCandidatesBySource(books, "unconfirmed")).toEqual([unconfirmed]);
    expect(filterCandidatesBySource(books, "light")).toEqual([light]);
  });

  test("builds filtered empty state for query and source filters", () => {
    expect(
      buildCandidateFilteredEmptyState({
        query: "不存在",
        sourceFilter: "all",
        sourceFilteredCount: 3,
        visibleCount: 0
      })
    ).toEqual({
      title: "没有匹配的候选书",
      description: "换一个关键词，或清空搜索继续浏览。",
      canClearQuery: true,
      canShowAllSources: false
    });

    expect(
      buildCandidateFilteredEmptyState({
        query: "",
        sourceFilter: "unconfirmed",
        sourceFilteredCount: 0,
        visibleCount: 0
      })
    ).toEqual({
      title: "当前筛选下没有候选书",
      description: "切回全部候选继续浏览。",
      canClearQuery: false,
      canShowAllSources: true
    });

    expect(
      buildCandidateFilteredEmptyState({
        query: "不存在",
        sourceFilter: "confirmed",
        sourceFilteredCount: 2,
        visibleCount: 0
      })
    ).toEqual({
      title: "当前筛选下没有匹配候选",
      description: "可以清空搜索，或切回全部候选继续浏览。",
      canClearQuery: true,
      canShowAllSources: true
    });

    expect(
      buildCandidateFilteredEmptyState({
        query: "",
        sourceFilter: "all",
        sourceFilteredCount: 3,
        visibleCount: 2
      })
    ).toBeUndefined();
  });
});

function candidate(overrides: Partial<LocalCandidateBook>): LocalCandidateBook {
  return {
    bookId: "book_1",
    title: "可能性的艺术",
    localType: "candidate",
    ...overrides
  };
}

function searchResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    bookId: "book_1",
    title: "可能性的艺术",
    author: "作者甲",
    ...overrides
  };
}
