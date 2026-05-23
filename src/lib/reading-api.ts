import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import type {
  AiCachedOutputRecord,
  AIAssetDetail,
  AIAssetVersionDetail,
  AIAssetVersionSummary,
  AIAssetSummary,
  AiCredentialValidationResult,
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
  SettingsState,
  SaveExportDirectoryResult,
  ShelfEntry,
  ShelfEntryType,
  SimilarBooksResult,
  SyncState,
  SyncStatus,
  RestoreBackupResult,
  ResetExportDirectoryResult,
  AppUpdateStatus,
  Thought
} from "./types";
import { calculateTotalNotes } from "./business-rules";

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

type BookshelfResponseRecord = {
  snapshot?: {
    entries?: ShelfEntryRecord[];
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
  syncStates?: SyncState[];
  localData?: Partial<LocalDataState>;
  exportData?: {
    exportDir?: unknown;
    defaultExportDir?: unknown;
    isCustomExportDir?: unknown;
  };
  appVersion?: unknown;
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
};

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
  return invoke<AiSettingsState>("get_ai_settings_state");
}

export async function validateAiCredential({
  apiKey,
  baseUrl,
  model
}: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<AiCredentialValidationResult> {
  return invoke<AiCredentialValidationResult>("validate_ai_credential", {
    apiKey,
    baseUrl,
    model
  });
}

export async function saveAiCredential({
  apiKey,
  baseUrl,
  model
}: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<AiSettingsState> {
  return invoke<AiSettingsState>("save_ai_credential", { apiKey, baseUrl, model });
}

export async function saveAiSettings({
  apiKey,
  baseUrl,
  model
}: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<AiSettingsState> {
  return invoke<AiSettingsState>("save_ai_settings", { apiKey, baseUrl, model });
}

export async function testAiConnection({
  apiKey,
  baseUrl,
  model
}: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<AiCredentialValidationResult> {
  return invoke<AiCredentialValidationResult>("test_ai_connection", { apiKey, baseUrl, model });
}

export async function removeAiCredential(confirm: boolean): Promise<AiSettingsState> {
  return invoke<AiSettingsState>("remove_ai_credential", { confirm });
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
  return invoke<ExportAiMarkdownResponse>("export_reading_stats_review_markdown", {
    mode,
    baseTime
  });
}

export async function summarizeReadingRoute({
  request,
  regenerate = false
}: {
  request: ReadingRouteRequest;
  regenerate?: boolean;
}): Promise<ReadingRouteResponse> {
  return invoke<ReadingRouteResponse>("summarize_reading_route", { request, regenerate });
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
  return invoke<CredentialStatus>("get_credential_status");
}

export async function validateCredential(apiKey: string): Promise<CredentialValidationResult> {
  return invoke<CredentialValidationResult>("validate_credential", { apiKey });
}

export async function saveCredential(apiKey: string): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("save_credential", { apiKey });
}

export async function removeCredential(confirm: boolean): Promise<CredentialStatus> {
  return invoke<CredentialStatus>("remove_credential", { confirm });
}

export async function getBookshelf(): Promise<BookshelfResponse> {
  const response = await invoke<BookshelfResponseRecord>("get_bookshelf");
  return mapBookshelfResponse(response);
}

export async function syncShelf(): Promise<BookshelfResponse> {
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
  const response = await invoke<ReadingStatsResponseRecord>("sync_reading_stats", {
    mode,
    baseTime
  });
  return mapReadingStatsResponse(mode, response);
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
  const response = await invoke<SettingsStateResponseRecord>("get_settings_state");
  return mapSettingsState(response);
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  const currentState = await getSettingsState();
  const update = await check();

  if (!update) {
    return {
      available: false,
      currentVersion: currentState.appVersion
    };
  }

  return {
    available: true,
    currentVersion: currentState.appVersion,
    latestVersion: update.version,
    notes: update.body,
    publishedAt: update.date
  };
}

export async function downloadAndInstallAppUpdate(): Promise<void> {
  const update = await check();

  if (!update) {
    return;
  }

  await update.downloadAndInstall();
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
  const response = await invoke<SaveExportDirectoryResponseRecord>("save_custom_export_directory", {
    targetDir
  });

  return {
    path: stringValue(response.path) || targetDir,
    state: mapSettingsState(response.state ?? {})
  };
}

export async function resetCustomExportDirectory(): Promise<ResetExportDirectoryResult> {
  const response = await invoke<ResetExportDirectoryResponseRecord>("reset_custom_export_directory");

  return {
    state: mapSettingsState(response.state ?? {})
  };
}

export function getCommandErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (isObject(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      if (isTauriRuntimeMessage(message)) {
        return "本地命令调用失败，请确认应用在桌面环境中运行。";
      }

      return message;
    }
  }

  return "本地命令调用失败，请确认应用在桌面环境中运行。";
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
    deepLink: stringValue(response.deepLink) || `weread://reading?bId=${detail.bookId}`
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
    syncState: normalizeSyncState(response.syncState)
  };
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

function mapSettingsState(response: SettingsStateResponseRecord): SettingsState {
  const tableCounts = (response.localData?.tableCounts ?? []).map((record) => ({
    table: stringValue(record.table) || "unknown",
    rowCount: Math.max(0, numberValue(record.rowCount) ?? 0)
  }));

  return {
    credential: response.credential ?? {
      hasCredential: false
    },
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
    appVersion: stringValue(response.appVersion) || "0.1.0"
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

function isObject(value: unknown): value is { message?: unknown } {
  return typeof value === "object" && value !== null;
}
