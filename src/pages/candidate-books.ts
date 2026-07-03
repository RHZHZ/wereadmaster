import type {
  BookDecisionCandidateInput,
  ReadingItemState,
  ReadingItemStateType,
  SearchResult
} from "../lib/types";

export type LocalCandidateBook = SearchResult & {
  localType: ReadingItemStateType;
  localNote?: string;
};

export type CandidateSourceFilter = "all" | "confirmed" | "unconfirmed" | "light";

export type CandidateSourceStats = {
  total: number;
  confirmed: number;
  unconfirmed: number;
  light: number;
};

export type CandidateFilteredEmptyState = {
  title: string;
  description: string;
  canClearQuery: boolean;
  canShowAllSources: boolean;
};

export type CandidateReplacementResolution =
  | {
      status: "create";
      replacement: LocalCandidateBook;
    }
  | {
      status: "reuse";
      replacement: LocalCandidateBook;
    }
  | {
      status: "blocked";
    };

const AI_RECOMMENDED_CANDIDATE_PREFIX = "ai-rec-";
const AI_RECOMMENDATION_NOTE_MARKER = "来自 AI 阅读助手推荐";
const CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER = "已通过微信读书搜索确认";

export function isSavedCandidateState(state: ReadingItemState): boolean {
  return (
    state.status === "toRead" &&
    (state.itemType === "candidate" || state.itemType === "album" || state.itemType === "mp")
  );
}

export function mapCandidateStateToSearchResult(state: ReadingItemState): LocalCandidateBook {
  return {
    bookId: state.itemId,
    title: state.title || "未命名候选书",
    author: state.author,
    cover: state.cover,
    category: state.category,
    localType: state.itemType,
    localNote: state.note
  };
}

export function buildCandidateMap(states: ReadingItemState[]): Map<string, LocalCandidateBook> {
  return new Map(states.map((state) => [state.itemId, mapCandidateStateToSearchResult(state)]));
}

export function buildBookDecisionCandidates(books: SearchResult[]): BookDecisionCandidateInput[] {
  return books.slice(0, 8).map((book) => ({
    bookId: book.bookId,
    title: book.title,
    author: book.author,
    category: book.category,
    localStatus: "toRead"
  }));
}

export function buildCandidateSourceStats(books: LocalCandidateBook[]): CandidateSourceStats {
  return books.reduce<CandidateSourceStats>(
    (stats, book) => {
      const tone = getCandidateSourceTone(book);
      return {
        ...stats,
        total: stats.total + 1,
        [tone]: stats[tone] + 1
      };
    },
    { total: 0, confirmed: 0, unconfirmed: 0, light: 0 }
  );
}

export function filterCandidatesBySource(
  books: LocalCandidateBook[],
  sourceFilter: CandidateSourceFilter
): LocalCandidateBook[] {
  if (sourceFilter === "all") {
    return books;
  }

  return books.filter((book) => getCandidateSourceTone(book) === sourceFilter);
}

export function buildCandidateFilteredEmptyState({
  query,
  sourceFilter,
  sourceFilteredCount,
  visibleCount
}: {
  query: string;
  sourceFilter: CandidateSourceFilter;
  sourceFilteredCount: number;
  visibleCount: number;
}): CandidateFilteredEmptyState | undefined {
  if (visibleCount > 0) {
    return undefined;
  }

  const hasQuery = query.trim().length > 0;
  const hasSourceFilter = sourceFilter !== "all";

  if (hasQuery && hasSourceFilter) {
    return {
      title: sourceFilteredCount > 0 ? "当前筛选下没有匹配候选" : "当前筛选下没有候选书",
      description: "可以清空搜索，或切回全部候选继续浏览。",
      canClearQuery: true,
      canShowAllSources: true
    };
  }

  if (hasQuery) {
    return {
      title: "没有匹配的候选书",
      description: "换一个关键词，或清空搜索继续浏览。",
      canClearQuery: true,
      canShowAllSources: false
    };
  }

  if (hasSourceFilter) {
    return {
      title: "当前筛选下没有候选书",
      description: "切回全部候选继续浏览。",
      canClearQuery: false,
      canShowAllSources: true
    };
  }

  return {
    title: "没有可展示的候选书",
    description: "候选数据暂时不可见，可以稍后重试。",
    canClearQuery: false,
    canShowAllSources: false
  };
}

export function buildCandidateConfirmationSearchKeyword(book: LocalCandidateBook): string {
  return [book.title, book.author].map((item) => item?.trim() ?? "").filter(Boolean).join(" ");
}

export function buildConfirmedCandidateReplacementNote(book: LocalCandidateBook): string {
  const note = book.localNote?.trim();
  if (!note) {
    return `${CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER}。`;
  }

  if (note.includes(CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER)) {
    return truncateCandidateNote(note);
  }

  return truncateCandidateNote(`${note}\n${CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER}。`);
}

export function resolveCandidateReplacement(
  book: LocalCandidateBook,
  result: SearchResult,
  existingState?: ReadingItemState
): CandidateReplacementResolution {
  if (existingState && !(existingState.itemType === "candidate" && existingState.status === "toRead")) {
    return { status: "blocked" };
  }

  if (existingState) {
    return {
      status: "reuse",
      replacement: mapCandidateStateToSearchResult(existingState)
    };
  }

  return {
    status: "create",
    replacement: {
      ...result,
      localType: "candidate",
      localNote: buildConfirmedCandidateReplacementNote(book)
    }
  };
}

export function isUnconfirmedAiCandidate(book: LocalCandidateBook): boolean {
  return (
    book.localType === "candidate" &&
    (book.bookId.startsWith(AI_RECOMMENDED_CANDIDATE_PREFIX) ||
      (book.localNote?.includes(AI_RECOMMENDATION_NOTE_MARKER) === true &&
        book.localNote.includes(CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER) === false))
  );
}

export function canOpenCandidateDetail(book: LocalCandidateBook): boolean {
  return book.localType === "candidate" && !isUnconfirmedAiCandidate(book);
}

export function getCandidateSourceLabel(book: LocalCandidateBook): string {
  if (book.localType === "album") {
    return "有声书 · 轻管理候选";
  }

  if (book.localType === "mp") {
    return "文章收藏 · 轻管理候选";
  }

  if (isUnconfirmedAiCandidate(book)) {
    return "AI 推荐 · 未确认书源";
  }

  if (book.localNote?.includes(CONFIRMED_AI_RECOMMENDATION_NOTE_MARKER)) {
    return "AI 推荐 · 微信读书已确认";
  }

  return "微信读书书目 · 本机候选";
}

export function getCandidateSourceTone(book: LocalCandidateBook): "confirmed" | "unconfirmed" | "light" {
  if (book.localType === "album" || book.localType === "mp") {
    return "light";
  }

  return isUnconfirmedAiCandidate(book) ? "unconfirmed" : "confirmed";
}

function truncateCandidateNote(value: string, maxLength = 480): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}
