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
