import type {
  ReadingAssistantRecommendedBook,
  ReadingItemState,
  SearchResult,
} from "./types";

export function findExistingCandidateState(
  states: ReadingItemState[],
  book: ReadingAssistantRecommendedBook
): ReadingItemState | undefined {
  const targetTitle = normalizeBookKey(book.title);
  const targetAuthor = normalizeBookKey(book.author);
  if (!targetTitle) {
    return undefined;
  }

  return states.find((state) => {
    if (state.itemType !== "candidate" || state.status !== "toRead") {
      return false;
    }

    const title = normalizeBookKey(state.title);
    if (title !== targetTitle) {
      return false;
    }

    const author = normalizeBookKey(state.author);
    return !targetAuthor || !author || author === targetAuthor;
  });
}

export function buildAiRecommendedCandidateId(book: ReadingAssistantRecommendedBook): string {
  return `ai-rec-${stableHash(recommendedBookKey(book))}`;
}

export function findExistingReadingItemStateById(
  states: ReadingItemState[],
  itemId: string
): ReadingItemState | undefined {
  const targetItemId = normalizeItemId(itemId);
  if (!targetItemId) {
    return undefined;
  }

  return states.find((state) => normalizeItemId(state.itemId) === targetItemId);
}

export function dedupeRecommendedBookSearchResults(
  results: SearchResult[],
  limit = 5
): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const bookId = normalizeItemId(result.bookId);
    if (!bookId || seen.has(bookId)) {
      continue;
    }

    seen.add(bookId);
    deduped.push(result);
    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

export function recommendedBookKey(book: ReadingAssistantRecommendedBook): string {
  return `${normalizeBookKey(book.title)}|${normalizeBookKey(book.author)}`;
}

export function buildRecommendedBookSearchKeyword(book: ReadingAssistantRecommendedBook): string {
  return [book.title, book.author].map((item) => item.trim()).filter(Boolean).join(" ");
}

export function buildAiRecommendationCandidateNote(book: ReadingAssistantRecommendedBook): string {
  return truncateNote(
    [`来自 AI 阅读助手推荐：${book.reason}`, `适合点：${book.fit}`, `风险：${book.risk}`]
      .filter((item) => item.trim())
      .join("\n")
  );
}

export function buildConfirmedAiRecommendationCandidateNote(
  book: ReadingAssistantRecommendedBook
): string {
  return truncateNote(`${buildAiRecommendationCandidateNote(book)}\n已通过微信读书搜索确认。`);
}

function normalizeBookKey(value?: string): string {
  return (value ?? "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function normalizeItemId(value?: string): string {
  return (value ?? "").trim();
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function truncateNote(value: string, maxLength = 480): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}
