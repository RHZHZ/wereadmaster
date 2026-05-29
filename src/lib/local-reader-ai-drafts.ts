export type LocalReaderAiQuestionDraft = {
  bookId: string;
  question: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
};

export type LocalReaderAiQuestionRecordStatus = "draft" | "pending" | "answered" | "failed";

export type LocalReaderAiQuestionRecordAnswer = {
  answer: string;
  keyPoints: string[];
  followUpQuestions: string[];
  generatedAt: string;
  promptVersion: string;
  responseFormat?: "json_schema" | "json_object";
  basisNotice: string;
  providerModel?: string;
  inputHash?: string;
};

export type LocalReaderAiQuestionThreadTurn = {
  id: string;
  question: string;
  status: LocalReaderAiQuestionRecordStatus;
  createdAt: string;
  updatedAt: string;
  answer?: LocalReaderAiQuestionRecordAnswer;
  errorMessage?: string;
};

export type LocalReaderAiQuestionRecord = LocalReaderAiQuestionDraft & {
  id: string;
  source: "local";
  status: LocalReaderAiQuestionRecordStatus;
  updatedAt: string;
  answer?: LocalReaderAiQuestionRecordAnswer;
  errorMessage?: string;
  thread?: LocalReaderAiQuestionThreadTurn[];
};

type AiQuestionDraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const AI_QUESTION_DRAFT_STORAGE_KEY_PREFIX = "wxreadmaster.localReader.aiQuestionDraft.v1:";
const AI_QUESTION_RECORD_STORAGE_KEY_PREFIX = "wxreadmaster.localReader.aiQuestionRecords.v1:";
const MAX_SELECTED_TEXT_LENGTH = 2000;
const MAX_QUESTION_TEXT_LENGTH = 600;
const MAX_ANSWER_TEXT_LENGTH = 8000;
const MAX_LIST_ITEM_TEXT_LENGTH = 500;
const MAX_KEY_POINTS = 8;
const MAX_FOLLOW_UPS = 6;
const MAX_THREAD_TURNS = 12;

export function readLocalReaderAiQuestionDraft(
  storage: AiQuestionDraftStorage | undefined,
  bookId: string
): LocalReaderAiQuestionDraft | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(aiQuestionDraftStorageKey(bookId));
    return raw ? normalizeAiQuestionDraftRecord(JSON.parse(raw), bookId) : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalReaderAiQuestionDraft(
  storage: AiQuestionDraftStorage | undefined,
  bookId: string,
  draft: LocalReaderAiQuestionDraft
): LocalReaderAiQuestionDraft | undefined {
  const normalized = normalizeAiQuestionDraftRecord(draft, bookId);
  if (!normalized) {
    return undefined;
  }

  if (!storage) {
    return normalized;
  }

  try {
    storage.setItem(aiQuestionDraftStorageKey(bookId), JSON.stringify(normalized));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免打断阅读操作。
  }

  return normalized;
}

export function clearLocalReaderAiQuestionDraft(
  storage: AiQuestionDraftStorage | undefined,
  bookId: string
) {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(aiQuestionDraftStorageKey(bookId));
  } catch {
    // localStorage 清理失败不影响当前页面内存态。
  }
}

export function readLocalReaderAiQuestionRecords(
  storage: AiQuestionDraftStorage | undefined,
  bookId: string
): LocalReaderAiQuestionRecord[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(aiQuestionRecordStorageKey(bookId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizeAiQuestionRecordList(parsed, bookId);
      }
    }
  } catch {
    // 记录列表损坏时继续尝试读取旧草稿，避免一次坏数据吞掉迁移兜底。
  }

  const legacyDraft = readLocalReaderAiQuestionDraft(storage, bookId);
  return legacyDraft ? [createLocalReaderAiQuestionRecord({ ...legacyDraft, id: legacyAiRecordId(legacyDraft) })] : [];
}

export function writeLocalReaderAiQuestionRecords(
  storage: AiQuestionDraftStorage | undefined,
  bookId: string,
  records: LocalReaderAiQuestionRecord[]
): LocalReaderAiQuestionRecord[] {
  const normalized = normalizeAiQuestionRecordList(records, bookId);
  if (!storage) {
    return normalized;
  }

  try {
    storage.setItem(aiQuestionRecordStorageKey(bookId), JSON.stringify(normalized));
  } catch {
    // localStorage 写入失败时仍返回内存态，避免打断阅读操作。
  }

  return normalized;
}

export function createLocalReaderAiQuestionRecord(input: {
  bookId: string;
  question: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  now?: string;
  id?: string;
  status?: LocalReaderAiQuestionRecordStatus;
  answer?: LocalReaderAiQuestionRecordAnswer;
  errorMessage?: string;
}): LocalReaderAiQuestionRecord {
  const draft = createLocalReaderAiQuestionDraft(input);
  const id = input.id ?? createAiQuestionRecordId(draft);

  return {
    ...draft,
    id,
    source: "local",
    status: input.status ?? "draft",
    updatedAt: input.now ?? draft.createdAt,
    ...(input.answer ? { answer: input.answer } : {}),
    ...(input.errorMessage?.trim() ? { errorMessage: input.errorMessage.trim() } : {})
  };
}

export function createLocalReaderAiQuestionThreadTurn(input: {
  question: string;
  now?: string;
  id?: string;
  status?: LocalReaderAiQuestionRecordStatus;
  answer?: LocalReaderAiQuestionRecordAnswer;
  errorMessage?: string;
}): LocalReaderAiQuestionThreadTurn {
  const createdAt = input.now ?? new Date().toISOString();
  const question = input.question.trim().slice(0, MAX_QUESTION_TEXT_LENGTH);
  const answer = normalizeAiQuestionAnswer(input.answer);
  const status = normalizeAiQuestionRecordStatus(input.status, answer);
  const id = input.id ?? createAiQuestionThreadTurnId(question, createdAt);

  return {
    id,
    question,
    status,
    createdAt,
    updatedAt: createdAt,
    ...(answer ? { answer } : {}),
    ...(status === "failed" && input.errorMessage?.trim()
      ? { errorMessage: input.errorMessage.trim().slice(0, 1000) }
      : {})
  };
}

export function upsertLocalReaderAiQuestionRecord(
  records: LocalReaderAiQuestionRecord[],
  bookId: string,
  record: LocalReaderAiQuestionRecord
): LocalReaderAiQuestionRecord[] {
  const normalizedRecord = normalizeAiQuestionRecord(record, bookId);
  if (!normalizedRecord) {
    return normalizeAiQuestionRecordList(records, bookId);
  }

  let hasExisting = false;
  const nextRecords = records.map((item) => {
    if (item.id !== normalizedRecord.id) {
      return item;
    }

    hasExisting = true;
    return normalizedRecord;
  });

  if (!hasExisting) {
    nextRecords.unshift(normalizedRecord);
  }

  return normalizeAiQuestionRecordList(nextRecords, bookId);
}

export function upsertLocalReaderAiQuestionThreadTurn(
  records: LocalReaderAiQuestionRecord[],
  bookId: string,
  recordId: string,
  turn: LocalReaderAiQuestionThreadTurn
): LocalReaderAiQuestionRecord[] {
  const normalizedRecords = normalizeAiQuestionRecordList(records, bookId);
  const parentRecord = normalizedRecords.find((record) => record.id === recordId);
  const normalizedTurn = normalizeAiQuestionThreadTurn(turn);

  if (!parentRecord || !normalizedTurn) {
    return normalizedRecords;
  }

  const nextRecord: LocalReaderAiQuestionRecord = {
    ...parentRecord,
    updatedAt: normalizedTurn.updatedAt,
    thread: upsertAiQuestionThreadTurn(parentRecord.thread ?? [], normalizedTurn)
  };

  return upsertLocalReaderAiQuestionRecord(normalizedRecords, bookId, nextRecord);
}

export function removeLocalReaderAiQuestionRecord(
  records: LocalReaderAiQuestionRecord[],
  recordId: string
): LocalReaderAiQuestionRecord[] {
  return records.filter((record) => record.id !== recordId);
}

export function createLocalReaderAiQuestionDraft(input: {
  bookId: string;
  question: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  now?: string;
}): LocalReaderAiQuestionDraft {
  return {
    bookId: input.bookId,
    question: input.question.trim().slice(0, MAX_QUESTION_TEXT_LENGTH),
    selectedText: input.selectedText.trim().slice(0, MAX_SELECTED_TEXT_LENGTH),
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function getLocalReaderAiQuestionDraftStorage(): AiQuestionDraftStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function aiQuestionDraftStorageKey(bookId: string): string {
  return `${AI_QUESTION_DRAFT_STORAGE_KEY_PREFIX}${encodeURIComponent(bookId)}`;
}

function aiQuestionRecordStorageKey(bookId: string): string {
  return `${AI_QUESTION_RECORD_STORAGE_KEY_PREFIX}${encodeURIComponent(bookId)}`;
}

function normalizeAiQuestionDraftRecord(
  value: unknown,
  bookId: string
): LocalReaderAiQuestionDraft | undefined {
  if (!isRecord(value) || value.bookId !== bookId) {
    return undefined;
  }

  const question = stringValue(value.question).trim();
  const selectedText = stringValue(value.selectedText).trim();
  const createdAt = stringValue(value.createdAt).trim();
  const startOffset = numberValue(value.startOffset);
  const endOffset = numberValue(value.endOffset);

  if (
    !question ||
    !selectedText ||
    !createdAt ||
    startOffset === undefined ||
    endOffset === undefined ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    return undefined;
  }

  return {
    bookId,
    question: question.slice(0, MAX_QUESTION_TEXT_LENGTH),
    selectedText: selectedText.slice(0, MAX_SELECTED_TEXT_LENGTH),
    startOffset,
    endOffset,
    createdAt
  };
}

function normalizeAiQuestionRecordList(
  value: unknown,
  bookId: string
): LocalReaderAiQuestionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const records = value
    .map((item) => normalizeAiQuestionRecord(item, bookId))
    .filter((item): item is LocalReaderAiQuestionRecord => Boolean(item));
  const uniqueRecords = new Map<string, LocalReaderAiQuestionRecord>();

  for (const record of records) {
    uniqueRecords.set(record.id, record);
  }

  return Array.from(uniqueRecords.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeAiQuestionRecord(
  value: unknown,
  bookId: string
): LocalReaderAiQuestionRecord | undefined {
  const draft = normalizeAiQuestionDraftRecord(value, bookId);
  if (!draft || !isRecord(value)) {
    return undefined;
  }

  const id = stringValue(value.id).trim() || createAiQuestionRecordId(draft);
  const answer = normalizeAiQuestionAnswer(value.answer);
  const status = normalizeAiQuestionRecordStatus(value.status, answer);
  const errorMessage = stringValue(value.errorMessage).trim().slice(0, 1000);
  const thread = normalizeAiQuestionThread(value.thread);
  const updatedAt = stringValue(value.updatedAt).trim() || draft.createdAt;

  return {
    ...draft,
    id,
    source: "local",
    status,
    updatedAt,
    ...(answer ? { answer } : {}),
    ...(status === "failed" && errorMessage ? { errorMessage } : {}),
    ...(thread.length > 0 ? { thread } : {})
  };
}

function normalizeAiQuestionAnswer(value: unknown): LocalReaderAiQuestionRecordAnswer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const answer = stringValue(value.answer).trim();
  const generatedAt = stringValue(value.generatedAt).trim();
  const promptVersion = stringValue(value.promptVersion).trim();
  const basisNotice = stringValue(value.basisNotice).trim();

  if (!answer || !generatedAt || !promptVersion || !basisNotice) {
    return undefined;
  }

  const responseFormat = value.responseFormat === "json_schema" || value.responseFormat === "json_object"
    ? value.responseFormat
    : undefined;

  return {
    answer: answer.slice(0, MAX_ANSWER_TEXT_LENGTH),
    keyPoints: normalizeStringList(value.keyPoints, MAX_KEY_POINTS, MAX_LIST_ITEM_TEXT_LENGTH),
    followUpQuestions: normalizeStringList(
      value.followUpQuestions,
      MAX_FOLLOW_UPS,
      MAX_LIST_ITEM_TEXT_LENGTH
    ),
    generatedAt,
    promptVersion,
    ...(responseFormat ? { responseFormat } : {}),
    basisNotice: basisNotice.slice(0, 600),
    ...(stringValue(value.providerModel).trim()
      ? { providerModel: stringValue(value.providerModel).trim().slice(0, 120) }
      : {}),
    ...(stringValue(value.inputHash).trim()
      ? { inputHash: stringValue(value.inputHash).trim().slice(0, 120) }
      : {})
  };
}

function normalizeAiQuestionRecordStatus(
  value: unknown,
  answer: LocalReaderAiQuestionRecordAnswer | undefined
): LocalReaderAiQuestionRecordStatus {
  if (value === "answered") {
    return answer ? "answered" : "draft";
  }

  if (value === "draft" || value === "pending" || value === "failed") {
    return value;
  }

  return answer ? "answered" : "draft";
}

function normalizeAiQuestionThread(value: unknown): LocalReaderAiQuestionThreadTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const turns = value
    .map((item) => normalizeAiQuestionThreadTurn(item))
    .filter((item): item is LocalReaderAiQuestionThreadTurn => Boolean(item));
  const uniqueTurns = new Map<string, LocalReaderAiQuestionThreadTurn>();

  for (const turn of turns) {
    uniqueTurns.set(turn.id, turn);
  }

  return Array.from(uniqueTurns.values())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_THREAD_TURNS);
}

function normalizeAiQuestionThreadTurn(
  value: unknown
): LocalReaderAiQuestionThreadTurn | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const question = stringValue(value.question).trim();
  const createdAt = stringValue(value.createdAt).trim();
  const updatedAt = stringValue(value.updatedAt).trim() || createdAt;
  const id = stringValue(value.id).trim() || createAiQuestionThreadTurnId(question, createdAt);
  const answer = normalizeAiQuestionAnswer(value.answer);
  const status = normalizeAiQuestionRecordStatus(value.status, answer);
  const errorMessage = stringValue(value.errorMessage).trim().slice(0, 1000);

  if (!question || !createdAt || !id) {
    return undefined;
  }

  return {
    id,
    question: question.slice(0, MAX_QUESTION_TEXT_LENGTH),
    status,
    createdAt,
    updatedAt,
    ...(answer ? { answer } : {}),
    ...(status === "failed" && errorMessage ? { errorMessage } : {})
  };
}

function upsertAiQuestionThreadTurn(
  thread: LocalReaderAiQuestionThreadTurn[],
  turn: LocalReaderAiQuestionThreadTurn
): LocalReaderAiQuestionThreadTurn[] {
  return normalizeAiQuestionThread([
    ...thread.filter((item) => item.id !== turn.id),
    turn
  ]);
}

function normalizeStringList(value: unknown, limit: number, itemLengthLimit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => stringValue(item).trim())
    .filter(Boolean)
    .map((item) => item.slice(0, itemLengthLimit))
    .slice(0, limit);
}

function createAiQuestionRecordId(draft: LocalReaderAiQuestionDraft): string {
  return `ai-${draft.startOffset}-${draft.endOffset}-${hashText(
    `${draft.createdAt}|${draft.question}|${draft.selectedText}`
  )}`;
}

function legacyAiRecordId(draft: LocalReaderAiQuestionDraft): string {
  return `legacy-${draft.startOffset}-${draft.endOffset}-${hashText(
    `${draft.createdAt}|${draft.question}`
  )}`;
}

function createAiQuestionThreadTurnId(question: string, createdAt: string): string {
  return `turn-${hashText(`${createdAt}|${question}`)}`;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
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
