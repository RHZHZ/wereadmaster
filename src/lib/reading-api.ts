import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  check,
  type DownloadEvent,
  type Update
} from "@tauri-apps/plugin-updater";
import type {
  AiCachedOutputRecord,
  AIAssetDetail,
  AIAssetVersionDetail,
  AIAssetVersionSummary,
  AIAssetSummary,
  AiCredentialValidationResult,
  AiProviderCapabilityProbe,
  AiProviderModelListResponse,
  AiProviderPresetId,
  AiResponseFormatPolicy,
  AiSettingsState,
  AiReviewFeedbackExport,
  AiReviewFeedbackFeature,
  BookDecisionCandidateInput,
  BookDecisionResponse,
  BookAiSummaryUpdateContext,
  BookAiSummaryListItem,
  BookAiSummaryResponse,
  BookNotesSummariesExportOptions,
  BulkExportPreflight,
  BulkExportPreflightItem,
  BulkExportItemStatus,
  BulkExportProgress,
  BulkExportReport,
  BulkExportRequest,
  BulkExportResponse,
  BulkExportResultItem,
  BulkExportStrategy,
  ChooseDataDirectoryResult,
  BookDetail,
  BookNotes,
  BookshelfSummary,
  ChapterNoteGroup,
  Chapter,
  CredentialStatus,
  CredentialValidationResult,
  ClearAiOutputCacheResult,
  ClearLocalCacheResult,
  ExportBackupResult,
  ChooseExportDirectoryResult,
  ExportDiagnosticsResult,
  ExportImageResult,
  ExportAiBulkMarkdownResponse,
  ExportAiMarkdownResponse,
  Highlight,
  LocalDataState,
  MigrateDataDirectoryResult,
  NotebookBook,
  ReadingItemState,
  ReadingItemStateInput,
  ReadingItemStateType,
  ReadingItemStatus,
  ReadingCategory,
  ReadingRouteRequest,
  ReadingRouteResponse,
  ReadingRouteUpdateContext,
  ReadingPersonaPatch,
  ReadingStatsAiReviewResponse,
  Recommendation,
  RecommendationResult,
  ReadingRankItem,
  ReadingStats,
  ReadingStatsMode,
  ReadingTimeBucket,
  ReadingProgress,
  SearchBooksResult,
  SearchGroup,
  SearchResult,
  SearchScope,
  SettingsCredentialError,
  SettingsState,
  SaveExportDirectoryResult,
  ShelfArchive,
  ShelfEntry,
  ShelfEntryType,
  SimilarBooksResult,
  SyncState,
  SyncStatus,
  RestoreBackupResult,
  ResetExportDirectoryResult,
  ResetWereadProxyResult,
  AppUpdateRuntime,
  AppUpdateStatus,
  SaveWereadProxyResult,
  Thought
} from "./types";
import { calculateTotalNotes } from "./business-rules";
import type {
  LocalReaderAiQuestionRequest,
  LocalReaderAiQuestionResponse
} from "./local-reader-ai-requests";

const SETTINGS_COMMAND_TIMEOUT_MS = 15_000;

type ShelfEntryRecord = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  category?: unknown;
  isTop?: unknown;
  isSecret?: unknown;
  isFinished?: unknown;
  lastReadAt?: unknown;
  rawJson?: unknown;
};

type BookshelfSummaryRecord = {
  totalVisibleEntries?: unknown;
  bookCount?: unknown;
  albumCount?: unknown;
  mpCount?: unknown;
  publicCount?: unknown;
  secretCount?: unknown;
};

type ShelfArchiveRecord = {
  id?: unknown;
  name?: unknown;
  bookIds?: unknown;
  matchedEntryCount?: unknown;
  missingBookCount?: unknown;
  rawJson?: unknown;
};

type BookshelfResponseRecord = {
  snapshot?: {
    entries?: ShelfEntryRecord[];
    archives?: ShelfArchiveRecord[];
    summary?: BookshelfSummaryRecord;
  };
  syncState?: SyncState;
};

type BookDetailRecord = {
  bookId?: unknown;
  title?: unknown;
  author?: unknown;
  translator?: unknown;
  cover?: unknown;
  intro?: unknown;
  category?: unknown;
  publisher?: unknown;
  publishTime?: unknown;
  isbn?: unknown;
  wordCount?: unknown;
  ratingPercent?: unknown;
  ratingCount?: unknown;
};

type ReadingProgressRecord = {
  bookId?: unknown;
  chapterUid?: unknown;
  chapterOffset?: unknown;
  progressPercent?: unknown;
  updatedAt?: unknown;
  recordReadingTimeSeconds?: unknown;
  finishTime?: unknown;
  isStarted?: unknown;
  isFinished?: unknown;
};

type ChapterRecord = {
  bookId?: unknown;
  chapterUid?: unknown;
  chapterIdx?: unknown;
  title?: unknown;
  wordCount?: unknown;
  level?: unknown;
  price?: unknown;
  paid?: unknown;
  isMpChapter?: unknown;
  isMPChapter?: unknown;
};

type BookDetailResponseRecord = {
  detail?: BookDetailRecord;
  progress?: ReadingProgressRecord;
  chapters?: ChapterRecord[];
  deepLink?: unknown;
};

type NotebookBookRecord = {
  bookId?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  reviewCount?: unknown;
  noteCount?: unknown;
  bookmarkCount?: unknown;
  totalNoteCount?: unknown;
  readingProgress?: unknown;
  markedStatus?: unknown;
  sort?: unknown;
  rawJson?: unknown;
};

type NotebookOverviewResponseRecord = {
  books?: NotebookBookRecord[];
  summary?: {
    totalBookCount?: unknown;
    totalNoteCount?: unknown;
  };
  syncState?: SyncState;
};

type HighlightRecord = {
  bookmarkId?: unknown;
  bookId?: unknown;
  chapterUid?: unknown;
  chapterTitle?: unknown;
  markText?: unknown;
  createTime?: unknown;
  range?: unknown;
  deepLink?: unknown;
};

type ThoughtRecord = {
  reviewId?: unknown;
  bookId?: unknown;
  content?: unknown;
  abstractText?: unknown;
  createTime?: unknown;
  star?: unknown;
  chapterName?: unknown;
  chapterUid?: unknown;
  range?: unknown;
  deepLink?: unknown;
  isFinish?: unknown;
};

type ChapterNoteGroupRecord = {
  chapterUid?: unknown;
  title?: unknown;
  highlights?: HighlightRecord[];
  thoughts?: ThoughtRecord[];
};

type BookNotesResponseRecord = {
  bookId?: unknown;
  book?: NotebookBookRecord;
  highlights?: HighlightRecord[];
  thoughts?: ThoughtRecord[];
  chapters?: ChapterRecord[];
  chapterGroups?: ChapterNoteGroupRecord[];
  bookmarkCount?: unknown;
  exportableCount?: unknown;
  bookmarkContentNotice?: unknown;
};

type BulkExportPreflightItemRecord = {
  bookId?: unknown;
  title?: unknown;
  author?: unknown;
  totalNoteCount?: unknown;
  cachedExportableCount?: unknown;
  hasCachedNotes?: unknown;
  hasCachedAiReview?: unknown;
  status?: unknown;
  reason?: unknown;
};

type BulkExportPreflightRecord = {
  totalBooks?: unknown;
  readyCount?: unknown;
  needsSyncCount?: unknown;
  noContentCount?: unknown;
  cachedAiReviewCount?: unknown;
  items?: BulkExportPreflightItemRecord[];
};

type BulkExportResultItemRecord = {
  bookId?: unknown;
  title?: unknown;
  status?: unknown;
  notesFile?: unknown;
  aiReviewFile?: unknown;
  reason?: unknown;
};

type BulkExportReportRecord = {
  exportedAt?: unknown;
  strategy?: unknown;
  concurrency?: unknown;
  items?: BulkExportResultItemRecord[];
};

type BulkExportResponseRecord = {
  exportId?: unknown;
  path?: unknown;
  exportedAt?: unknown;
  files?: unknown[];
  report?: BulkExportReportRecord;
};

type ReadingTimeBucketRecord = {
  startTime?: unknown;
  readTimeSeconds?: unknown;
};

type ReadingRankItemRecord = {
  id?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  type?: unknown;
  readTimeSeconds?: unknown;
  tags?: unknown[];
};

type ReadingCategoryRecord = {
  categoryId?: unknown;
  title?: unknown;
  parentTitle?: unknown;
  value?: unknown;
  readingTimeSeconds?: unknown;
  readingCount?: unknown;
};

type ReadingStatsRecord = {
  mode?: unknown;
  baseTime?: unknown;
  readDays?: unknown;
  totalReadTimeSeconds?: unknown;
  dayAverageReadTimeSeconds?: unknown;
  compare?: unknown;
  buckets?: ReadingTimeBucketRecord[];
  longestItems?: ReadingRankItemRecord[];
  categories?: ReadingCategoryRecord[];
  raw?: unknown;
};

type ReadingStatsResponseRecord = {
  stats?: ReadingStatsRecord;
  syncState?: SyncState;
  source?: unknown;
};

type WebReadingPreviewStatsRowRecord = {
  mode?: unknown;
  baseTime?: unknown;
  rawJson?: unknown;
  updatedAt?: unknown;
};

type WebReadingPreviewReviewRowRecord = {
  scopeId?: unknown;
  promptVersion?: unknown;
  inputHash?: unknown;
  outputJson?: unknown;
  sourceCount?: unknown;
  providerModel?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type WebReadingPreviewDataRecord = {
  exportedAt?: unknown;
  dbPath?: unknown;
  statsSyncState?: unknown;
  statsRows?: unknown[];
  reviewRows?: unknown[];
};

type DiscoveryBookRecord = {
  bookId?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  intro?: unknown;
  category?: unknown;
  publisher?: unknown;
  ratingPercent?: unknown;
  ratingCount?: unknown;
  ratingTitle?: unknown;
  readingCount?: unknown;
  soldout?: unknown;
  searchIdx?: unknown;
  deepLink?: unknown;
  reason?: unknown;
};

type SearchGroupRecord = {
  title?: unknown;
  scope?: unknown;
  scopeCount?: unknown;
  currentCount?: unknown;
  books?: DiscoveryBookRecord[];
};

type SearchBooksRecord = {
  sid?: unknown;
  scope?: unknown;
  hasMore?: unknown;
  nextMaxIdx?: unknown;
  groups?: SearchGroupRecord[];
  results?: DiscoveryBookRecord[];
};

type SearchBooksResponseRecord = {
  result?: SearchBooksRecord;
  syncState?: SyncState;
};

type RecommendationsRecord = {
  books?: DiscoveryBookRecord[];
  hasMore?: unknown;
  nextMaxIdx?: unknown;
};

type RecommendationsResponseRecord = {
  result?: RecommendationsRecord;
  syncState?: SyncState;
};

type SimilarBooksRecord = RecommendationsRecord & {
  sessionId?: unknown;
};

type SimilarBooksResponseRecord = {
  result?: SimilarBooksRecord;
  syncState?: SyncState;
};

type SettingsStateResponseRecord = {
  credential?: CredentialStatus;
  credentialError?: Partial<SettingsCredentialError>;
  syncStates?: SyncState[];
  localData?: Partial<LocalDataState>;
  exportData?: {
    exportDir?: unknown;
    defaultExportDir?: unknown;
    isCustomExportDir?: unknown;
  };
  network?: {
    wereadProxyUrl?: unknown;
    isCustomWereadProxy?: unknown;
  };
  appVersion?: unknown;
  supportsNativeUpdater?: unknown;
};

type RemoteAppUpdateManifestResponseRecord = {
  version?: unknown;
  notes?: unknown;
  publishedAt?: unknown;
};

type ClearLocalCacheResponseRecord = {
  deletedRows?: unknown;
  state?: SettingsStateResponseRecord;
};

type ClearAiOutputCacheResponseRecord = {
  deletedRows?: unknown;
  state?: SettingsStateResponseRecord;
};

type ExportDiagnosticsResponseRecord = {
  fileName?: unknown;
  path?: unknown;
  exportedAt?: unknown;
};

type ExportImageResponseRecord = {
  fileName?: unknown;
  path?: unknown;
  exportedAt?: unknown;
};

type ExportBackupResponseRecord = {
  backupId?: unknown;
  path?: unknown;
  exportedAt?: unknown;
  files?: unknown[];
};

type RestoreBackupResponseRecord = {
  restoredFrom?: unknown;
  restoredAt?: unknown;
  state?: SettingsStateResponseRecord;
};

type ChooseDataDirectoryResponseRecord = {
  path?: unknown;
  state?: SettingsStateResponseRecord;
};

type MigrateDataDirectoryResponseRecord = {
  previousDataDir?: unknown;
  dataDir?: unknown;
  migratedAt?: unknown;
  files?: unknown[];
  state?: SettingsStateResponseRecord;
  restartRequired?: unknown;
};

type ChooseExportDirectoryResponseRecord = {
  path?: unknown;
};

type SaveExportDirectoryResponseRecord = {
  path?: unknown;
  state?: SettingsStateResponseRecord;
};

type ResetExportDirectoryResponseRecord = {
  state?: SettingsStateResponseRecord;
};

type SaveWereadProxyResponseRecord = {
  state?: SettingsStateResponseRecord;
};

type ResetWereadProxyResponseRecord = {
  state?: SettingsStateResponseRecord;
};

type ReadingItemStateRecord = {
  itemId?: unknown;
  itemType?: unknown;
  status?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  category?: unknown;
  note?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type BookshelfSnapshot = {
  entries: ShelfEntry[];
  archives: ShelfArchive[];
  summary: BookshelfSummary;
};

export type BookshelfResponse = {
  snapshot: BookshelfSnapshot;
  syncState?: SyncState;
};

export type BookDetailResponse = {
  detail: BookDetail;
  progress: ReadingProgress;
  chapters: Chapter[];
  deepLink: string;
};

export type NotebookOverviewResponse = {
  books: NotebookBook[];
  summary: {
    totalBookCount: number;
    totalNoteCount: number;
  };
  syncState?: SyncState;
};

export type OpenBookLinkResult = {
  opened: boolean;
  deepLink: string;
  message?: string;
};

export type CommandErrorInfo = {
  code?: string;
  message: string;
  detail?: string;
};

export type ExportBookNotesMarkdownResponse = {
  bookId: string;
  fileName: string;
  path: string;
  exportableCount: number;
  bookmarkContentNotice: string;
};

export type ReadingStatsResponse = {
  stats: ReadingStats;
  syncState?: SyncState;
  source?: ReadingStatsResponseSource;
};

export type ReadingStatsResponseSource = "cache" | "synced" | "empty";

export type SearchBooksResponse = {
  result: SearchBooksResult;
  syncState?: SyncState;
};

export type RecommendationsResponse = {
  result: RecommendationResult;
  syncState?: SyncState;
};

export type SimilarBooksResponse = {
  result: SimilarBooksResult;
  syncState?: SyncState;
};

export async function getAiSettingsState(): Promise<AiSettingsState> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    return buildWebPreviewAiSettingsState(preview.exportedAt);
  }

  if (!hasTauriRuntime()) {
    return {
      credential: {
        hasCredential: false
      },
      provider: {
        baseUrl: "",
        model: ""
      }
    };
  }

  return invokeSettingsCommand<AiSettingsState>("get_ai_settings_state");
}

export async function canAskLocalReaderSelectionQuestion(): Promise<boolean> {
  if (!hasTauriRuntime()) {
    return false;
  }

  const settings = await getAiSettingsState();
  return settings.credential.hasCredential;
}

export async function askLocalReaderSelectionQuestion(
  request: LocalReaderAiQuestionRequest
): Promise<LocalReaderAiQuestionResponse> {
  if (!hasTauriRuntime()) {
    throw new Error("本地阅读器 AI 提问需要在桌面应用中使用。");
  }

  return invoke<LocalReaderAiQuestionResponse>("ask_local_reader_selection_question", {
    request
  });
}

export async function validateAiCredential({
  apiKey,
  baseUrl,
  model,
  presetId,
  responseFormatPolicy
}: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}): Promise<AiCredentialValidationResult> {
  return invokeSettingsCommand<AiCredentialValidationResult>("validate_ai_credential", {
    apiKey,
    baseUrl,
    model,
    presetId,
    responseFormatPolicy
  });
}

export async function saveAiCredential({
  apiKey,
  baseUrl,
  model,
  presetId,
  responseFormatPolicy
}: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}): Promise<AiSettingsState> {
  return invokeSettingsCommand<AiSettingsState>("save_ai_credential", {
    apiKey,
    baseUrl,
    model,
    presetId,
    responseFormatPolicy
  });
}

export async function saveAiSettings({
  apiKey,
  baseUrl,
  model,
  presetId,
  responseFormatPolicy
}: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}): Promise<AiSettingsState> {
  return invokeSettingsCommand<AiSettingsState>("save_ai_settings", {
    apiKey,
    baseUrl,
    model,
    presetId,
    responseFormatPolicy
  });
}

export async function testAiConnection({
  apiKey,
  baseUrl,
  model,
  presetId,
  responseFormatPolicy
}: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}): Promise<AiCredentialValidationResult> {
  return invoke<AiCredentialValidationResult>("test_ai_connection", {
    apiKey,
    baseUrl,
    model,
    presetId,
    responseFormatPolicy
  });
}

export async function probeAiProviderCapabilities({
  apiKey,
  baseUrl,
  model,
  presetId,
  responseFormatPolicy
}: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
}): Promise<AiProviderCapabilityProbe> {
  return invoke<AiProviderCapabilityProbe>("probe_ai_provider_capabilities", {
    apiKey,
    baseUrl,
    model,
    presetId,
    responseFormatPolicy
  });
}

export async function listAiProviderModels({
  apiKey,
  baseUrl
}: {
  apiKey?: string;
  baseUrl?: string;
}): Promise<AiProviderModelListResponse> {
  return invoke<AiProviderModelListResponse>("list_ai_provider_models", {
    apiKey,
    baseUrl
  });
}

export async function removeAiCredential(confirm: boolean): Promise<AiSettingsState> {
  return invokeSettingsCommand<AiSettingsState>("remove_ai_credential", { confirm });
}

export async function getAiCachedOutput({
  feature,
  scopeId,
  promptVersion,
  inputHash
}: {
  feature: string;
  scopeId: string;
  promptVersion: string;
  inputHash: string;
}): Promise<AiCachedOutputRecord | undefined> {
  const response = await invoke<AiCachedOutputRecord | null>("get_ai_cached_output", {
    feature,
    scopeId,
    promptVersion,
    inputHash
  });

  return response ?? undefined;
}

export async function summarizeBookNotes({
  bookId,
  regenerate = false,
  updateFrom
}: {
  bookId: string;
  regenerate?: boolean;
  updateFrom?: BookAiSummaryUpdateContext;
}): Promise<BookAiSummaryResponse> {
  return invoke<BookAiSummaryResponse>("summarize_book_notes", { bookId, regenerate, updateFrom });
}

export async function getLatestBookNotesSummary(bookId: string): Promise<BookAiSummaryResponse | undefined> {
  const response = await invoke<BookAiSummaryResponse | null>("get_latest_book_notes_summary", {
    bookId
  });

  return response ?? undefined;
}

export async function exportBookNotesSummaryMarkdown(
  bookId: string,
  reviewFeedback?: AiReviewFeedbackExport
): Promise<ExportAiMarkdownResponse> {
  return invoke<ExportAiMarkdownResponse>("export_book_notes_summary_markdown", { bookId, reviewFeedback });
}

export async function getAiReviewFeedback({
  feature,
  scopeId,
  inputHash
}: {
  feature: AiReviewFeedbackFeature;
  scopeId: string;
  inputHash: string;
}): Promise<AiReviewFeedbackExport> {
  return invoke<AiReviewFeedbackExport>("get_ai_review_feedback", {
    feature,
    scopeId,
    inputHash
  });
}

export async function saveAiReviewFeedback({
  feature,
  scopeId,
  inputHash,
  feedback
}: {
  feature: AiReviewFeedbackFeature;
  scopeId: string;
  inputHash: string;
  feedback: AiReviewFeedbackExport;
}): Promise<AiReviewFeedbackExport> {
  return invoke<AiReviewFeedbackExport>("save_ai_review_feedback", {
    feature,
    scopeId,
    inputHash,
    feedback
  });
}

export async function exportBookNotesSummariesMarkdown(
  bookIds?: string[],
  options?: BookNotesSummariesExportOptions
): Promise<ExportAiBulkMarkdownResponse> {
  return invoke<ExportAiBulkMarkdownResponse>("export_book_notes_summaries_markdown", {
    bookIds,
    options
  });
}

export async function listBookNotesSummaries(): Promise<BookAiSummaryListItem[]> {
  return invoke<BookAiSummaryListItem[]>("list_book_notes_summaries");
}

export async function listAIAssetSummaries(): Promise<AIAssetSummary[]> {
  return invoke<AIAssetSummary[]>("list_ai_asset_summaries");
}

export async function getAIAssetDetail(bookId: string): Promise<AIAssetDetail | undefined> {
  const response = await invoke<AIAssetDetail | null>("get_ai_asset_detail", { bookId });
  return response ?? undefined;
}

export async function getAIAssetVersionDetail({
  feature,
  scopeId,
  inputHash
}: {
  feature: "reading-route" | "book-review";
  scopeId: string;
  inputHash: string;
}): Promise<AIAssetVersionDetail | undefined> {
  const response = await invoke<AIAssetVersionDetail | null>("get_ai_asset_version_detail", {
    feature,
    scopeId,
    inputHash
  });
  return response ?? undefined;
}

export async function getAIAssetVersionHistory({
  feature,
  scopeId
}: {
  feature: "reading-route" | "book-review";
  scopeId: string;
}): Promise<AIAssetVersionSummary[]> {
  return invoke<AIAssetVersionSummary[]>("get_ai_asset_version_history", {
    feature,
    scopeId
  });
}

export async function summarizeReadingStats({
  mode,
  baseTime,
  regenerate = false
}: {
  mode: ReadingStatsMode;
  baseTime?: number;
  regenerate?: boolean;
}): Promise<ReadingStatsAiReviewResponse> {
  const preview = await loadWebReadingPreviewData(regenerate);
  if (preview) {
    const cached = findWebPreviewReadingStatsReview(preview, mode, baseTime);
    if (cached) {
      return cached;
    }

    throw new Error("Web 预览只支持查看已缓存复盘；当前周期请在桌面应用中生成。");
  }

  return invoke<ReadingStatsAiReviewResponse>("summarize_reading_stats", {
    mode,
    baseTime,
    regenerate
  });
}

export async function getLatestReadingStatsReview({
  mode,
  baseTime
}: {
  mode: ReadingStatsMode;
  baseTime?: number;
}): Promise<ReadingStatsAiReviewResponse | undefined> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    return findWebPreviewReadingStatsReview(preview, mode, baseTime);
  }

  const response = await invoke<ReadingStatsAiReviewResponse | null>(
    "get_latest_reading_stats_review",
    { mode, baseTime }
  );

  return response ?? undefined;
}

export async function exportReadingStatsReviewMarkdown({
  mode,
  baseTime
}: {
  mode: ReadingStatsMode;
  baseTime?: number;
}): Promise<ExportAiMarkdownResponse> {
  if (await loadWebReadingPreviewData()) {
    throw new Error("Web 预览只支持查看已缓存复盘，导出请在桌面应用中执行。");
  }

  return invoke<ExportAiMarkdownResponse>("export_reading_stats_review_markdown", {
    mode,
    baseTime
  });
}

export async function summarizeReadingRoute({
  request,
  regenerate = false,
  updateFrom
}: {
  request: ReadingRouteRequest;
  regenerate?: boolean;
  updateFrom?: ReadingRouteUpdateContext;
}): Promise<ReadingRouteResponse> {
  return invoke<ReadingRouteResponse>("summarize_reading_route", { request, regenerate, updateFrom });
}

export async function getLatestReadingRoute(
  request: ReadingRouteRequest
): Promise<ReadingRouteResponse | undefined> {
  const response = await invoke<ReadingRouteResponse | null>("get_latest_reading_route", {
    request
  });

  return response ?? undefined;
}

export async function exportReadingRouteMarkdown(
  request: ReadingRouteRequest
): Promise<ExportAiMarkdownResponse> {
  return invoke<ExportAiMarkdownResponse>("export_reading_route_markdown", { request });
}

export async function summarizeBookDecision({
  candidates,
  goal,
  regenerate = false
}: {
  candidates: BookDecisionCandidateInput[];
  goal?: string;
  regenerate?: boolean;
}): Promise<BookDecisionResponse> {
  return invoke<BookDecisionResponse>("summarize_book_decision", { candidates, goal, regenerate });
}

export async function getLatestBookDecision(
  candidates: BookDecisionCandidateInput[],
  goal?: string
): Promise<BookDecisionResponse | undefined> {
  const response = await invoke<BookDecisionResponse | null>("get_latest_book_decision", {
    candidates,
    goal
  });

  return response ?? undefined;
}

export async function exportBookDecisionMarkdown(
  candidates: BookDecisionCandidateInput[],
  goal?: string
): Promise<ExportAiMarkdownResponse> {
  return invoke<ExportAiMarkdownResponse>("export_book_decision_markdown", {
    candidates,
    goal
  });
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    return {
      hasCredential: true,
      lastValidatedAt: preview.exportedAt
    };
  }

  if (!hasTauriRuntime()) {
    return {
      hasCredential: false
    };
  }

  return invokeSettingsCommand<CredentialStatus>("get_credential_status");
}

export async function validateCredential(apiKey: string): Promise<CredentialValidationResult> {
  return invokeSettingsCommand<CredentialValidationResult>("validate_credential", { apiKey });
}

export async function saveCredential(apiKey: string): Promise<CredentialStatus> {
  return invokeSettingsCommand<CredentialStatus>("save_credential", { apiKey });
}

export async function removeCredential(confirm: boolean): Promise<CredentialStatus> {
  return invokeSettingsCommand<CredentialStatus>("remove_credential", { confirm });
}

export async function getBookshelf(): Promise<BookshelfResponse> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    if (!supportsWebPreviewDashboardData(preview)) {
      throw createMissingWebPreviewDataError("总览");
    }

    return buildWebPreviewBookshelfResponse(preview);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("总览");
  }

  const response = await invoke<BookshelfResponseRecord>("get_bookshelf");
  return mapBookshelfResponse(response);
}

export async function syncShelf(): Promise<BookshelfResponse> {
  const preview = await loadWebReadingPreviewData(true);
  if (preview) {
    if (!supportsWebPreviewDashboardData(preview)) {
      throw createMissingWebPreviewDataError("总览");
    }

    return buildWebPreviewBookshelfResponse(preview);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("总览");
  }

  const response = await invoke<BookshelfResponseRecord>("sync_shelf");
  return mapBookshelfResponse(response);
}

export async function getBookDetail(bookId: string): Promise<BookDetailResponse> {
  const response = await invoke<BookDetailResponseRecord>("get_book_detail", { bookId });
  return mapBookDetailResponse(bookId, response);
}

export async function openBookInWeread(
  bookId: string,
  chapterUid?: number
): Promise<OpenBookLinkResult> {
  return invoke<OpenBookLinkResult>("open_book_in_weread", { bookId, chapterUid });
}

export async function listReadingItemStates(): Promise<ReadingItemState[]> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    if (!supportsWebPreviewDashboardData(preview)) {
      throw createMissingWebPreviewDataError("本地队列");
    }

    return buildWebPreviewReadingItemStates(preview);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("本地队列");
  }

  const response = await invoke<ReadingItemStateRecord[]>("list_reading_item_states");
  return response.map(mapReadingItemState).filter((state): state is ReadingItemState => Boolean(state));
}

export async function getReadingItemState(itemId: string): Promise<ReadingItemState | undefined> {
  const response = await invoke<ReadingItemStateRecord | null>("get_reading_item_state", { itemId });
  return response ? mapReadingItemState(response) : undefined;
}

export async function upsertReadingItemState(input: ReadingItemStateInput): Promise<ReadingItemState> {
  const response = await invoke<ReadingItemStateRecord>("upsert_reading_item_state", { input });
  return mapReadingItemState(response) ?? {
    ...input,
    createdAt: "",
    updatedAt: ""
  };
}

export async function removeReadingItemState(itemId: string): Promise<ReadingItemState | undefined> {
  const response = await invoke<ReadingItemStateRecord | null>("remove_reading_item_state", { itemId });
  return response ? mapReadingItemState(response) : undefined;
}

export async function getNotebookOverview(count = 100): Promise<NotebookOverviewResponse> {
  const preview = await loadWebReadingPreviewData(true);
  if (preview) {
    if (!supportsWebPreviewDashboardData(preview)) {
      throw createMissingWebPreviewDataError("笔记");
    }

    return buildWebPreviewNotebookOverviewResponse(preview);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("笔记");
  }

  const response = await invoke<NotebookOverviewResponseRecord>("get_notebook_overview", {
    count
  });
  return mapNotebookOverviewResponse(response);
}

export async function getBookNotes(bookId: string): Promise<BookNotes> {
  const response = await invoke<BookNotesResponseRecord>("get_book_notes", { bookId });
  return mapBookNotesResponse(bookId, response);
}

export async function exportBookNotesMarkdown(
  bookId: string
): Promise<ExportBookNotesMarkdownResponse> {
  return invoke<ExportBookNotesMarkdownResponse>("export_book_notes_markdown", { bookId });
}

export async function preflightBulkExport(
  selectedBookIds?: string[],
  excludeWithoutExportableNotes = true
): Promise<BulkExportPreflight> {
  const response = await invoke<BulkExportPreflightRecord>("preflight_bulk_export", {
    selectedBookIds,
    excludeWithoutExportableNotes
  });
  return mapBulkExportPreflight(response);
}

export async function exportBulkNotes(request: BulkExportRequest): Promise<BulkExportResponse> {
  const response = await invoke<BulkExportResponseRecord>("export_bulk_notes", { request });
  return mapBulkExportResponse(request.strategy, response);
}

export async function cancelBulkExport(): Promise<void> {
  await invoke("cancel_bulk_export");
}

export async function listenBulkExportProgress(
  handler: (progress: BulkExportProgress) => void
): Promise<() => void> {
  return listen<BulkExportProgress>("bulk-export-progress", (event) => {
    handler(event.payload);
  });
}

export async function getReadingStats(
  mode: ReadingStatsMode = "monthly",
  baseTime?: number
): Promise<ReadingStatsResponse> {
  const preview = await loadWebReadingPreviewData();
  if (preview) {
    return buildWebPreviewReadingStatsResponse(preview, mode, baseTime);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("统计");
  }

  const response = await invoke<ReadingStatsResponseRecord>("get_reading_stats", {
    mode,
    baseTime
  });
  return mapReadingStatsResponse(mode, response);
}

export async function syncReadingStats(
  mode: ReadingStatsMode = "monthly",
  baseTime?: number
): Promise<ReadingStatsResponse> {
  const preview = await loadWebReadingPreviewData(true);
  if (preview) {
    return buildWebPreviewReadingStatsResponse(preview, mode, baseTime);
  }

  if (!hasTauriRuntime()) {
    throw createMissingWebPreviewDataError("统计");
  }

  const response = await invoke<ReadingStatsResponseRecord>("sync_reading_stats", {
    mode,
    baseTime
  });
  return mapReadingStatsResponse(mode, response);
}

export async function withSyncTiming<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    const duration = Math.round(performance.now() - startedAt);
    console.debug(`[sync] ${label}: ${duration}ms`);
  }
}

export async function searchBooks({
  keyword,
  scope,
  maxIdx,
  count = 20
}: {
  keyword: string;
  scope?: SearchScope;
  maxIdx?: number;
  count?: number;
}): Promise<SearchBooksResponse> {
  const response = await invoke<SearchBooksResponseRecord>("search_books", {
    keyword,
    scope,
    maxIdx,
    count
  });
  return mapSearchBooksResponse(scope ?? 0, response);
}

export async function getRecommendations({
  count = 20,
  maxIdx
}: {
  count?: number;
  maxIdx?: number;
} = {}): Promise<RecommendationsResponse> {
  const response = await invoke<RecommendationsResponseRecord>("get_recommendations", {
    count,
    maxIdx
  });
  return mapRecommendationsResponse(response);
}

export async function getSimilarBooks({
  bookId,
  count = 12,
  maxIdx,
  sessionId
}: {
  bookId: string;
  count?: number;
  maxIdx?: number;
  sessionId?: string;
}): Promise<SimilarBooksResponse> {
  const response = await invoke<SimilarBooksResponseRecord>("get_similar_books", {
    bookId,
    count,
    maxIdx,
    sessionId
  });
  return mapSimilarBooksResponse(response);
}

export async function getSettingsState(): Promise<SettingsState> {
  const response = await invokeSettingsCommand<SettingsStateResponseRecord>("get_settings_state");
  return mapSettingsState(response);
}

export async function getAppUpdateRuntime(): Promise<AppUpdateRuntime> {
  const currentState = await getSettingsState();
  return {
    currentVersion: currentState.appVersion,
    supportsNativeUpdater: currentState.supportsNativeUpdater
  };
}

export async function prepareAppUpdate(
  runtime?: AppUpdateRuntime
): Promise<{ status: AppUpdateStatus; update: Update | null }> {
  const currentRuntime = runtime ?? (await getAppUpdateRuntime());

  if (!currentRuntime.supportsNativeUpdater) {
    const manifest = await fetchAppUpdateManifest();
    const latestVersion = manifest.version;

    return {
      status: {
        available: compareAppVersions(latestVersion, currentRuntime.currentVersion) > 0,
        currentVersion: currentRuntime.currentVersion,
        supportsNativeUpdater: false,
        latestVersion,
        notes: manifest.notes,
        publishedAt: manifest.publishedAt
      },
      update: null
    };
  }

  const update = await check();

  if (!update) {
    return {
      status: {
        available: false,
        currentVersion: currentRuntime.currentVersion,
        supportsNativeUpdater: true
      },
      update: null
    };
  }

  return {
    status: {
      available: true,
      currentVersion: currentRuntime.currentVersion,
      supportsNativeUpdater: true,
      latestVersion: update.version,
      notes: update.body,
      publishedAt: update.date
    },
    update
  };
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  const prepared = await prepareAppUpdate();
  return prepared.status;
}

export async function downloadPreparedAppUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  await update.downloadAndInstall(onEvent);
}

export async function downloadAndInstallAppUpdate(): Promise<void> {
  const prepared = await prepareAppUpdate();
  const update = prepared.update;

  if (!update) {
    return;
  }

  await downloadPreparedAppUpdate(update);
}

async function fetchAppUpdateManifest(): Promise<{
  version: string;
  notes?: string;
  publishedAt?: string;
}> {
  const payload = await invoke<RemoteAppUpdateManifestResponseRecord>(
    "get_remote_app_update_manifest"
  );
  const version = stringValue(payload.version);

  if (!version) {
    throw new Error("更新源缺少版本号。");
  }

  return {
    version,
    notes: stringValue(payload.notes),
    publishedAt: stringValue(payload.publishedAt)
  };
}

function compareAppVersions(left: string, right: string): number {
  const leftSegments = parseAppVersionSegments(left);
  const rightSegments = parseAppVersionSegments(right);
  const maxLength = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftSegments[index] ?? 0;
    const rightValue = rightSegments[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function parseAppVersionSegments(version: string): number[] {
  return normalizeAppVersion(version)
    .split(/[+-]/, 1)[0]
    .split(".")
    .map((segment) => {
      const matched = segment.match(/\d+/);
      return matched ? Number.parseInt(matched[0], 10) : 0;
    });
}

function normalizeAppVersion(version: string): string {
  return version.trim().replace(/^[vV]/, "");
}

export async function clearLocalCache(confirm: boolean): Promise<ClearLocalCacheResult> {
  const response = await invoke<ClearLocalCacheResponseRecord>("clear_local_cache", { confirm });
  return {
    deletedRows: numberValue(response.deletedRows) ?? 0,
    state: mapSettingsState(response.state ?? {})
  };
}

export async function clearAiOutputCache(confirm: boolean): Promise<ClearAiOutputCacheResult> {
  const response = await invoke<ClearAiOutputCacheResponseRecord>("clear_ai_output_cache", { confirm });
  return {
    deletedRows: numberValue(response.deletedRows) ?? 0,
    state: mapSettingsState(response.state ?? {})
  };
}

export async function exportDiagnostics(): Promise<ExportDiagnosticsResult> {
  const response = await invoke<ExportDiagnosticsResponseRecord>("export_diagnostics");

  return {
    fileName: stringValue(response.fileName) || "wxreadmaster-diagnostics.md",
    path: stringValue(response.path) || "",
    exportedAt: stringValue(response.exportedAt) || ""
  };
}

export async function exportReportImage(fileName: string, pngBase64: string): Promise<ExportImageResult> {
  const response = await invoke<ExportImageResponseRecord>("export_report_image", {
    fileName,
    pngBase64
  });

  return {
    fileName: stringValue(response.fileName) || fileName,
    path: stringValue(response.path) || "",
    exportedAt: stringValue(response.exportedAt) || ""
  };
}

export async function exportLocalDataBackup(): Promise<ExportBackupResult> {
  const response = await invoke<ExportBackupResponseRecord>("export_local_data_backup");

  return {
    backupId: stringValue(response.backupId) || "wxreadmaster-backup",
    path: stringValue(response.path) || "",
    exportedAt: stringValue(response.exportedAt) || "",
    files: (response.files ?? []).map(stringValue).filter(isDefined)
  };
}

export async function restoreLocalDataBackup(
  backupPath: string,
  confirm: boolean
): Promise<RestoreBackupResult> {
  const response = await invoke<RestoreBackupResponseRecord>("restore_local_data_backup", {
    backupPath,
    confirm
  });

  return {
    restoredFrom: stringValue(response.restoredFrom) || backupPath,
    restoredAt: stringValue(response.restoredAt) || "",
    state: mapSettingsState(response.state ?? {})
  };
}

export async function chooseCustomDataDirectory(targetDir?: string): Promise<ChooseDataDirectoryResult> {
  const response = await invoke<ChooseDataDirectoryResponseRecord>("choose_custom_data_directory", {
    targetDir
  });

  return {
    path: stringValue(response.path),
    state: mapSettingsState(response.state ?? {})
  };
}

export async function migrateLocalDataDirectory(
  targetDir: string,
  confirm: boolean
): Promise<MigrateDataDirectoryResult> {
  const response = await invoke<MigrateDataDirectoryResponseRecord>("migrate_local_data_directory", {
    targetDir,
    confirm
  });

  return {
    previousDataDir: stringValue(response.previousDataDir) || "",
    dataDir: stringValue(response.dataDir) || targetDir,
    migratedAt: stringValue(response.migratedAt) || "",
    files: (response.files ?? []).map(stringValue).filter(isDefined),
    state: mapSettingsState(response.state ?? {}),
    restartRequired: booleanValue(response.restartRequired)
  };
}

export async function chooseCustomExportDirectory(): Promise<ChooseExportDirectoryResult> {
  const response = await invoke<ChooseExportDirectoryResponseRecord>("choose_custom_export_directory");

  return {
    path: stringValue(response.path)
  };
}

export async function saveCustomExportDirectory(targetDir: string): Promise<SaveExportDirectoryResult> {
  const response = await invokeSettingsCommand<SaveExportDirectoryResponseRecord>(
    "save_custom_export_directory",
    { targetDir }
  );

  return {
    path: stringValue(response.path) || targetDir,
    state: mapSettingsState(response.state ?? {})
  };
}

export async function resetCustomExportDirectory(): Promise<ResetExportDirectoryResult> {
  const response = await invokeSettingsCommand<ResetExportDirectoryResponseRecord>(
    "reset_custom_export_directory"
  );

  return {
    state: mapSettingsState(response.state ?? {})
  };
}

export async function saveWereadProxyUrl(proxyUrl: string): Promise<SaveWereadProxyResult> {
  const response = await invokeSettingsCommand<SaveWereadProxyResponseRecord>(
    "save_weread_proxy_url",
    { proxyUrl }
  );

  return {
    state: mapSettingsState(response.state ?? {})
  };
}

export async function resetWereadProxyUrl(): Promise<ResetWereadProxyResult> {
  const response = await invokeSettingsCommand<ResetWereadProxyResponseRecord>(
    "reset_weread_proxy_url"
  );

  return {
    state: mapSettingsState(response.state ?? {})
  };
}

const WEB_READING_PREVIEW_DATA_URL = "/.codex-temp/reading-preview-data.json";

let webReadingPreviewDataPromise: Promise<WebReadingPreviewData | undefined> | undefined;

type WebReadingPreviewData = {
  schemaVersion?: number;
  exportedAt?: string;
  statsSyncState?: SyncState;
  shelfSyncState?: SyncState;
  notesSyncState?: SyncState;
  shelfEntries: ShelfEntryRecord[];
  shelfArchives: ShelfArchiveRecord[];
  readingItemStates: ReadingItemStateRecord[];
  notebookBooks: NotebookBookRecord[];
  statsRows: WebReadingPreviewStatsRow[];
  reviewRows: WebReadingPreviewReviewRow[];
};

type WebReadingPreviewStatsRow = {
  mode: ReadingStatsMode;
  baseTime: number;
  rawJson: string;
  updatedAt?: string;
};

type WebReadingPreviewReviewRow = {
  scopeId: string;
  promptVersion: string;
  inputHash: string;
  outputJson: string;
  sourceCount?: number;
  providerModel?: string;
  createdAt?: string;
  updatedAt?: string;
};

async function loadWebReadingPreviewData(
  forceRefresh = false
): Promise<WebReadingPreviewData | undefined> {
  if (hasTauriRuntime() || typeof fetch !== "function") {
    return undefined;
  }

  if (!forceRefresh && webReadingPreviewDataPromise) {
    return webReadingPreviewDataPromise;
  }

  webReadingPreviewDataPromise = fetchWebReadingPreviewData(forceRefresh);
  return webReadingPreviewDataPromise;
}

async function fetchWebReadingPreviewData(
  forceRefresh: boolean
): Promise<WebReadingPreviewData | undefined> {
  const cacheBuster = forceRefresh ? `?t=${Date.now()}` : "";

  try {
    const response = await fetch(`${WEB_READING_PREVIEW_DATA_URL}${cacheBuster}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return undefined;
    }

    return normalizeWebReadingPreviewData(await response.json());
  } catch {
    return undefined;
  }
}

function normalizeWebReadingPreviewData(value: unknown): WebReadingPreviewData | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    schemaVersion: numberValue(record.schemaVersion),
    exportedAt: stringValue(record.exportedAt),
    statsSyncState: normalizePreviewSyncState(record.statsSyncState),
    shelfSyncState: normalizePreviewSyncState(record.shelfSyncState),
    notesSyncState: normalizePreviewSyncState(record.notesSyncState),
    shelfEntries: (Array.isArray(record.shelfEntries) ? record.shelfEntries : [])
      .map(normalizeWebPreviewShelfEntryRecord)
      .filter(isDefined),
    shelfArchives: (Array.isArray(record.shelfArchives) ? record.shelfArchives : [])
      .map(normalizeWebPreviewShelfArchiveRecord)
      .filter(isDefined),
    readingItemStates: (Array.isArray(record.readingItemStates) ? record.readingItemStates : [])
      .map(normalizeWebPreviewReadingItemStateRecord)
      .filter(isDefined),
    notebookBooks: (Array.isArray(record.notebookBooks) ? record.notebookBooks : [])
      .map(normalizeWebPreviewNotebookBookRecord)
      .filter(isDefined),
    statsRows: (Array.isArray(record.statsRows) ? record.statsRows : [])
      .map(normalizeWebReadingPreviewStatsRow)
      .filter(isDefined),
    reviewRows: (Array.isArray(record.reviewRows) ? record.reviewRows : [])
      .map(normalizeWebReadingPreviewReviewRow)
      .filter(isDefined)
  };
}

function normalizeWebPreviewShelfEntryRecord(value: unknown): ShelfEntryRecord | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const id = stringValue(record.id);
  const type = stringValue(record.type);
  const title = stringValue(record.title);
  const rawJson = stringValue(record.rawJson ?? record.raw_json);
  if (!id || !type || !title || !rawJson) {
    return undefined;
  }

  return {
    id,
    type,
    title,
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    category: stringValue(record.category),
    isTop: record.isTop ?? record.is_top,
    isSecret: record.isSecret ?? record.is_secret,
    isFinished: record.isFinished ?? record.is_finished,
    lastReadAt: numberValue(record.lastReadAt ?? record.last_read_at),
    rawJson
  };
}

function normalizeWebPreviewShelfArchiveRecord(value: unknown): ShelfArchiveRecord | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const id = stringValue(record.id);
  if (!id) {
    return undefined;
  }

  return {
    id,
    name: stringValue(record.name),
    bookIds: parseStringArrayJson(record.bookIds ?? record.bookIdsJson ?? record.book_ids_json),
    matchedEntryCount: numberValue(record.matchedEntryCount ?? record.matched_entry_count),
    missingBookCount: numberValue(record.missingBookCount ?? record.missing_book_count),
    rawJson: stringValue(record.rawJson ?? record.raw_json)
  };
}

function normalizeWebPreviewReadingItemStateRecord(
  value: unknown
): ReadingItemStateRecord | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const itemId = stringValue(record.itemId ?? record.item_id);
  const itemType = stringValue(record.itemType ?? record.item_type);
  const status = stringValue(record.status);
  if (!itemId || !itemType || !status) {
    return undefined;
  }

  return {
    itemId,
    itemType,
    status,
    title: stringValue(record.title),
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    category: stringValue(record.category),
    note: stringValue(record.note),
    createdAt: stringValue(record.createdAt ?? record.created_at),
    updatedAt: stringValue(record.updatedAt ?? record.updated_at)
  };
}

function normalizeWebPreviewNotebookBookRecord(value: unknown): NotebookBookRecord | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const bookId = stringValue(record.bookId ?? record.book_id);
  const title = stringValue(record.title);
  const rawJson = stringValue(record.rawJson ?? record.raw_json);
  if (!bookId || !title || !rawJson) {
    return undefined;
  }

  return {
    bookId,
    title,
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    reviewCount: numberValue(record.reviewCount ?? record.review_count),
    noteCount: numberValue(record.noteCount ?? record.note_count),
    bookmarkCount: numberValue(record.bookmarkCount ?? record.bookmark_count),
    totalNoteCount: numberValue(record.totalNoteCount ?? record.total_note_count),
    readingProgress: numberValue(record.readingProgress ?? record.reading_progress),
    markedStatus: numberValue(record.markedStatus ?? record.marked_status),
    sort: numberValue(record.sort),
    rawJson
  };
}

function normalizeWebReadingPreviewStatsRow(
  value: unknown
): WebReadingPreviewStatsRow | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const mode = normalizeStatsMode(record.mode);
  const rawJson = stringValue(record.rawJson);
  const baseTime = Math.trunc(numberValue(record.baseTime) ?? Number.NaN);
  if (!mode || !rawJson || !Number.isFinite(baseTime)) {
    return undefined;
  }

  return {
    mode,
    baseTime,
    rawJson,
    updatedAt: stringValue(record.updatedAt)
  };
}

function normalizeWebReadingPreviewReviewRow(
  value: unknown
): WebReadingPreviewReviewRow | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const scopeId = stringValue(record.scopeId);
  const promptVersion = stringValue(record.promptVersion);
  const inputHash = stringValue(record.inputHash);
  const outputJson = stringValue(record.outputJson);
  if (!scopeId || !promptVersion || !inputHash || !outputJson) {
    return undefined;
  }

  return {
    scopeId,
    promptVersion,
    inputHash,
    outputJson,
    sourceCount: numberValue(record.sourceCount),
    providerModel: stringValue(record.providerModel),
    createdAt: stringValue(record.createdAt),
    updatedAt: stringValue(record.updatedAt)
  };
}

function buildWebPreviewAiSettingsState(exportedAt?: string): AiSettingsState {
  return {
    credential: {
      hasCredential: true,
      lastValidatedAt: exportedAt
    },
    provider: {
      baseUrl: "web-preview",
      model: "preview-readonly",
      presetId: "custom",
      responseFormatPolicy: "auto"
    }
  };
}

function supportsWebPreviewDashboardData(preview: WebReadingPreviewData): boolean {
  return (preview.schemaVersion ?? 0) >= 2;
}

function buildWebPreviewBookshelfResponse(preview: WebReadingPreviewData): BookshelfResponse {
  const entries = preview.shelfEntries.map(mapShelfEntry);

  return {
    snapshot: {
      entries,
      archives: preview.shelfArchives.map(mapShelfArchive),
      summary: mapSummary(undefined, entries)
    },
    syncState: preview.shelfSyncState
  };
}

function buildWebPreviewReadingItemStates(preview: WebReadingPreviewData): ReadingItemState[] {
  return preview.readingItemStates
    .map(mapReadingItemState)
    .filter((state): state is ReadingItemState => Boolean(state));
}

function buildWebPreviewNotebookOverviewResponse(
  preview: WebReadingPreviewData
): NotebookOverviewResponse {
  const books = preview.notebookBooks.map((book, index) => mapNotebookBook(book, index));

  return {
    books,
    summary: {
      totalBookCount: books.length,
      totalNoteCount: books.reduce((total, book) => total + book.totalNoteCount, 0)
    },
    syncState: preview.notesSyncState
  };
}

function buildWebPreviewReadingStatsResponse(
  preview: WebReadingPreviewData,
  mode: ReadingStatsMode,
  baseTime?: number
): ReadingStatsResponse {
  const row = findWebReadingPreviewStatsRow(preview.statsRows, mode, baseTime);

  return {
    stats: row ? mapWebPreviewReadingStats(row) : createEmptyReadingStats(mode, baseTime),
    syncState: preview.statsSyncState,
    source: row ? "cache" : "empty"
  };
}

function findWebReadingPreviewStatsRow(
  rows: WebReadingPreviewStatsRow[],
  mode: ReadingStatsMode,
  baseTime?: number
): WebReadingPreviewStatsRow | undefined {
  const normalizedBaseTime = normalizePreviewBaseTime(mode, baseTime);
  if (mode === "overall") {
    return rows.find((row) => row.mode === "overall" && row.baseTime === 0);
  }

  if (normalizedBaseTime > 0) {
    const exact = rows.find((row) => row.mode === mode && row.baseTime === normalizedBaseTime);
    if (exact) {
      return exact;
    }

    const targetIdentity = buildPreviewPeriodIdentity(mode, normalizedBaseTime);
    return rows.find(
      (row) =>
        row.mode === mode && buildPreviewPeriodIdentity(row.mode, row.baseTime) === targetIdentity
    );
  }

  const currentAnchor = currentPreviewAnchor(mode);
  let matched: WebReadingPreviewStatsRow | undefined;

  for (const row of rows) {
    if (row.mode !== mode || row.baseTime > currentAnchor) {
      continue;
    }

    if (!matched || row.baseTime > matched.baseTime) {
      matched = row;
    }
  }

  return matched;
}

function mapWebPreviewReadingStats(row: WebReadingPreviewStatsRow): ReadingStats {
  const raw = parseRawJson(row.rawJson);
  const record = asUnknownRecord(raw);

  return {
    mode: row.mode,
    baseTime: Math.trunc(numberValue(record?.baseTime) ?? row.baseTime),
    readDays: nonNegativeNumberValue(record?.readDays),
    totalReadTimeSeconds: nonNegativeNumberValue(record?.totalReadTime),
    dayAverageReadTimeSeconds: nonNegativeNumberValue(record?.dayAverageReadTime),
    compare: numberValue(record?.compare),
    buckets: mapWebPreviewReadingBuckets(record?.readTimes),
    longestItems: mapWebPreviewReadingRankItems(record?.readLongest),
    categories: mapWebPreviewReadingCategories(record?.preferCategory),
    raw
  };
}

function mapWebPreviewReadingBuckets(value: unknown): ReadingTimeBucket[] {
  const record = asUnknownRecord(value);
  if (!record) {
    return [];
  }

  return Object.entries(record)
    .map(([startTime, seconds]) => {
      const parsedStartTime = numberValue(startTime);
      const readTimeSeconds = nonNegativeNumberValue(seconds);
      if (!parsedStartTime || readTimeSeconds === undefined) {
        return undefined;
      }

      return {
        startTime: parsedStartTime,
        readTimeSeconds
      };
    })
    .filter(isDefined)
    .sort((left, right) => left.startTime - right.startTime);
}

function mapWebPreviewReadingRankItems(value: unknown): ReadingRankItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(mapWebPreviewReadingRankItem).filter(isDefined);
}

function mapWebPreviewReadingRankItem(value: unknown): ReadingRankItem | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const album = asUnknownRecord(record.albumInfo);
  const book = asUnknownRecord(record.book);
  const source = album ?? book ?? record;
  const type: "album" | "book" = album ? "album" : "book";
  const title =
    firstDefinedString(source, ["title", "name", "albumName", "bookName"]) ??
    firstDefinedString(record, ["title", "name", "albumName", "bookName"]) ??
    (type === "album" ? "有声内容" : "未命名书籍");

  return {
    id:
      (type === "album"
        ? firstDefinedString(source, ["albumId", "id", "bookId"]) ??
          firstDefinedString(record, ["albumId", "id", "bookId"])
        : firstDefinedString(source, ["bookId", "id"]) ??
          firstDefinedString(record, ["bookId", "id"])) ?? title,
    title,
    author:
      firstDefinedString(source, ["author", "authorName"]) ??
      firstDefinedString(record, ["author", "authorName"]),
    cover:
      firstDefinedString(source, ["cover", "coverUrl"]) ??
      firstDefinedString(record, ["cover", "coverUrl"]),
    type,
    readTimeSeconds: nonNegativeNumberValue(record.readTime) ?? 0,
    tags: toStringArray(record.tags)
  };
}

function mapWebPreviewReadingCategories(value: unknown): ReadingCategory[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(mapWebPreviewReadingCategory).filter(isDefined);
}

function mapWebPreviewReadingCategory(value: unknown): ReadingCategory | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const title = firstDefinedString(record, ["categoryTitle", "title", "name"]);
  if (!title) {
    return undefined;
  }

  return {
    categoryId: stringValue(record.categoryId),
    title,
    parentTitle: firstDefinedString(record, ["parentCategoryTitle", "parentTitle"]),
    value: numberValue(record.val) ?? numberValue(record.value),
    readingTimeSeconds:
      nonNegativeNumberValue(record.readingTime) ??
      nonNegativeNumberValue(record.readingTimeSeconds),
    readingCount: nonNegativeNumberValue(record.readingCount)
  };
}

function createEmptyReadingStats(mode: ReadingStatsMode, baseTime?: number): ReadingStats {
  return {
    mode,
    baseTime: mode === "overall" ? 0 : normalizePreviewBaseTime(mode, baseTime),
    buckets: [],
    longestItems: [],
    categories: []
  };
}

function findWebPreviewReadingStatsReview(
  preview: WebReadingPreviewData,
  mode: ReadingStatsMode,
  baseTime?: number
): ReadingStatsAiReviewResponse | undefined {
  const normalizedBaseTime = normalizePreviewBaseTime(mode, baseTime);
  const scopeId = mode === "overall" ? "overall:0" : `${mode}:${normalizedBaseTime}`;
  const row =
    preview.reviewRows.find((review) => review.scopeId === scopeId) ??
    (normalizedBaseTime <= 0 ? selectLatestWebPreviewReviewRow(preview.reviewRows, mode) : undefined);
  if (!row) {
    return undefined;
  }

  const output = asUnknownRecord(parseRawJson(row.outputJson));
  const scope = parseWebPreviewScopeId(row.scopeId);
  const resolvedMode = scope?.mode ?? mode;
  const resolvedBaseTime = scope?.baseTime ?? normalizePreviewBaseTime(resolvedMode, baseTime);

  return {
    mode: resolvedMode,
    baseTime: resolvedBaseTime,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    providerModel: row.providerModel,
    source: "cache",
    review: {
      overview: stringValue(output?.overview) || "",
      rhythmInsights: toStringArray(output?.rhythmInsights),
      preferenceInsights: toStringArray(output?.preferenceInsights),
      focusItems: toStringArray(output?.focusItems),
      nextActions: toStringArray(output?.nextActions),
      readingPersona: normalizeReadingPersonaPatch(output?.readingPersona),
      sourceStats: normalizeWebPreviewReviewSourceStats(output?.sourceStats, resolvedMode, resolvedBaseTime),
      generatedAt: stringValue(output?.generatedAt) ?? row.createdAt ?? row.updatedAt ?? preview.exportedAt ?? "",
      promptVersion: stringValue(output?.promptVersion) ?? row.promptVersion,
      responseFormat: normalizeAiResponseFormat(output?.responseFormat),
      basisNotice: stringValue(output?.basisNotice) || "基于已导出的统计缓存，仅供 Web 预览。"
    },
    cachedUpdatedAt: row.updatedAt
  };
}

function selectLatestWebPreviewReviewRow(
  rows: WebReadingPreviewReviewRow[],
  mode: ReadingStatsMode
): WebReadingPreviewReviewRow | undefined {
  const currentAnchor = currentPreviewAnchor(mode);
  let matched: WebReadingPreviewReviewRow | undefined;
  let matchedBaseTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const scope = parseWebPreviewScopeId(row.scopeId);
    if (!scope || scope.mode !== mode || scope.baseTime > currentAnchor) {
      continue;
    }

    if (!matched || scope.baseTime > matchedBaseTime) {
      matched = row;
      matchedBaseTime = scope.baseTime;
    }
  }

  return matched;
}

function normalizeWebPreviewReviewSourceStats(
  value: unknown,
  mode: ReadingStatsMode,
  baseTime: number
) {
  const record = asUnknownRecord(value);

  return {
    mode: normalizeStatsMode(record?.mode) ?? mode,
    baseTime: Math.trunc(numberValue(record?.baseTime) ?? baseTime),
    readDays: nonNegativeNumberValue(record?.readDays),
    totalReadTimeSeconds: nonNegativeNumberValue(record?.totalReadTimeSeconds),
    dayAverageReadTimeSeconds: nonNegativeNumberValue(record?.dayAverageReadTimeSeconds),
    bucketCount: nonNegativeNumberValue(record?.bucketCount) ?? 0,
    longestItemCount: nonNegativeNumberValue(record?.longestItemCount) ?? 0,
    categoryCount: nonNegativeNumberValue(record?.categoryCount) ?? 0
  };
}

function parseWebPreviewScopeId(scopeId: string): { mode: ReadingStatsMode; baseTime: number } | undefined {
  const [rawMode, rawBaseTime] = scopeId.split(":");
  const mode = normalizeStatsMode(rawMode);
  const baseTime = Math.trunc(numberValue(rawBaseTime) ?? Number.NaN);
  if (!mode || !Number.isFinite(baseTime)) {
    return undefined;
  }

  return {
    mode,
    baseTime
  };
}

function normalizePreviewBaseTime(mode: ReadingStatsMode, baseTime?: number): number {
  if (mode === "overall") {
    return 0;
  }

  const value = Math.trunc(numberValue(baseTime) ?? 0);
  return value > 0 ? value : 0;
}

function currentPreviewAnchor(mode: ReadingStatsMode): number {
  if (mode === "overall") {
    return 0;
  }

  const now = new Date();
  if (mode === "annually") {
    return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  }

  if (mode === "monthly") {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }

  const weekDay = now.getDay();
  const mondayOffset = weekDay === 0 ? -6 : 1 - weekDay;
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset).getTime() / 1000
  );
}

function buildPreviewPeriodIdentity(mode: ReadingStatsMode, baseTime: number): string {
  if (mode === "overall" || baseTime <= 0) {
    return `${mode}:0`;
  }

  const date = new Date(baseTime * 1000);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (mode === "annually") {
    return `${mode}:${year}`;
  }

  if (mode === "monthly") {
    return `${mode}:${year}-${month}`;
  }

  return `${mode}:${year}-${month}-${day}`;
}

function normalizePreviewSyncState(value: unknown): SyncState | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const section = stringValue(record.section);
  if (!section) {
    return undefined;
  }

  return normalizeSyncState({
    section: section as SyncState["section"],
    status: (stringValue(record.status) || "idle") as SyncState["status"],
    lastSuccessAt: stringValue(record.lastSuccessAt),
    lastAttemptAt: stringValue(record.lastAttemptAt),
    errorCode: stringValue(record.errorCode),
    errorMessage: stringValue(record.errorMessage)
  });
}

function normalizeAiResponseFormat(value: unknown): "json_schema" | "json_object" | undefined {
  if (value === "json_schema" || value === "json_object") {
    return value;
  }

  return undefined;
}

function normalizeReadingPersonaPatch(value: unknown): ReadingPersonaPatch | undefined {
  const record = asUnknownRecord(value);
  if (!record) {
    return undefined;
  }

  const summary = stringValue(record.summary);
  const suggestion = stringValue(record.suggestion);
  if (!summary && !suggestion) {
    return undefined;
  }

  return {
    summary,
    suggestion
  };
}

function hasTauriRuntime(): boolean {
  const runtime = globalThis as Record<string, unknown>;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__);
}

function createMissingWebPreviewDataError(section: string): Error {
  return new Error(`Web 预览未找到${section}预览数据，请先运行 npm run export:reading-preview-data。`);
}

export function getCommandErrorMessage(error: unknown): string {
  const info = getCommandErrorInfo(error);
  return info.detail && info.detail !== info.message
    ? `${info.message} 诊断：${info.detail}`
    : info.message;
}

export function getCommandErrorInfo(error: unknown): CommandErrorInfo {
  if (typeof error === "string" && error.trim()) {
    return { message: error };
  }

  if (isObject(error)) {
    const code = stringValue(error.code);
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      if (isTauriRuntimeMessage(message)) {
        return {
          code,
          message: "本地命令调用失败，请确认应用在桌面环境中运行。"
        };
      }

      const detail = stringValue((error as { detail?: unknown }).detail);
      return {
        code,
        message,
        detail: detail || undefined
      };
    }
  }

  return { message: "本地命令调用失败，请确认应用在桌面环境中运行。" };
}

export function isUpgradeRequiredError(error: unknown): boolean {
  return getCommandErrorInfo(error).code === "upgrade_required";
}

function isTauriRuntimeMessage(message: string): boolean {
  return (
    message.includes("__TAURI__") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("reading 'invoke'") ||
    message.includes("window.__TAURI__")
  );
}

function mapBookshelfResponse(response: BookshelfResponseRecord): BookshelfResponse {
  const snapshot = response.snapshot ?? {};
  const entries = (snapshot.entries ?? []).map(mapShelfEntry);

  return {
    snapshot: {
      entries,
      archives: (snapshot.archives ?? []).map(mapShelfArchive),
      summary: mapSummary(snapshot.summary, entries)
    },
    syncState: normalizeSyncState(response.syncState)
  };
}

function mapReadingItemState(record: ReadingItemStateRecord): ReadingItemState | undefined {
  const itemId = stringValue(record.itemId);
  if (!itemId) {
    return undefined;
  }

  return {
    itemId,
    itemType: normalizeReadingItemStateType(record.itemType),
    status: normalizeReadingItemStatus(record.status),
    title: stringValue(record.title),
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    category: stringValue(record.category),
    note: stringValue(record.note),
    createdAt: stringValue(record.createdAt) || "",
    updatedAt: stringValue(record.updatedAt) || ""
  };
}

function mapShelfEntry(record: ShelfEntryRecord): ShelfEntry {
  const type = normalizeEntryType(record.type);

  return {
    id: stringValue(record.id) || `${type}-${crypto.randomUUID()}`,
    type,
    title: stringValue(record.title) || fallbackTitle(type),
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    category: stringValue(record.category),
    isTop: booleanValue(record.isTop),
    isSecret: booleanValue(record.isSecret),
    isFinished:
      record.isFinished === undefined || record.isFinished === null
        ? undefined
        : booleanValue(record.isFinished),
    lastReadAt: numberValue(record.lastReadAt),
    raw: parseRawJson(record.rawJson)
  };
}

function mapShelfArchive(record: ShelfArchiveRecord): ShelfArchive {
  return {
    id: stringValue(record.id) || `archive-${crypto.randomUUID()}`,
    name: stringValue(record.name) || "未命名书单",
    bookIds: toStringArray(record.bookIds),
    matchedEntryCount: Math.max(0, numberValue(record.matchedEntryCount) ?? 0),
    missingBookCount: Math.max(0, numberValue(record.missingBookCount) ?? 0),
    raw: parseRawJson(record.rawJson)
  };
}

function mapSummary(
  summary: BookshelfSummaryRecord | undefined,
  entries: ShelfEntry[]
): BookshelfSummary {
  const bookCount =
    numberValue(summary?.bookCount) ?? entries.filter((entry) => entry.type === "book").length;
  const albumCount =
    numberValue(summary?.albumCount) ?? entries.filter((entry) => entry.type === "album").length;
  const mpCount: 0 | 1 =
    (numberValue(summary?.mpCount) ??
      (entries.some((entry) => entry.type === "mp") ? 1 : 0)) > 0
      ? 1
      : 0;
  const secretCount =
    numberValue(summary?.secretCount) ?? entries.filter((entry) => entry.isSecret).length;

  return {
    totalVisibleEntries:
      numberValue(summary?.totalVisibleEntries) ?? bookCount + albumCount + mpCount,
    bookCount,
    albumCount,
    mpCount,
    publicCount: numberValue(summary?.publicCount) ?? entries.length - secretCount,
    secretCount
  };
}

function mapBookDetailResponse(bookId: string, response: BookDetailResponseRecord): BookDetailResponse {
  const detail = mapBookDetail(bookId, response.detail);
  const progress = mapReadingProgress(detail.bookId, response.progress);

  return {
    detail,
    progress,
    chapters: (response.chapters ?? []).map((chapter) => mapChapter(detail.bookId, chapter)),
    deepLink: stringValue(response.deepLink) || ""
  };
}

function mapNotebookOverviewResponse(
  response: NotebookOverviewResponseRecord
): NotebookOverviewResponse {
  const books = (response.books ?? []).map((book, index) => mapNotebookBook(book, index));
  const totalNoteCount =
    numberValue(response.summary?.totalNoteCount) ??
    books.reduce((total, book) => total + book.totalNoteCount, 0);

  return {
    books,
    summary: {
      totalBookCount: numberValue(response.summary?.totalBookCount) ?? books.length,
      totalNoteCount
    },
    syncState: normalizeSyncState(response.syncState)
  };
}

function mapBookNotesResponse(bookId: string, response: BookNotesResponseRecord): BookNotes {
  const normalizedBookId = stringValue(response.bookId) || bookId;
  const book = response.book ? mapNotebookBook(response.book, 0) : undefined;
  const highlights = (response.highlights ?? []).map((highlight) =>
    mapHighlight(normalizedBookId, highlight)
  );
  const thoughts = (response.thoughts ?? []).map((thought) =>
    mapThought(normalizedBookId, thought)
  );

  return {
    bookId: normalizedBookId,
    book,
    highlights,
    thoughts,
    chapters: (response.chapters ?? []).map((chapter) => mapChapter(normalizedBookId, chapter)),
    chapterGroups: (response.chapterGroups ?? []).map((group) =>
      mapChapterNoteGroup(normalizedBookId, group)
    ),
    bookmarkCount: numberValue(response.bookmarkCount) ?? book?.bookmarkCount ?? 0,
    exportableCount: numberValue(response.exportableCount) ?? highlights.length + thoughts.length,
    bookmarkContentNotice:
      stringValue(response.bookmarkContentNotice) ||
      "当前微信读书接口只提供书签数量，不提供书签内容；导出仅包含划线和想法/点评。"
  };
}

function mapBulkExportPreflight(response: BulkExportPreflightRecord): BulkExportPreflight {
  const items = (response.items ?? []).map(mapBulkExportPreflightItem);

  return {
    totalBooks: numberValue(response.totalBooks) ?? items.length,
    readyCount:
      numberValue(response.readyCount) ??
      items.filter((item) => item.status === "ready").length,
    needsSyncCount:
      numberValue(response.needsSyncCount) ??
      items.filter((item) => item.status === "needsSync").length,
    noContentCount:
      numberValue(response.noContentCount) ??
      items.filter((item) => item.status === "noContent").length,
    cachedAiReviewCount:
      numberValue(response.cachedAiReviewCount) ??
      items.filter((item) => item.hasCachedAiReview).length,
    items
  };
}

function mapBulkExportPreflightItem(
  record: BulkExportPreflightItemRecord
): BulkExportPreflightItem {
  const bookId = stringValue(record.bookId) || `bulk-export-${crypto.randomUUID()}`;

  return {
    bookId,
    title: stringValue(record.title) || "未命名书籍",
    author: stringValue(record.author),
    totalNoteCount: Math.max(0, numberValue(record.totalNoteCount) ?? 0),
    cachedExportableCount: Math.max(0, numberValue(record.cachedExportableCount) ?? 0),
    hasCachedNotes: booleanValue(record.hasCachedNotes),
    hasCachedAiReview: booleanValue(record.hasCachedAiReview),
    status: normalizeBulkExportItemStatus(record.status),
    reason: stringValue(record.reason) || "等待导出。"
  };
}

function mapBulkExportResponse(
  fallbackStrategy: BulkExportStrategy,
  response: BulkExportResponseRecord
): BulkExportResponse {
  const report = mapBulkExportReport(fallbackStrategy, response.report);

  return {
    exportId: stringValue(response.exportId) || "wxreadmaster-bulk-export",
    path: stringValue(response.path) || "",
    exportedAt: stringValue(response.exportedAt) || report.exportedAt,
    files: (response.files ?? []).map(stringValue).filter(isDefined),
    report
  };
}

function mapBulkExportReport(
  fallbackStrategy: BulkExportStrategy,
  record: BulkExportReportRecord = {}
): BulkExportReport {
  return {
    exportedAt: stringValue(record.exportedAt) || "",
    strategy: normalizeBulkExportStrategy(record.strategy) ?? fallbackStrategy,
    concurrency: Math.max(1, Math.min(3, numberValue(record.concurrency) ?? 2)),
    items: (record.items ?? []).map(mapBulkExportResultItem)
  };
}

function mapBulkExportResultItem(record: BulkExportResultItemRecord): BulkExportResultItem {
  return {
    bookId: stringValue(record.bookId) || `bulk-export-result-${crypto.randomUUID()}`,
    title: stringValue(record.title) || "未命名书籍",
    status: normalizeBulkExportItemStatus(record.status),
    notesFile: stringValue(record.notesFile),
    aiReviewFile: stringValue(record.aiReviewFile),
    reason: stringValue(record.reason) || "已记录导出结果。"
  };
}

function mapReadingStatsResponse(
  fallbackMode: ReadingStatsMode,
  response: ReadingStatsResponseRecord
): ReadingStatsResponse {
  return {
    stats: mapReadingStats(fallbackMode, response.stats),
    syncState: normalizeSyncState(response.syncState),
    source: normalizeReadingStatsResponseSource(response.source) ?? "cache"
  };
}

function normalizeReadingStatsResponseSource(value: unknown): ReadingStatsResponseSource | undefined {
  if (value === "cache" || value === "synced" || value === "empty") {
    return value;
  }

  return undefined;
}

function mapSearchBooksResponse(
  fallbackScope: SearchScope,
  response: SearchBooksResponseRecord
): SearchBooksResponse {
  const result = response.result ?? {};
  const groups = (result.groups ?? []).map(mapSearchGroup).filter(isDefined);
  const groupedResults = groups.flatMap((group) => group.books);
  const fallbackResults = (result.results ?? []).map(mapDiscoveryBook).filter(isDefined);
  const results = fallbackResults.length > 0 ? fallbackResults : groupedResults;

  return {
    result: {
      sid: stringValue(result.sid),
      scope: normalizeSearchScope(result.scope) ?? fallbackScope,
      hasMore: booleanValue(result.hasMore),
      nextMaxIdx: numberValue(result.nextMaxIdx) ?? nextSearchIndex(results),
      groups,
      results
    },
    syncState: normalizeSyncState(response.syncState)
  };
}

function mapRecommendationsResponse(
  response: RecommendationsResponseRecord
): RecommendationsResponse {
  const result = response.result ?? {};
  const books = (result.books ?? []).map(mapDiscoveryBook).filter(isDefined);

  return {
    result: {
      books: books.map((book) => book as Recommendation),
      hasMore: booleanValue(result.hasMore),
      nextMaxIdx: numberValue(result.nextMaxIdx) ?? nextSearchIndex(books)
    },
    syncState: normalizeSyncState(response.syncState)
  };
}

function mapSimilarBooksResponse(response: SimilarBooksResponseRecord): SimilarBooksResponse {
  const result = response.result ?? {};
  const books = (result.books ?? []).map(mapDiscoveryBook).filter(isDefined);

  return {
    result: {
      sessionId: stringValue(result.sessionId),
      books: books.map((book) => book as Recommendation),
      hasMore: booleanValue(result.hasMore),
      nextMaxIdx: numberValue(result.nextMaxIdx) ?? nextSearchIndex(books)
    },
    syncState: normalizeSyncState(response.syncState)
  };
}

async function invokeSettingsCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          "本地设置保存超时，请重试；如果在 Android 上反复出现，请完全退出应用后再打开。"
        )
      );
    }, SETTINGS_COMMAND_TIMEOUT_MS);
  });

  try {
    const commandPromise =
      args === undefined ? invoke<T>(command) : invoke<T>(command, args);
    return await Promise.race([commandPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function mapSettingsState(response: SettingsStateResponseRecord): SettingsState {
  const tableCounts = (response.localData?.tableCounts ?? []).map((record) => ({
    table: stringValue(record.table) || "unknown",
    rowCount: Math.max(0, numberValue(record.rowCount) ?? 0)
  }));

  return {
    credential: response.credential ?? {
      hasCredential: false
    },
    credentialError: mapSettingsCredentialError(response.credentialError),
    syncStates: (response.syncStates ?? []).map(normalizeSyncState).filter(isDefined),
    localData: {
      dataDir: stringValue(response.localData?.dataDir) || "",
      defaultDataDir: stringValue(response.localData?.defaultDataDir) || "",
      databasePath: stringValue(response.localData?.databasePath) || "",
      databaseSizeBytes: Math.max(0, numberValue(response.localData?.databaseSizeBytes) ?? 0),
      cacheRowCount:
        numberValue(response.localData?.cacheRowCount) ??
        tableCounts.reduce((total, item) => total + item.rowCount, 0),
      isCustomDataDir: booleanValue(response.localData?.isCustomDataDir),
      lastDataOperationError: stringValue(response.localData?.lastDataOperationError),
      tableCounts
    },
    exportData: {
      exportDir: stringValue(response.exportData?.exportDir) || "",
      defaultExportDir: stringValue(response.exportData?.defaultExportDir) || "",
      isCustomExportDir: booleanValue(response.exportData?.isCustomExportDir)
    },
    network: {
      wereadProxyUrl: stringValue(response.network?.wereadProxyUrl),
      isCustomWereadProxy: booleanValue(response.network?.isCustomWereadProxy)
    },
    appVersion: stringValue(response.appVersion) || "0.1.0",
    supportsNativeUpdater: booleanValue(response.supportsNativeUpdater)
  };
}

function mapSettingsCredentialError(
  error: SettingsStateResponseRecord["credentialError"]
): SettingsCredentialError | undefined {
  if (!error) {
    return undefined;
  }

  const message = stringValue(error.message);
  if (!message) {
    return undefined;
  }

  return {
    code: stringValue(error.code) || "credential_storage_error",
    message,
    detail: stringValue(error.detail)
  };
}

function mapSearchGroup(record: SearchGroupRecord): SearchGroup | undefined {
  const books = (record.books ?? []).map(mapDiscoveryBook).filter(isDefined);

  if (books.length === 0) {
    return undefined;
  }

  return {
    title: stringValue(record.title) || "搜索结果",
    scope: normalizeSearchScope(record.scope),
    scopeCount: numberValue(record.scopeCount),
    currentCount: numberValue(record.currentCount) ?? books.length,
    books
  };
}

function mapDiscoveryBook(record: DiscoveryBookRecord): Recommendation | undefined {
  const bookId = stringValue(record.bookId);

  if (!bookId) {
    return undefined;
  }

  return {
    bookId,
    title: stringValue(record.title) || "未命名书籍",
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    intro: stringValue(record.intro),
    category: stringValue(record.category),
    publisher: stringValue(record.publisher),
    ratingPercent: numberValue(record.ratingPercent),
    ratingCount: numberValue(record.ratingCount),
    ratingTitle: stringValue(record.ratingTitle),
    readingCount: numberValue(record.readingCount),
    soldout:
      record.soldout === undefined || record.soldout === null
        ? undefined
        : booleanValue(record.soldout),
    searchIdx: numberValue(record.searchIdx),
    deepLink: stringValue(record.deepLink),
    reason: stringValue(record.reason)
  };
}

function mapReadingStats(fallbackMode: ReadingStatsMode, record: ReadingStatsRecord = {}): ReadingStats {
  const mode = normalizeStatsMode(record.mode) ?? fallbackMode;
  const buckets = (record.buckets ?? []).map(mapReadingBucket).filter(isDefined);
  const longestItems = (record.longestItems ?? []).map(mapReadingRankItem).filter(isDefined);
  const categories = (record.categories ?? []).map(mapReadingCategory).filter(isDefined);

  return {
    mode,
    baseTime: numberValue(record.baseTime) ?? (mode === "overall" ? 0 : 0),
    readDays: numberValue(record.readDays),
    totalReadTimeSeconds: numberValue(record.totalReadTimeSeconds),
    dayAverageReadTimeSeconds: numberValue(record.dayAverageReadTimeSeconds),
    compare: numberValue(record.compare),
    buckets,
    longestItems,
    categories,
    raw: record.raw
  };
}

function mapReadingBucket(record: ReadingTimeBucketRecord): ReadingTimeBucket | undefined {
  const startTime = numberValue(record.startTime);
  const readTimeSeconds = numberValue(record.readTimeSeconds);

  if (startTime === undefined || readTimeSeconds === undefined) {
    return undefined;
  }

  return {
    startTime,
    readTimeSeconds: Math.max(0, readTimeSeconds)
  };
}

function mapReadingRankItem(record: ReadingRankItemRecord): ReadingRankItem | undefined {
  const title = stringValue(record.title);

  if (!title) {
    return undefined;
  }

  return {
    id: stringValue(record.id) || `${normalizeRankType(record.type)}-${title}`,
    title,
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    type: normalizeRankType(record.type),
    readTimeSeconds: Math.max(0, numberValue(record.readTimeSeconds) ?? 0),
    tags: (record.tags ?? []).map(stringValue).filter(isDefined)
  };
}

function mapReadingCategory(record: ReadingCategoryRecord): ReadingCategory | undefined {
  const title = stringValue(record.title);

  if (!title) {
    return undefined;
  }

  return {
    categoryId: stringValue(record.categoryId),
    title,
    parentTitle: stringValue(record.parentTitle),
    value: numberValue(record.value),
    readingTimeSeconds: numberValue(record.readingTimeSeconds),
    readingCount: numberValue(record.readingCount)
  };
}

function mapBookDetail(bookId: string, record: BookDetailRecord = {}): BookDetail {
  const normalizedBookId = stringValue(record.bookId) || bookId;

  return {
    bookId: normalizedBookId,
    title: stringValue(record.title) || "未命名书籍",
    author: stringValue(record.author),
    translator: stringValue(record.translator),
    cover: stringValue(record.cover),
    intro: stringValue(record.intro),
    category: stringValue(record.category),
    publisher: stringValue(record.publisher),
    publishTime: stringValue(record.publishTime),
    isbn: stringValue(record.isbn),
    wordCount: numberValue(record.wordCount),
    ratingPercent: numberValue(record.ratingPercent),
    ratingCount: numberValue(record.ratingCount)
  };
}

function mapReadingProgress(bookId: string, record: ReadingProgressRecord = {}): ReadingProgress {
  const progressPercent = clampPercent(numberValue(record.progressPercent) ?? 0);

  return {
    bookId: stringValue(record.bookId) || bookId,
    chapterUid: numberValue(record.chapterUid),
    chapterOffset: numberValue(record.chapterOffset),
    progressPercent,
    updatedAt: numberValue(record.updatedAt),
    recordReadingTimeSeconds: numberValue(record.recordReadingTimeSeconds),
    finishTime: numberValue(record.finishTime),
    isStarted: booleanValue(record.isStarted) || progressPercent > 0,
    isFinished: booleanValue(record.isFinished)
  };
}

function mapChapter(bookId: string, record: ChapterRecord): Chapter {
  return {
    bookId: stringValue(record.bookId) || bookId,
    chapterUid: numberValue(record.chapterUid) ?? 0,
    chapterIdx: numberValue(record.chapterIdx) ?? 0,
    title: stringValue(record.title) || "未命名章节",
    wordCount: numberValue(record.wordCount),
    level: numberValue(record.level) ?? 1,
    price: numberValue(record.price),
    paid:
      record.paid === undefined || record.paid === null ? undefined : booleanValue(record.paid),
    isMPChapter:
      record.isMPChapter === undefined && record.isMpChapter === undefined
        ? undefined
        : booleanValue(record.isMPChapter ?? record.isMpChapter)
  };
}

function mapNotebookBook(record: NotebookBookRecord, index: number): NotebookBook {
  const reviewCount = numberValue(record.reviewCount) ?? 0;
  const noteCount = numberValue(record.noteCount) ?? 0;
  const bookmarkCount = numberValue(record.bookmarkCount) ?? 0;

  return {
    bookId: stringValue(record.bookId) || `notebook-book-${index}`,
    title: stringValue(record.title) || "未命名书籍",
    author: stringValue(record.author),
    cover: stringValue(record.cover),
    reviewCount,
    noteCount,
    bookmarkCount,
    totalNoteCount:
      numberValue(record.totalNoteCount) ??
      calculateTotalNotes({ reviewCount, noteCount, bookmarkCount }),
    readingProgress: numberValue(record.readingProgress),
    markedStatus: numberValue(record.markedStatus),
    sort: numberValue(record.sort)
  };
}

function mapHighlight(bookId: string, record: HighlightRecord): Highlight {
  return {
    bookmarkId: stringValue(record.bookmarkId) || `${bookId}-highlight-${crypto.randomUUID()}`,
    bookId: stringValue(record.bookId) || bookId,
    chapterUid: numberValue(record.chapterUid),
    chapterTitle: stringValue(record.chapterTitle),
    markText: stringValue(record.markText) || "空划线",
    createTime: numberValue(record.createTime),
    range: stringValue(record.range),
    deepLink: stringValue(record.deepLink)
  };
}

function mapThought(bookId: string, record: ThoughtRecord): Thought {
  return {
    reviewId: stringValue(record.reviewId) || `${bookId}-thought-${crypto.randomUUID()}`,
    bookId: stringValue(record.bookId) || bookId,
    content: stringValue(record.content) || "空想法",
    abstractText: stringValue(record.abstractText),
    createTime: numberValue(record.createTime),
    star: numberValue(record.star),
    chapterName: stringValue(record.chapterName),
    chapterUid: numberValue(record.chapterUid),
    range: stringValue(record.range),
    deepLink: stringValue(record.deepLink),
    isFinish:
      record.isFinish === undefined || record.isFinish === null
        ? undefined
        : booleanValue(record.isFinish)
  };
}

function mapChapterNoteGroup(bookId: string, record: ChapterNoteGroupRecord): ChapterNoteGroup {
  return {
    chapterUid: numberValue(record.chapterUid),
    title: stringValue(record.title) || "未分章节",
    highlights: (record.highlights ?? []).map((highlight) => mapHighlight(bookId, highlight)),
    thoughts: (record.thoughts ?? []).map((thought) => mapThought(bookId, thought))
  };
}

function normalizeSyncState(syncState?: SyncState): SyncState | undefined {
  if (!syncState) {
    return undefined;
  }

  return {
    section: syncState.section,
    status: normalizeSyncStatus(syncState.status),
    lastSuccessAt: syncState.lastSuccessAt,
    lastAttemptAt: syncState.lastAttemptAt,
    errorCode: syncState.errorCode,
    errorMessage: syncState.errorMessage
  };
}

function normalizeSyncStatus(status: string): SyncStatus {
  if (status === "syncing" || status === "success" || status === "failed") {
    return status;
  }

  return "idle";
}

function normalizeStatsMode(value: unknown): ReadingStatsMode | undefined {
  if (value === "weekly" || value === "monthly" || value === "annually" || value === "overall") {
    return value;
  }

  return undefined;
}

function normalizeSearchScope(value: unknown): SearchScope | undefined {
  if (
    value === 0 ||
    value === 2 ||
    value === 4 ||
    value === 6 ||
    value === 10 ||
    value === 12 ||
    value === 13 ||
    value === 14 ||
    value === 16
  ) {
    return value;
  }

  return undefined;
}

function normalizeBulkExportStrategy(value: unknown): BulkExportStrategy | undefined {
  if (
    value === "localCachedOnly" ||
    value === "syncMissingNotes" ||
    value === "selectedBooksOnly"
  ) {
    return value;
  }

  return undefined;
}

function normalizeBulkExportItemStatus(value: unknown): BulkExportItemStatus {
  if (
    value === "ready" ||
    value === "needsSync" ||
    value === "noContent" ||
    value === "skipped" ||
    value === "failed" ||
    value === "exported" ||
    value === "canceled"
  ) {
    return value;
  }

  return "skipped";
}

function normalizeRankType(value: unknown): "book" | "album" {
  return value === "album" ? "album" : "book";
}

function normalizeEntryType(value: unknown): ShelfEntryType {
  if (value === "album" || value === "mp") {
    return value;
  }

  return "book";
}

function normalizeReadingItemStateType(value: unknown): ReadingItemStateType {
  if (value === "album" || value === "mp" || value === "candidate") {
    return value;
  }

  return "book";
}

function normalizeReadingItemStatus(value: unknown): ReadingItemStatus {
  if (value === "reading" || value === "reviewing" || value === "organized") {
    return value;
  }

  return "toRead";
}

function fallbackTitle(type: ShelfEntryType): string {
  if (type === "album") {
    return "未命名有声书";
  }

  if (type === "mp") {
    return "文章收藏";
  }

  return "未命名书籍";
}

function parseRawJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function firstDefinedString(
  value: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!value) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = stringValue(value[key]);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(isDefined) : [];
}

function parseStringArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return toStringArray(value);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    return toStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function nonNegativeNumberValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : Math.max(0, parsed);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function nextSearchIndex(results: SearchResult[]): number | undefined {
  const indexes = results.map((result) => result.searchIdx).filter(isDefined);
  return indexes.length > 0 ? Math.max(...indexes) : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
