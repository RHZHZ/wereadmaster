import type { LocalBook } from "./local-reader-types";
import type { ShelfEntry } from "./types";

export type SourceKind = "local" | "weread";

export type SourceItemKey = {
  source: SourceKind;
  sourceId: string;
};

export function createSourceItemKey(
  source: SourceKind,
  sourceId: string | undefined
): SourceItemKey | undefined {
  const normalizedSourceId = normalizeSourceId(sourceId);
  return normalizedSourceId ? { source, sourceId: normalizedSourceId } : undefined;
}

export function sourceItemKeyFromLocalBook(
  book: Pick<LocalBook, "id">
): SourceItemKey | undefined {
  return createSourceItemKey("local", book.id);
}

export function sourceItemKeyFromWereadEntry(
  entry: Pick<ShelfEntry, "id">
): SourceItemKey | undefined {
  return createSourceItemKey("weread", entry.id);
}

export function serializeSourceItemKey(key: SourceItemKey): string | undefined {
  const normalized = createSourceItemKey(key.source, key.sourceId);
  return normalized ? `${normalized.source}:${encodeURIComponent(normalized.sourceId)}` : undefined;
}

export function parseSourceItemKey(value: string): SourceItemKey | undefined {
  const [source, encodedSourceId, extra] = value.split(":");
  if (extra !== undefined || !isSourceKind(source)) {
    return undefined;
  }

  try {
    return createSourceItemKey(source, decodeURIComponent(encodedSourceId ?? ""));
  } catch {
    return undefined;
  }
}

export function areSourceItemKeysEqual(left: SourceItemKey, right: SourceItemKey): boolean {
  return left.source === right.source && left.sourceId === right.sourceId;
}

function normalizeSourceId(value: string | undefined): string {
  return (value ?? "").trim();
}

function isSourceKind(value: string | undefined): value is SourceKind {
  return value === "local" || value === "weread";
}
