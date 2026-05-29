import type { LocalBook } from "./local-reader-types";
import {
  sourceItemKeyFromLocalBook,
  sourceItemKeyFromWereadEntry,
  type SourceItemKey
} from "./source-item-keys";
import type { ShelfEntry } from "./types";

export type SourceVersionPair = {
  local: SourceItemKey;
  weread: SourceItemKey;
  matchBy: "title-author";
};

export function findLikelyWereadBookMatch(
  book: Pick<LocalBook, "title" | "author">,
  entries: ShelfEntry[]
): ShelfEntry | undefined {
  return findBestLikelyBookMatch(
    book,
    entries.filter((entry) => entry.type === "book")
  );
}

export function findLikelyLocalBookMatch(
  entry: Pick<ShelfEntry, "type" | "title" | "author">,
  books: LocalBook[]
): LocalBook | undefined {
  if (entry.type !== "book") {
    return undefined;
  }

  return findBestLikelyBookMatch(entry, books);
}

export function buildLikelySourceVersionPair(
  localBook: Pick<LocalBook, "id" | "title" | "author">,
  wereadEntry: Pick<ShelfEntry, "id" | "type" | "title" | "author">
): SourceVersionPair | undefined {
  if (
    wereadEntry.type !== "book" ||
    !isLikelySameBook(localBook.title, localBook.author, wereadEntry.title, wereadEntry.author)
  ) {
    return undefined;
  }

  const local = sourceItemKeyFromLocalBook(localBook);
  const weread = sourceItemKeyFromWereadEntry(wereadEntry);
  return local && weread ? { local, weread, matchBy: "title-author" } : undefined;
}

function isLikelySameBook(
  localTitle: string | undefined,
  localAuthor: string | undefined,
  remoteTitle: string | undefined,
  remoteAuthor: string | undefined
): boolean {
  const normalizedLocalTitle = normalizeComparableBookText(localTitle);
  const normalizedRemoteTitle = normalizeComparableBookText(remoteTitle);
  if (!normalizedLocalTitle || normalizedLocalTitle !== normalizedRemoteTitle) {
    return false;
  }

  const normalizedLocalAuthor = normalizeComparableBookText(localAuthor);
  const normalizedRemoteAuthor = normalizeComparableBookText(remoteAuthor);
  return !normalizedLocalAuthor || !normalizedRemoteAuthor || normalizedLocalAuthor === normalizedRemoteAuthor;
}

function findBestLikelyBookMatch<T extends { title?: string; author?: string }>(
  source: { title?: string; author?: string },
  candidates: T[]
): T | undefined {
  const normalizedSourceTitle = normalizeComparableBookText(source.title);
  if (!normalizedSourceTitle) {
    return undefined;
  }

  const normalizedSourceAuthor = normalizeComparableBookText(source.author);
  const titleMatches = candidates.filter(
    (candidate) => normalizeComparableBookText(candidate.title) === normalizedSourceTitle
  );
  if (titleMatches.length === 0) {
    return undefined;
  }

  if (normalizedSourceAuthor) {
    const exactAuthorMatches = titleMatches.filter(
      (candidate) => normalizeComparableBookText(candidate.author) === normalizedSourceAuthor
    );
    if (exactAuthorMatches.length === 1) {
      return exactAuthorMatches[0];
    }

    if (exactAuthorMatches.length > 1) {
      return undefined;
    }

    if (titleMatches.some((candidate) => normalizeComparableBookText(candidate.author))) {
      return undefined;
    }
  }

  const nonConflictingMatches = titleMatches.filter((candidate) => {
    const normalizedCandidateAuthor = normalizeComparableBookText(candidate.author);
    return !normalizedSourceAuthor || !normalizedCandidateAuthor;
  });
  return nonConflictingMatches.length === 1 ? nonConflictingMatches[0] : undefined;
}

function normalizeComparableBookText(value?: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[《》「」『』]/g, "")
    .replace(/\s+/g, "");
}
