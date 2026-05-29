import {
  createSourceItemKey,
  serializeSourceItemKey,
  type SourceItemKey
} from "./source-item-keys";
import type { SourceVersionPair } from "./source-version-matches";

export type ReadingAssetLinkPair = {
  id: string;
  assetId: string;
  local: SourceItemKey;
  weread: SourceItemKey;
  linkedBy: "user";
  createdAt: string;
};

type ReadingAssetLinkStorage = Pick<Storage, "getItem" | "setItem">;

const READING_ASSET_LINKS_STORAGE_KEY = "wxreadmaster.readingAssetLinks.v1";

export function createReadingAssetLinkPair(
  input: {
    local: SourceItemKey | undefined;
    weread: SourceItemKey | undefined;
    now?: string;
  }
): ReadingAssetLinkPair | undefined {
  const local = normalizeSourceKey(input.local, "local");
  const weread = normalizeSourceKey(input.weread, "weread");
  const createdAt = (input.now ?? new Date().toISOString()).trim();

  if (!local || !weread || !createdAt) {
    return undefined;
  }

  const pairKey = createStablePairKey(local, weread);
  if (!pairKey) {
    return undefined;
  }

  return {
    id: `reading-asset-link:${pairKey}`,
    assetId: `reading-asset:${pairKey}`,
    local,
    weread,
    linkedBy: "user",
    createdAt
  };
}

export function createReadingAssetLinkPairFromSourceVersionPair(
  pair: SourceVersionPair,
  now?: string
): ReadingAssetLinkPair | undefined {
  return createReadingAssetLinkPair({ local: pair.local, weread: pair.weread, now });
}

export function upsertReadingAssetLinkPair(
  links: ReadingAssetLinkPair[],
  link: ReadingAssetLinkPair | undefined
): ReadingAssetLinkPair[] {
  if (!link) {
    return normalizeReadingAssetLinkPairs(links);
  }

  const normalizedLinks = normalizeReadingAssetLinkPairs(links);
  return normalizedLinks.some((existing) => existing.id === link.id)
    ? normalizedLinks
    : [...normalizedLinks, link];
}

export function findReadingAssetLinkPair(
  links: ReadingAssetLinkPair[],
  pair: Pick<ReadingAssetLinkPair, "local" | "weread"> | undefined
): ReadingAssetLinkPair | undefined {
  if (!pair) {
    return undefined;
  }

  const target = createReadingAssetLinkPair({
    local: pair.local,
    weread: pair.weread,
    now: "1970-01-01T00:00:00.000Z"
  });

  if (!target) {
    return undefined;
  }

  return normalizeReadingAssetLinkPairs(links).find((link) => link.id === target.id);
}

export function setReadingAssetLinkPairLinked(
  links: ReadingAssetLinkPair[],
  pair: SourceVersionPair,
  shouldBeLinked: boolean
): ReadingAssetLinkPair[] | undefined {
  const link = createReadingAssetLinkPairFromSourceVersionPair(pair);
  if (!link) {
    return undefined;
  }

  return shouldBeLinked
    ? upsertReadingAssetLinkPair(links, link)
    : removeReadingAssetLinkPair(links, link);
}

export function removeReadingAssetLinkPair(
  links: ReadingAssetLinkPair[],
  pair: Pick<ReadingAssetLinkPair, "local" | "weread">
): ReadingAssetLinkPair[] {
  const target = createReadingAssetLinkPair({
    local: pair.local,
    weread: pair.weread,
    now: "1970-01-01T00:00:00.000Z"
  });

  if (!target) {
    return normalizeReadingAssetLinkPairs(links);
  }

  return normalizeReadingAssetLinkPairs(links).filter((link) => link.id !== target.id);
}

export function readReadingAssetLinks(
  storage: ReadingAssetLinkStorage | undefined
): ReadingAssetLinkPair[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(READING_ASSET_LINKS_STORAGE_KEY);
    return raw ? normalizeReadingAssetLinkPairs(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeReadingAssetLinks(
  storage: ReadingAssetLinkStorage | undefined,
  links: ReadingAssetLinkPair[]
): ReadingAssetLinkPair[] {
  const normalizedLinks = normalizeReadingAssetLinkPairs(links);

  if (!storage) {
    return normalizedLinks;
  }

  try {
    storage.setItem(READING_ASSET_LINKS_STORAGE_KEY, JSON.stringify(normalizedLinks));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免阻断用户继续阅读。
  }

  return normalizedLinks;
}

export function getReadingAssetLinkStorage(): ReadingAssetLinkStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function normalizeReadingAssetLinkPairs(value: unknown): ReadingAssetLinkPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const links: ReadingAssetLinkPair[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    const link = normalizeReadingAssetLinkPair(item);
    if (!link || seenIds.has(link.id)) {
      continue;
    }

    seenIds.add(link.id);
    links.push(link);
  }

  return links;
}

function normalizeReadingAssetLinkPair(value: unknown): ReadingAssetLinkPair | undefined {
  if (!isRecord(value) || value.linkedBy !== "user") {
    return undefined;
  }

  return createReadingAssetLinkPair({
    local: sourceKeyValue(value.local),
    weread: sourceKeyValue(value.weread),
    now: stringValue(value.createdAt)
  });
}

function normalizeSourceKey(
  value: SourceItemKey | undefined,
  expectedSource: SourceItemKey["source"]
): SourceItemKey | undefined {
  if (!value || value.source !== expectedSource) {
    return undefined;
  }

  return createSourceItemKey(expectedSource, value.sourceId);
}

function createStablePairKey(local: SourceItemKey, weread: SourceItemKey): string | undefined {
  const localKey = serializeSourceItemKey(local);
  const wereadKey = serializeSourceItemKey(weread);
  return localKey && wereadKey ? `${localKey}|${wereadKey}` : undefined;
}

function sourceKeyValue(value: unknown): SourceItemKey | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    source: value.source,
    sourceId: value.sourceId
  } as SourceItemKey;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
