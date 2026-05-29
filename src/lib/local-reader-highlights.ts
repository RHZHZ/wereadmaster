export type LocalReaderHighlightTone = "yellow" | "green" | "blue";

export type LocalReaderHighlight = {
  id: string;
  bookId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  tone: LocalReaderHighlightTone;
  createdAt: string;
};

export type LocalReaderHighlightSegment =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "highlight";
      text: string;
      highlight: LocalReaderHighlight;
    };

type HighlightStorage = Pick<Storage, "getItem" | "setItem">;

const HIGHLIGHT_STORAGE_KEY_PREFIX = "wxreadmaster.localReader.highlights.v1:";
const MAX_HIGHLIGHTS_PER_BOOK = 500;
const MAX_HIGHLIGHT_TEXT_LENGTH = 2000;

export function readLocalReaderHighlights(
  storage: HighlightStorage | undefined,
  bookId: string
): LocalReaderHighlight[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(highlightStorageKey(bookId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeHighlightList(parsed, bookId);
  } catch {
    return [];
  }
}

export function writeLocalReaderHighlights(
  storage: HighlightStorage | undefined,
  bookId: string,
  highlights: LocalReaderHighlight[]
): LocalReaderHighlight[] {
  const normalized = normalizeHighlightList(highlights, bookId);

  if (!storage) {
    return normalized;
  }

  try {
    storage.setItem(highlightStorageKey(bookId), JSON.stringify(normalized));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免打断阅读操作。
  }

  return normalized;
}

export function createLocalReaderHighlight(input: {
  bookId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  tone: LocalReaderHighlightTone;
  now?: string;
}): LocalReaderHighlight {
  return {
    id: createHighlightId(),
    bookId: input.bookId,
    text: input.text.trim().slice(0, MAX_HIGHLIGHT_TEXT_LENGTH),
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    tone: input.tone,
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function buildLocalReaderHighlightSegments(
  content: string,
  highlights: LocalReaderHighlight[]
): LocalReaderHighlightSegment[] {
  if (!content || highlights.length === 0) {
    return [{ kind: "text", text: content }];
  }

  const segments: LocalReaderHighlightSegment[] = [];
  const sortedHighlights = highlights
    .filter((highlight) => isValidOffsetRange(highlight.startOffset, highlight.endOffset, content.length))
    .sort((left, right) => left.startOffset - right.startOffset || left.createdAt.localeCompare(right.createdAt));
  let cursor = 0;

  for (const highlight of sortedHighlights) {
    if (highlight.startOffset < cursor) {
      continue;
    }

    if (highlight.startOffset > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, highlight.startOffset) });
    }

    segments.push({
      kind: "highlight",
      text: content.slice(highlight.startOffset, highlight.endOffset),
      highlight
    });
    cursor = highlight.endOffset;
  }

  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "text", text: content }];
}

export function hasLocalReaderHighlightOverlap(
  highlights: LocalReaderHighlight[],
  startOffset: number,
  endOffset: number
): boolean {
  return highlights.some(
    (highlight) => startOffset < highlight.endOffset && endOffset > highlight.startOffset
  );
}

export function normalizeLocalReaderSelectionRange(
  startOffset: number,
  endOffset: number,
  contentLength: number
): { startOffset: number; endOffset: number } | undefined {
  const start = Math.max(0, Math.min(startOffset, endOffset, contentLength));
  const end = Math.max(0, Math.min(Math.max(startOffset, endOffset), contentLength));

  if (!isValidOffsetRange(start, end, contentLength)) {
    return undefined;
  }

  return { startOffset: start, endOffset: end };
}

export function getLocalReaderHighlightStorage(): HighlightStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function highlightStorageKey(bookId: string): string {
  return `${HIGHLIGHT_STORAGE_KEY_PREFIX}${encodeURIComponent(bookId)}`;
}

function normalizeHighlightRecord(
  value: unknown,
  bookId: string
): LocalReaderHighlight | undefined {
  if (!isRecord(value) || value.bookId !== bookId) {
    return undefined;
  }

  const startOffset = numberValue(value.startOffset);
  const endOffset = numberValue(value.endOffset);
  const text = stringValue(value.text).trim();
  const tone = normalizeTone(value.tone);
  const id = stringValue(value.id).trim();
  const createdAt = stringValue(value.createdAt).trim();

  if (
    !id ||
    !text ||
    !createdAt ||
    !tone ||
    startOffset === undefined ||
    endOffset === undefined ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    return undefined;
  }

  return {
    id,
    bookId,
    text: text.slice(0, MAX_HIGHLIGHT_TEXT_LENGTH),
    startOffset,
    endOffset,
    tone,
    createdAt
  };
}

function normalizeHighlightList(value: unknown, bookId: string): LocalReaderHighlight[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueHighlights = new Map<string, LocalReaderHighlight>();
  for (const item of value) {
    const highlight = normalizeHighlightRecord(item, bookId);
    if (highlight) {
      uniqueHighlights.set(highlight.id, highlight);
    }
  }

  return Array.from(uniqueHighlights.values())
    .sort((left, right) => left.startOffset - right.startOffset || left.createdAt.localeCompare(right.createdAt))
    .slice(0, MAX_HIGHLIGHTS_PER_BOOK);
}

function isValidOffsetRange(startOffset: number, endOffset: number, contentLength: number): boolean {
  return startOffset >= 0 && endOffset > startOffset && endOffset <= contentLength;
}

function createHighlightId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `local-highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTone(value: unknown): LocalReaderHighlightTone | undefined {
  return value === "yellow" || value === "green" || value === "blue" ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
