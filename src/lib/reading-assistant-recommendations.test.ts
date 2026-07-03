import { describe, expect, test } from "vitest";
import {
  buildAiRecommendationCandidateNote,
  buildAiRecommendedCandidateId,
  buildConfirmedAiRecommendationCandidateNote,
  buildRecommendedBookSearchKeyword,
  dedupeRecommendedBookSearchResults,
  findExistingCandidateState,
  findExistingReadingItemStateById,
  recommendedBookKey,
} from "./reading-assistant-recommendations";
import type { ReadingAssistantRecommendedBook, ReadingItemState, SearchResult } from "./types";

const recommendedBook: ReadingAssistantRecommendedBook = {
  title: "可能性的艺术",
  author: "作者甲",
  reason: "延续你关注的成长主题。",
  fit: "适合继续追问选择和行动。",
  risk: "理论密度可能偏高。",
};

describe("reading assistant recommendation helpers", () => {
  test("builds stable keys and local candidate ids", () => {
    expect(recommendedBookKey(recommendedBook)).toBe("可能性的艺术|作者甲");
    expect(buildAiRecommendedCandidateId(recommendedBook)).toMatch(/^ai-rec-[a-z0-9]+$/);
    expect(buildAiRecommendedCandidateId(recommendedBook)).toBe(
      buildAiRecommendedCandidateId({
        ...recommendedBook,
        title: "  可能性的艺术  ",
      })
    );
  });

  test("builds search keyword without recommendation context", () => {
    expect(buildRecommendedBookSearchKeyword(recommendedBook)).toBe("可能性的艺术 作者甲");
    expect(buildRecommendedBookSearchKeyword({ ...recommendedBook, author: "" })).toBe(
      "可能性的艺术"
    );
  });

  test("finds existing candidate by normalized title and author", () => {
    const states: ReadingItemState[] = [
      {
        itemId: "candidate_1",
        itemType: "candidate",
        status: "toRead",
        title: "可能性的艺术",
        author: "作者甲",
        createdAt: "1",
        updatedAt: "1",
      },
      {
        itemId: "book_1",
        itemType: "book",
        status: "toRead",
        title: "可能性的艺术",
        author: "作者甲",
        createdAt: "1",
        updatedAt: "1",
      },
    ];

    expect(findExistingCandidateState(states, recommendedBook)?.itemId).toBe("candidate_1");
    expect(
      findExistingCandidateState(states, {
        ...recommendedBook,
        author: "另一位作者",
      })
    ).toBeUndefined();
  });

  test("finds existing reading item by normalized item id", () => {
    const states: ReadingItemState[] = [
      {
        itemId: " book_1 ",
        itemType: "book",
        status: "reading",
        title: "可能性的艺术",
        createdAt: "1",
        updatedAt: "1",
      },
    ];

    expect(findExistingReadingItemStateById(states, "book_1")?.status).toBe("reading");
    expect(findExistingReadingItemStateById(states, "book_2")).toBeUndefined();
  });

  test("dedupes recommended book search results by real book id", () => {
    const results: SearchResult[] = [
      { bookId: "book_1", title: "可能性的艺术" },
      { bookId: " book_1 ", title: "可能性的艺术（重复）" },
      { bookId: "book_2", title: "选择的科学" },
      { bookId: "book_3", title: "行动心理学" },
    ];

    expect(dedupeRecommendedBookSearchResults(results, 2)).toEqual([
      { bookId: "book_1", title: "可能性的艺术" },
      { bookId: "book_2", title: "选择的科学" },
    ]);
  });

  test("builds local and confirmed candidate notes", () => {
    expect(buildAiRecommendationCandidateNote(recommendedBook)).toContain(
      "来自 AI 阅读助手推荐"
    );
    expect(buildConfirmedAiRecommendationCandidateNote(recommendedBook)).toContain(
      "已通过微信读书搜索确认"
    );
  });

  test("truncates confirmed candidate notes", () => {
    const longBook: ReadingAssistantRecommendedBook = {
      ...recommendedBook,
      reason: "理由".repeat(300),
      fit: "适合".repeat(300),
      risk: "风险".repeat(300),
    };

    expect(buildConfirmedAiRecommendationCandidateNote(longBook).length).toBeLessThanOrEqual(
      483
    );
  });
});
