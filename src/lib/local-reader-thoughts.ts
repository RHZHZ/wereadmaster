export type LocalReaderThought = {
  id: string;
  bookId: string;
  selectedText: string;
  note: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
};

type ThoughtStorage = Pick<Storage, "getItem" | "setItem">;

const THOUGHT_STORAGE_KEY_PREFIX = "wxreadmaster.localReader.thoughts.v1:";
const MAX_THOUGHTS_PER_BOOK = 500;
const MAX_SELECTED_TEXT_LENGTH = 2000;
const MAX_NOTE_TEXT_LENGTH = 1200;

export function readLocalReaderThoughts(
  storage: ThoughtStorage | undefined,
  bookId: string
): LocalReaderThought[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(thoughtStorageKey(bookId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeThoughtList(parsed, bookId);
  } catch {
    return [];
  }
}

export function writeLocalReaderThoughts(
  storage: ThoughtStorage | undefined,
  bookId: string,
  thoughts: LocalReaderThought[]
): LocalReaderThought[] {
  const normalized = normalizeThoughtList(thoughts, bookId);

  if (!storage) {
    return normalized;
  }

  try {
    storage.setItem(thoughtStorageKey(bookId), JSON.stringify(normalized));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免打断阅读操作。
  }

  return normalized;
}

export function createLocalReaderThought(input: {
  bookId: string;
  selectedText: string;
  note: string;
  startOffset: number;
  endOffset: number;
  now?: string;
}): LocalReaderThought {
  return {
    id: createThoughtId(),
    bookId: input.bookId,
    selectedText: input.selectedText.trim().slice(0, MAX_SELECTED_TEXT_LENGTH),
    note: input.note.trim().slice(0, MAX_NOTE_TEXT_LENGTH),
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function getLocalReaderThoughtStorage(): ThoughtStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function thoughtStorageKey(bookId: string): string {
  return `${THOUGHT_STORAGE_KEY_PREFIX}${encodeURIComponent(bookId)}`;
}

function normalizeThoughtRecord(
  value: unknown,
  bookId: string
): LocalReaderThought | undefined {
  if (!isRecord(value) || value.bookId !== bookId) {
    return undefined;
  }

  const id = stringValue(value.id).trim();
  const selectedText = stringValue(value.selectedText).trim();
  const note = stringValue(value.note).trim();
  const createdAt = stringValue(value.createdAt).trim();
  const startOffset = numberValue(value.startOffset);
  const endOffset = numberValue(value.endOffset);

  if (
    !id ||
    !selectedText ||
    !note ||
    !createdAt ||
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
    selectedText: selectedText.slice(0, MAX_SELECTED_TEXT_LENGTH),
    note: note.slice(0, MAX_NOTE_TEXT_LENGTH),
    startOffset,
    endOffset,
    createdAt
  };
}

function normalizeThoughtList(value: unknown, bookId: string): LocalReaderThought[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueThoughts = new Map<string, LocalReaderThought>();
  for (const item of value) {
    const thought = normalizeThoughtRecord(item, bookId);
    if (thought) {
      uniqueThoughts.set(thought.id, thought);
    }
  }

  return Array.from(uniqueThoughts.values())
    .sort((left, right) => left.startOffset - right.startOffset || left.createdAt.localeCompare(right.createdAt))
    .slice(0, MAX_THOUGHTS_PER_BOOK);
}

function createThoughtId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `local-thought-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
