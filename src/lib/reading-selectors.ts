import { calculateTotalNotes } from "./business-rules";
import type {
  NotebookBook,
  ReadingItemOrganizeStatus,
  ReadingItemState
} from "./types";

export type OrganizeCandidate = {
  book: NotebookBook;
  source: "manual" | "suggested";
  reason: string;
};

type RankedOrganizeCandidate = OrganizeCandidate & {
  recentSignal: number;
};

const DEFAULT_ORGANIZE_QUEUE_LIMIT = 3;

export function getOrganizeQueue({
  items,
  notebooks,
  reviewedBookIds,
  limit = DEFAULT_ORGANIZE_QUEUE_LIMIT
}: {
  items: readonly ReadingItemState[];
  notebooks: readonly NotebookBook[];
  reviewedBookIds: ReadonlySet<string>;
  limit?: number;
}): OrganizeCandidate[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) {
    return [];
  }

  const itemByBookId = new Map<string, ReadingItemState>();
  for (const item of items) {
    const existing = itemByBookId.get(item.itemId);
    if (!existing || parseTimestamp(item.updatedAt) > parseTimestamp(existing.updatedAt)) {
      itemByBookId.set(item.itemId, item);
    }
  }

  const notebookByBookId = new Map(notebooks.map((book) => [book.bookId, book]));
  const candidateByBookId = new Map<string, RankedOrganizeCandidate>();

  for (const item of itemByBookId.values()) {
    if (resolveOrganizeStatus(item) !== "to_organize") {
      continue;
    }

    const notebook = notebookByBookId.get(item.itemId);
    candidateByBookId.set(item.itemId, {
      book: notebook ?? buildManualBookShell(item),
      source: "manual",
      reason: "手动标记待整理",
      recentSignal: notebook ? normalizeSortSignal(notebook.sort) : parseTimestamp(item.updatedAt)
    });
  }

  for (const book of notebooks) {
    if (candidateByBookId.has(book.bookId)) {
      continue;
    }

    const item = itemByBookId.get(book.bookId);
    if (
      calculateTotalNotes(book) <= 0 ||
      reviewedBookIds.has(book.bookId) ||
      (item && resolveOrganizeStatus(item) === "organized")
    ) {
      continue;
    }

    candidateByBookId.set(book.bookId, {
      book,
      source: "suggested",
      reason: "有可导出笔记但尚未生成书籍复盘",
      recentSignal: normalizeSortSignal(book.sort)
    });
  }

  return [...candidateByBookId.values()]
    .sort(compareOrganizeCandidates)
    .slice(0, normalizedLimit)
    .map(({ recentSignal: _recentSignal, ...candidate }) => candidate);
}

export function isCandidateQueueItem(item: ReadingItemState): boolean {
  if (item.isCandidate !== undefined) {
    return item.isCandidate;
  }

  return (
    item.status === "toRead" &&
    (item.itemType === "candidate" || item.itemType === "album" || item.itemType === "mp")
  );
}

export function getCandidateQueue(
  items: readonly ReadingItemState[],
  limit?: number
): ReadingItemState[] {
  const normalizedLimit = limit === undefined ? Number.POSITIVE_INFINITY : normalizeLimit(limit);
  if (normalizedLimit === 0) {
    return [];
  }

  const candidateById = new Map<string, ReadingItemState>();
  for (const item of items) {
    if (!isCandidateQueueItem(item)) {
      continue;
    }

    const existing = candidateById.get(item.itemId);
    if (!existing || compareCandidateItems(item, existing) < 0) {
      candidateById.set(item.itemId, item);
    }
  }

  return [...candidateById.values()].sort(compareCandidateItems).slice(0, normalizedLimit);
}

function resolveOrganizeStatus(item: ReadingItemState): ReadingItemOrganizeStatus {
  if (item.organizeStatus !== undefined) {
    return item.organizeStatus;
  }

  if (item.status === "reviewing") {
    return "to_organize";
  }

  if (item.status === "organized") {
    return "organized";
  }

  return "none";
}

function buildManualBookShell(item: ReadingItemState): NotebookBook {
  return {
    bookId: item.itemId,
    title: item.title || "未命名书籍",
    author: item.author,
    cover: item.cover,
    reviewCount: 0,
    noteCount: 0,
    bookmarkCount: 0,
    totalNoteCount: 0
  };
}

function compareOrganizeCandidates(
  left: RankedOrganizeCandidate,
  right: RankedOrganizeCandidate
): number {
  if (left.source !== right.source) {
    return left.source === "manual" ? -1 : 1;
  }

  const thoughtDelta = right.book.reviewCount - left.book.reviewCount;
  if (thoughtDelta !== 0) {
    return thoughtDelta;
  }

  const noteDelta = calculateTotalNotes(right.book) - calculateTotalNotes(left.book);
  if (noteDelta !== 0) {
    return noteDelta;
  }

  const recentDelta = right.recentSignal - left.recentSignal;
  if (recentDelta !== 0) {
    return recentDelta;
  }

  return left.book.bookId.localeCompare(right.book.bookId);
}

function compareCandidateItems(left: ReadingItemState, right: ReadingItemState): number {
  const updatedAtDelta = parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return left.itemId.localeCompare(right.itemId);
}

function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const dateValue = Date.parse(trimmed);
  return Number.isFinite(dateValue) ? dateValue : 0;
}

function normalizeSortSignal(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return limit > 0 ? Number.POSITIVE_INFINITY : 0;
  }

  return Math.max(0, Math.floor(limit));
}
