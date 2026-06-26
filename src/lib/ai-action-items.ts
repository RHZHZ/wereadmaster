export type AiActionItemStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;
export type AiActionFeedbackStatus = "todo" | "completed" | "skipped" | "notApplicable";
export type AiActionFeedbackRecord = {
  status: AiActionFeedbackStatus;
  note?: string;
  updatedAt: string;
};
export type AiActionFeedbackByItemId = Record<string, AiActionFeedbackRecord>;
export type AiReviewFeedbackState = {
  actionItems: AiActionFeedbackByItemId;
  reflectionQuestions: AiActionFeedbackByItemId;
};
export type AiActionFeedbackSummary = Record<AiActionFeedbackStatus, number> & {
  total: number;
  withNote: number;
};

const AI_ACTION_ITEM_STORAGE_PREFIX = "wxreadmaster.aiActionItems.v1";
const AI_ASSET_ACTION_ITEM_STORAGE_PREFIX = "wxreadmaster.aiAssetActionItems.v1";
const AI_REFLECTION_QUESTION_STORAGE_PREFIX = "wxreadmaster.aiReflectionQuestions.v1";
const AI_REVIEW_FEEDBACK_STORAGE_PREFIX = "wxreadmaster.aiReviewFeedback.v1";
const AI_ACTION_FEEDBACK_NOTE_MAX_LENGTH = 500;
const LEGACY_ACTION_FEEDBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export function buildAiActionItemStateKey(bookId: string, inputHash: string): string {
  return `${AI_ACTION_ITEM_STORAGE_PREFIX}:${bookId}:${inputHash}`;
}

export function buildAiActionItemId(text: string, index: number): string {
  return `${index}:${normalizeActionItemText(text)}`;
}

export function buildAiReflectionQuestionStateKey(bookId: string, inputHash: string): string {
  return `${AI_REFLECTION_QUESTION_STORAGE_PREFIX}:${bookId}:${inputHash}`;
}

export function buildAiReflectionQuestionId(text: string, index: number): string {
  return `${index}:${normalizeActionItemText(text)}`;
}

export function buildAiReviewFeedbackStateKey(bookId: string, inputHash: string): string {
  return `${AI_REVIEW_FEEDBACK_STORAGE_PREFIX}:${bookId}:${inputHash}`;
}

export function buildAiAssetActionItemStateKey(feature: string, scopeId: string, inputHash: string): string {
  return `${AI_ASSET_ACTION_ITEM_STORAGE_PREFIX}:${feature}:${scopeId}:${inputHash}`;
}

export function buildAiAssetActionItemMatchKey(text: string): string {
  const normalized = normalizeActionItemText(text);
  const sentenceHead = normalized.split(/[，,。；;：:！!？?]/)[0]?.trim() ?? normalized;
  const primaryClause = sentenceHead.split(/并(?=[\u4e00-\u9fa5]{1,12})/)[0]?.trim() ?? sentenceHead;
  return primaryClause.replace(/\s+/g, "");
}

export function readAiActionItemState(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string
): Set<string> {
  return getCompletedAiActionItemIds(readAiActionItemFeedback(storage, bookId, inputHash));
}

export function writeAiActionItemState(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string,
  completedItemIds: Set<string>
): void {
  writeAiActionItemFeedback(storage, bookId, inputHash, feedbackFromCompletedIds(completedItemIds));
}

export function readAiActionItemFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string
): AiActionFeedbackByItemId {
  if (!storage) {
    return {};
  }

  return readFeedbackByKey(storage, buildAiActionItemStateKey(bookId, inputHash)).feedbackByItemId;
}

export function writeAiActionItemFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string,
  feedbackByItemId: AiActionFeedbackByItemId
): void {
  try {
    const nextFeedback = compactFeedbackByItemId(feedbackByItemId);
    storage?.setItem(
      buildAiActionItemStateKey(bookId, inputHash),
      JSON.stringify(buildPersistedActionFeedback(nextFeedback))
    );
  } catch {
    // 本地状态是增强能力，存储失败不应阻断复盘页操作。
  }
}

export function readAiReflectionQuestionFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string
): AiActionFeedbackByItemId {
  if (!storage) {
    return {};
  }

  return readFeedbackByKey(storage, buildAiReflectionQuestionStateKey(bookId, inputHash)).feedbackByItemId;
}

export function writeAiReflectionQuestionFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string,
  feedbackByQuestionId: AiActionFeedbackByItemId
): void {
  try {
    const nextFeedback = compactFeedbackByItemId(feedbackByQuestionId);
    storage?.setItem(
      buildAiReflectionQuestionStateKey(bookId, inputHash),
      JSON.stringify(buildPersistedActionFeedback(nextFeedback))
    );
  } catch {
    // 本地状态是增强能力，存储失败不应阻断复盘页操作。
  }
}

export function readAiReviewFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string
): AiReviewFeedbackState {
  if (!storage) {
    return createEmptyAiReviewFeedbackState();
  }

  const stored = readReviewFeedbackByKey(storage, buildAiReviewFeedbackStateKey(bookId, inputHash));
  if (stored.hasReadableState) {
    return stored.feedback;
  }

  return {
    actionItems: readAiActionItemFeedback(storage, bookId, inputHash),
    reflectionQuestions: readAiReflectionQuestionFeedback(storage, bookId, inputHash)
  };
}

export function hasAiReviewFeedback(feedback: AiReviewFeedbackState): boolean {
  return Object.keys(feedback.actionItems).length > 0 || Object.keys(feedback.reflectionQuestions).length > 0;
}

export function writeAiReviewFeedback(
  storage: AiActionItemStorage | undefined,
  bookId: string,
  inputHash: string,
  feedback: AiReviewFeedbackState
): void {
  try {
    storage?.setItem(
      buildAiReviewFeedbackStateKey(bookId, inputHash),
      JSON.stringify({
        actionItems: buildPersistedActionFeedback(compactFeedbackByItemId(feedback.actionItems)),
        reflectionQuestions: buildPersistedActionFeedback(compactFeedbackByItemId(feedback.reflectionQuestions))
      })
    );
  } catch {
    // 本地复盘反馈是增强状态，写入失败不应阻断页面主流程。
  }
}

export function readAiAssetActionItemState(
  storage: AiActionItemStorage | undefined,
  feature: string,
  scopeId: string,
  inputHash: string
): Set<string> {
  return getCompletedAiActionItemIds(readAiAssetActionItemFeedback(storage, feature, scopeId, inputHash));
}

export function writeAiAssetActionItemState(
  storage: AiActionItemStorage | undefined,
  feature: string,
  scopeId: string,
  inputHash: string,
  completedItemIds: Set<string>
): void {
  writeAiAssetActionItemFeedback(storage, feature, scopeId, inputHash, feedbackFromCompletedIds(completedItemIds));
}

export function readAiAssetActionItemFeedback(
  storage: AiActionItemStorage | undefined,
  feature: string,
  scopeId: string,
  inputHash: string
): AiActionFeedbackByItemId {
  if (!storage) {
    return {};
  }

  const exact = readExactAiAssetActionItemFeedback(storage, feature, scopeId, inputHash);
  if (exact.hasReadableState) {
    return exact.feedbackByItemId;
  }

  try {
    const prefix = `${AI_ASSET_ACTION_ITEM_STORAGE_PREFIX}:${feature}:${scopeId}:`;
    const fallback: AiActionFeedbackByItemId = {};
    const exactKey = buildAiAssetActionItemStateKey(feature, scopeId, inputHash);

    for (let index = 0; index < storageLength(storage); index += 1) {
      const key = readStorageKey(storage, index);
      if (!key || !key.startsWith(prefix) || key === exactKey) {
        continue;
      }

      mergeFeedbackByItemId(fallback, readFeedbackByKey(storage, key).feedbackByItemId);
    }

    return fallback;
  } catch {
    return {};
  }
}

export function readExactAiAssetActionItemFeedback(
  storage: AiActionItemStorage | undefined,
  feature: string,
  scopeId: string,
  inputHash: string
): { feedbackByItemId: AiActionFeedbackByItemId; hasReadableState: boolean } {
  if (!storage) {
    return { feedbackByItemId: {}, hasReadableState: false };
  }

  return readFeedbackByKey(storage, buildAiAssetActionItemStateKey(feature, scopeId, inputHash));
}

export function writeAiAssetActionItemFeedback(
  storage: AiActionItemStorage | undefined,
  feature: string,
  scopeId: string,
  inputHash: string,
  feedbackByMatchKey: AiActionFeedbackByItemId
): void {
  try {
    const nextFeedback = compactFeedbackByItemId(feedbackByMatchKey);
    storage?.setItem(
      buildAiAssetActionItemStateKey(feature, scopeId, inputHash),
      JSON.stringify(buildPersistedActionFeedback(nextFeedback))
    );
  } catch {
    // 本地增强状态，写入失败不应阻断页面主流程。
  }
}

export function deriveCompletedAiAssetActionItemIds(
  items: string[],
  reusableCompletedMatchKeys: Set<string>
): Set<string> {
  const completedItemIds = new Set<string>();

  items.forEach((item, index) => {
    if (reusableCompletedMatchKeys.has(buildAiAssetActionItemMatchKey(item))) {
      completedItemIds.add(buildAiActionItemId(item, index));
    }
  });

  return completedItemIds;
}

export function deriveAiAssetCompletedMatchKeys(items: string[], completedItemIds: Set<string>): Set<string> {
  const reusableMatchKeys = new Set<string>();

  items.forEach((item, index) => {
    if (completedItemIds.has(buildAiActionItemId(item, index))) {
      reusableMatchKeys.add(buildAiAssetActionItemMatchKey(item));
    }
  });

  return reusableMatchKeys;
}

export function deriveAiAssetActionItemFeedback(
  items: string[],
  reusableFeedbackByMatchKey: AiActionFeedbackByItemId
): AiActionFeedbackByItemId {
  const feedbackByItemId: AiActionFeedbackByItemId = {};

  items.forEach((item, index) => {
    const reusableFeedback = reusableFeedbackByMatchKey[buildAiAssetActionItemMatchKey(item)];
    if (reusableFeedback) {
      feedbackByItemId[buildAiActionItemId(item, index)] = reusableFeedback;
    }
  });

  return feedbackByItemId;
}

export function deriveAiAssetActionFeedbackMatchKeys(
  items: string[],
  feedbackByItemId: AiActionFeedbackByItemId
): AiActionFeedbackByItemId {
  const reusableFeedbackByMatchKey: AiActionFeedbackByItemId = {};

  items.forEach((item, index) => {
    const feedback = feedbackByItemId[buildAiActionItemId(item, index)];
    if (feedback) {
      reusableFeedbackByMatchKey[buildAiAssetActionItemMatchKey(item)] = feedback;
    }
  });

  return reusableFeedbackByMatchKey;
}

export function createAiActionFeedbackRecord(
  status: AiActionFeedbackStatus,
  note = "",
  updatedAt = new Date().toISOString()
): AiActionFeedbackRecord {
  const normalizedNote = normalizeAiActionFeedbackNote(note);
  return {
    status,
    ...(normalizedNote ? { note: normalizedNote } : {}),
    updatedAt
  };
}

export function normalizeAiActionFeedbackNote(note: string): string {
  return note
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, AI_ACTION_FEEDBACK_NOTE_MAX_LENGTH);
}

export function getCompletedAiActionItemIds(feedbackByItemId: AiActionFeedbackByItemId): Set<string> {
  return new Set(
    Object.entries(feedbackByItemId)
      .filter(([, feedback]) => feedback.status === "completed")
      .map(([itemId]) => itemId)
  );
}

export function summarizeAiActionFeedback(
  itemIds: string[],
  feedbackByItemId: AiActionFeedbackByItemId
): AiActionFeedbackSummary {
  return itemIds.reduce<AiActionFeedbackSummary>(
    (summary, itemId) => {
      const feedback = feedbackByItemId[itemId];
      const status = feedback?.status ?? "todo";

      return {
        ...summary,
        [status]: summary[status] + 1,
        total: summary.total + 1,
        withNote: feedback?.note ? summary.withNote + 1 : summary.withNote
      };
    },
    {
      total: 0,
      todo: 0,
      completed: 0,
      skipped: 0,
      notApplicable: 0,
      withNote: 0
    }
  );
}

export function getAiActionItemStorage(): AiActionItemStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function normalizeActionItemText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFeedbackByKey(
  storage: AiActionItemStorage,
  key: string
): { feedbackByItemId: AiActionFeedbackByItemId; hasReadableState: boolean } {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return { feedbackByItemId: {}, hasReadableState: false };
    }

    const parsed = raw ? JSON.parse(raw) : undefined;

    if (!isRecord(parsed)) {
      return { feedbackByItemId: {}, hasReadableState: false };
    }

    return readPersistedActionFeedback(parsed);
  } catch {
    return { feedbackByItemId: {}, hasReadableState: false };
  }
}

function readReviewFeedbackByKey(
  storage: AiActionItemStorage,
  key: string
): { feedback: AiReviewFeedbackState; hasReadableState: boolean } {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return { feedback: createEmptyAiReviewFeedbackState(), hasReadableState: false };
    }

    const parsed = raw ? JSON.parse(raw) : undefined;
    if (!isRecord(parsed)) {
      return { feedback: createEmptyAiReviewFeedbackState(), hasReadableState: false };
    }

    const actionItems = readPersistedActionFeedback(parsed.actionItems);
    const reflectionQuestions = readPersistedActionFeedback(parsed.reflectionQuestions);

    return {
      feedback: {
        actionItems: actionItems.feedbackByItemId,
        reflectionQuestions: reflectionQuestions.feedbackByItemId
      },
      hasReadableState: actionItems.hasReadableState || reflectionQuestions.hasReadableState
    };
  } catch {
    return { feedback: createEmptyAiReviewFeedbackState(), hasReadableState: false };
  }
}

function readPersistedActionFeedback(value: unknown): {
  feedbackByItemId: AiActionFeedbackByItemId;
  hasReadableState: boolean;
} {
  if (!isRecord(value)) {
    return { feedbackByItemId: {}, hasReadableState: false };
  }

  const feedbackByItemId = readFeedbackMap(value.feedbackByItemId);

  if (Array.isArray(value.completedItemIds)) {
    for (const itemId of value.completedItemIds) {
      if (typeof itemId === "string" && !feedbackByItemId[itemId]) {
        feedbackByItemId[itemId] = createAiActionFeedbackRecord("completed", "", LEGACY_ACTION_FEEDBACK_UPDATED_AT);
      }
    }
  }

  return {
    feedbackByItemId,
    hasReadableState: "feedbackByItemId" in value || "completedItemIds" in value
  };
}

function readFeedbackMap(value: unknown): AiActionFeedbackByItemId {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<AiActionFeedbackByItemId>((feedbackByItemId, [itemId, feedback]) => {
    if (typeof itemId !== "string") {
      return feedbackByItemId;
    }

    const nextFeedback = readFeedbackRecord(feedback);
    if (nextFeedback) {
      feedbackByItemId[itemId] = nextFeedback;
    }

    return feedbackByItemId;
  }, {});
}

function readFeedbackRecord(value: unknown): AiActionFeedbackRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = readFeedbackStatus(value.status);
  if (!status) {
    return undefined;
  }

  const note = typeof value.note === "string" ? normalizeAiActionFeedbackNote(value.note) : "";
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim()
      ? value.updatedAt
      : LEGACY_ACTION_FEEDBACK_UPDATED_AT;

  return {
    status,
    ...(note ? { note } : {}),
    updatedAt
  };
}

function readFeedbackStatus(value: unknown): AiActionFeedbackStatus | undefined {
  if (value === "todo" || value === "completed" || value === "skipped" || value === "notApplicable") {
    return value;
  }

  return undefined;
}

function feedbackFromCompletedIds(completedItemIds: Set<string>): AiActionFeedbackByItemId {
  const feedbackByItemId: AiActionFeedbackByItemId = {};

  for (const itemId of completedItemIds) {
    feedbackByItemId[itemId] = createAiActionFeedbackRecord("completed", "", LEGACY_ACTION_FEEDBACK_UPDATED_AT);
  }

  return feedbackByItemId;
}

function compactFeedbackByItemId(feedbackByItemId: AiActionFeedbackByItemId): AiActionFeedbackByItemId {
  return Object.keys(feedbackByItemId)
    .sort()
    .reduce<AiActionFeedbackByItemId>((nextFeedbackByItemId, itemId) => {
      const feedback = readFeedbackRecord(feedbackByItemId[itemId]);
      if (!feedback || (feedback.status === "todo" && !feedback.note)) {
        return nextFeedbackByItemId;
      }

      nextFeedbackByItemId[itemId] = feedback;
      return nextFeedbackByItemId;
    }, {});
}

function buildPersistedActionFeedback(feedbackByItemId: AiActionFeedbackByItemId) {
  return {
    feedbackByItemId,
    completedItemIds: Array.from(getCompletedAiActionItemIds(feedbackByItemId)).sort()
  };
}

function mergeFeedbackByItemId(target: AiActionFeedbackByItemId, source: AiActionFeedbackByItemId): void {
  for (const [itemId, feedback] of Object.entries(source)) {
    const current = target[itemId];
    if (!current || feedbackUpdatedAtValue(feedback) >= feedbackUpdatedAtValue(current)) {
      target[itemId] = feedback;
    }
  }
}

function feedbackUpdatedAtValue(feedback: AiActionFeedbackRecord): number {
  const parsed = Date.parse(feedback.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function storageLength(storage: AiActionItemStorage): number {
  const candidate = storage as Storage;
  return typeof candidate.length === "number" ? candidate.length : 0;
}

function readStorageKey(storage: AiActionItemStorage, index: number): string | null {
  const candidate = storage as Storage;
  return typeof candidate.key === "function" ? candidate.key(index) : null;
}

function createEmptyAiReviewFeedbackState(): AiReviewFeedbackState {
  return {
    actionItems: {},
    reflectionQuestions: {}
  };
}
