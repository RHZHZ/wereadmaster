export type CredentialStatus = {
  hasCredential: boolean;
  lastValidatedAt?: string;
  lastValidationError?: string;
};

export type CredentialValidationResult = {
  isValid: boolean;
  checkedAt: string;
  message?: string;
};

export type AiCredentialStatus = {
  hasCredential: boolean;
  lastValidatedAt?: string;
  lastValidationError?: string;
};

export type AiCredentialValidationResult = {
  isValid: boolean;
  checkedAt: string;
  message?: string;
};

export type AiProviderSettings = {
  baseUrl: string;
  model: string;
};

export type AiSettingsState = {
  credential: AiCredentialStatus;
  provider: AiProviderSettings;
};

export type AiCachedOutputRecord = {
  feature: string;
  scopeId: string;
  promptVersion: string;
  inputHash: string;
  output: unknown;
  sourceCount?: number;
  providerModel?: string;
  createdAt: string;
  updatedAt: string;
};

export type BookAiSummarySourceStats = {
  highlightCount: number;
  thoughtCount: number;
  bookmarkCount: number;
  chapterCount: number;
  includedHighlightCount: number;
  includedThoughtCount: number;
};

export type BookAiSummary = {
  overview: string;
  keyIdeas: string[];
  myFocus: string[];
  actionItems: string[];
  themeTags: string[];
  representativeQuotes: BookAiRepresentativeQuote[];
  reflectionQuestions: string[];
  readingStage?: {
    stage: AIAssetReadingStage;
    label: string;
    progressPercent: number;
    refreshReason?: AIAssetRefreshReason;
  };
  sourceStats: BookAiSummarySourceStats;
  generatedAt: string;
  promptVersion: string;
  responseFormat?: AiResponseFormatKind;
  basisNotice: string;
};

export type BookAiRepresentativeQuote = {
  quote: string;
  reason: string;
  chapter?: string;
  noteType: string;
};

export type BookAiSummarySource = "cache" | "generated" | "staleCache" | "empty";
export type AiResponseFormatKind = "json_schema" | "json_object";

export type BookAiSummaryResponse = {
  bookId: string;
  promptVersion: string;
  inputHash: string;
  providerModel?: string;
  source: BookAiSummarySource;
  summary: BookAiSummary;
  cachedUpdatedAt?: string;
  errorMessage?: string;
};

export type AiFeedbackExportRecord = {
  status: "todo" | "completed" | "skipped" | "notApplicable";
  note?: string;
  updatedAt: string;
};

export type AiReviewFeedbackExport = {
  actionItems: Record<string, AiFeedbackExportRecord>;
  reflectionQuestions: Record<string, AiFeedbackExportRecord>;
};

export type AiReviewFeedbackFeature = AssetVersionFeature;

export type BookAiSummaryListItem = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  overview: string;
  cachedUpdatedAt: string;
  providerModel?: string;
  feedbackCount: number;
};

export type AIAssetRefreshState = "none" | "suggested";

export type AIAssetRefreshReason = "stage_changed" | "notes_changed" | "stalled" | "completed";

export type AIAssetReadingStage = "starting" | "framing" | "deepening" | "closing" | "completed";

export type AIAssetSummary = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  progress?: number;
  readingStage?: AIAssetReadingStage;
  readingStageLabel?: string;
  localStatus?: ReadingItemStatus;
  hasSingleGuide: boolean;
  crossRouteCount: number;
  hasBookReview: boolean;
  refreshState: AIAssetRefreshState;
  refreshReason?: AIAssetRefreshReason;
  updatedAt?: string;
};

export type AssetVersionFeature = "reading-route" | "book-review";

export type AssetVersionRef = {
  feature: AssetVersionFeature;
  scopeId: string;
  inputHash: string;
  promptVersion: string;
  generatedAt: string;
  updatedAt: string;
  source: BookAiSummarySource;
  title?: string;
  providerModel?: string;
};

export type AIAssetDetail = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  progress?: number;
  readingStage?: AIAssetReadingStage;
  readingStageLabel?: string;
  localStatus?: ReadingItemStatus;
  refreshState: AIAssetRefreshState;
  refreshReason?: AIAssetRefreshReason;
  currentGuide?: AssetVersionRef;
  mainCrossRoutes: AssetVersionRef[];
  participantCrossRoutes: AssetVersionRef[];
  currentBookReview?: AssetVersionRef;
};

export type AIAssetVersionDetail = {
  feature: AssetVersionFeature;
  scopeId: string;
  inputHash: string;
  promptVersion: string;
  generatedAt: string;
  updatedAt: string;
  source: BookAiSummarySource;
  title?: string;
  providerModel?: string;
  readingStage?: AIAssetReadingStage;
  readingStageLabel?: string;
  progress?: number;
  refreshReason?: AIAssetRefreshReason;
  basisNotice: string;
  sourceStats: Record<string, unknown>;
  readingRoute?: ReadingRoute;
  bookSummary?: BookAiSummary;
  previousVersion?: AssetVersionRef;
};

export type AIAssetVersionSummary = {
  feature: AssetVersionFeature;
  scopeId: string;
  inputHash: string;
  promptVersion: string;
  generatedAt: string;
  updatedAt: string;
  source: BookAiSummarySource;
  title?: string;
  providerModel?: string;
  readingStage?: AIAssetReadingStage;
  readingStageLabel?: string;
  progress?: number;
  refreshReason?: AIAssetRefreshReason;
  isCurrent: boolean;
  previousVersion?: AssetVersionRef;
};

export type PreparedAssetUpdate = {
  feature: AssetVersionFeature;
  bookId: string;
  title?: string;
  author?: string;
  candidateBookIds?: string[];
  versionTitle?: string;
  promptVersion: string;
  generatedAt: string;
  scopeId: string;
  inputHash: string;
};

export type BookAiSummaryUpdateContext = Pick<PreparedAssetUpdate, "feature" | "scopeId" | "inputHash">;

export type ExportAiMarkdownResponse = {
  fileName: string;
  path: string;
  exportedAt: string;
};

export type ExportAiBulkMarkdownResponse = {
  exportId: string;
  path: string;
  exportedAt: string;
  files: string[];
  itemCount: number;
};

export type BookNotesSummariesExportOptions = {
  includeActionFeedback: boolean;
  includeReflectionFeedback: boolean;
  includeRepresentativeQuotes: boolean;
};

export type ReadingPersonaStatus = "complete" | "provisional" | "insufficient";
export type ReadingPersonaPaletteGroup = "NT" | "NF" | "SJ" | "SP";
export type ReadingPersonaAccentTone = "bluegreen" | "rose" | "moss" | "amber";
export type ReadingPersonaAxis = "energy" | "information" | "decision" | "lifestyle";
export type ReadingPersonaStrength = "strong" | "medium" | "light";
export type ReadingPersonaKey = "E" | "I" | "S" | "N" | "T" | "F" | "J" | "P";

export type ReadingPersonaDimension = {
  axis: ReadingPersonaAxis;
  key: ReadingPersonaKey;
  label: string;
  strength: ReadingPersonaStrength;
  basis: string;
};

export type ReadingPersona = {
  status: ReadingPersonaStatus;
  code?: string;
  label?: string;
  displayTitle?: string;
  paletteGroup?: ReadingPersonaPaletteGroup;
  accentTone?: ReadingPersonaAccentTone;
  basisNotice: string;
  dimensions: ReadingPersonaDimension[];
  evidence: string[];
  confidence?: number;
  summary?: string;
  suggestion?: string;
};

export type ReadingPersonaPatch = {
  summary?: string;
  suggestion?: string;
};

export type ReadingStatsAiReviewSourceStats = {
  mode: ReadingStatsMode;
  baseTime: number;
  readDays?: number;
  totalReadTimeSeconds?: number;
  dayAverageReadTimeSeconds?: number;
  bucketCount: number;
  longestItemCount: number;
  categoryCount: number;
};

export type ReadingStatsAiReview = {
  overview: string;
  rhythmInsights: string[];
  preferenceInsights: string[];
  focusItems: string[];
  nextActions: string[];
  readingPersona?: ReadingPersonaPatch;
  sourceStats: ReadingStatsAiReviewSourceStats;
  generatedAt: string;
  promptVersion: string;
  responseFormat?: AiResponseFormatKind;
  basisNotice: string;
};

export type ReadingStatsAiReviewResponse = {
  mode: ReadingStatsMode;
  baseTime: number;
  promptVersion: string;
  inputHash: string;
  providerModel?: string;
  source: BookAiSummarySource;
  review: ReadingStatsAiReview;
  cachedUpdatedAt?: string;
  errorMessage?: string;
};

export type ReadingRouteBookInput = {
  bookId: string;
  title: string;
  author?: string;
  category?: string;
  localStatus?: string;
  progressPercent?: number;
  isFinished?: boolean;
};

export type ReadingRouteRequest = {
  book: ReadingRouteBookInput;
  candidates: ReadingRouteBookInput[];
};

export type ReadingRouteSourceStats = {
  currentBookCount: number;
  candidateCount: number;
  summaryCount: number;
  statsSignalCount: number;
  localStatusCount: number;
};

export type ReadingRouteBookStep = {
  bookId: string;
  title: string;
  author?: string;
  order: number;
  role: string;
  readingPurpose: string;
  estimatedEffort: string;
  localStatus?: string;
  basis: string;
};

export type ReadingRouteDependency = {
  fromBookId: string;
  toBookId: string;
  reason: string;
};

export type ReadingRouteCheckpoint = {
  timing: string;
  question: string;
  suggestedOutput: string;
};

export type ReadingRoute = {
  routeOverview: string;
  books: ReadingRouteBookStep[];
  dependencies: ReadingRouteDependency[];
  reviewCheckpoints: ReadingRouteCheckpoint[];
  nextActions: string[];
  readingStage?: {
    stage: AIAssetReadingStage;
    label: string;
    progressPercent: number;
    refreshReason?: AIAssetRefreshReason;
  };
  sourceStats: ReadingRouteSourceStats;
  generatedAt: string;
  promptVersion: string;
  responseFormat?: AiResponseFormatKind;
  basisNotice: string;
};

export type ReadingRouteResponse = {
  bookId: string;
  scopeId: string;
  promptVersion: string;
  inputHash: string;
  providerModel?: string;
  source: BookAiSummarySource;
  route: ReadingRoute;
  cachedUpdatedAt?: string;
  errorMessage?: string;
};

export type BookDecisionCandidateInput = {
  bookId: string;
  title: string;
  author?: string;
  category?: string;
  localStatus?: string;
};

export type BookDecisionGoal =
  | "轻松读"
  | "延续当前主题"
  | "推进长期书"
  | "只有 30 分钟"
  | "读完能复盘";

export type BookDecisionSourceStats = {
  candidateCount: number;
  summaryCount: number;
  statsSignalCount: number;
  localStatusCount: number;
};

export type BookDecisionTopCandidate = {
  bookId: string;
  title: string;
  author?: string;
  rank: number;
  whyNow: string;
  tradeoff: string;
  estimatedEffort: string;
  prerequisiteAction: string;
  reviewTrigger: string;
  basis: string;
};

export type BookDecisionDeferredCandidate = {
  bookId: string;
  title: string;
  reason: string;
};

export type BookDecision = {
  decisionOverview: string;
  topCandidates: BookDecisionTopCandidate[];
  deferredCandidates: BookDecisionDeferredCandidate[];
  nextActions: string[];
  sourceStats: BookDecisionSourceStats;
  generatedAt: string;
  promptVersion: string;
  responseFormat?: AiResponseFormatKind;
  basisNotice: string;
};

export type BookDecisionResponse = {
  scopeId: string;
  promptVersion: string;
  inputHash: string;
  providerModel?: string;
  source: BookAiSummarySource;
  decision: BookDecision;
  cachedUpdatedAt?: string;
  errorMessage?: string;
};

export type SyncSection =
  | "dashboard"
  | "shelf"
  | "book"
  | "notes"
  | "stats"
  | "discovery";

export type SyncStatus = "idle" | "syncing" | "success" | "failed";

export type SyncState = {
  section: SyncSection;
  status: SyncStatus;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ShelfEntryType = "book" | "album" | "mp";

export type ReadingItemStatus = "toRead" | "reading" | "reviewing" | "organized";

export type ReadingItemStateType = ShelfEntryType | "candidate";

export type ReadingItemState = {
  itemId: string;
  itemType: ReadingItemStateType;
  status: ReadingItemStatus;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadingItemStateInput = {
  itemId: string;
  itemType: ReadingItemStateType;
  status: ReadingItemStatus;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
  note?: string;
};

export type ShelfEntry = {
  id: string;
  type: ShelfEntryType;
  title: string;
  author?: string;
  cover?: string;
  category?: string;
  isTop: boolean;
  isSecret: boolean;
  isFinished?: boolean;
  lastReadAt?: number;
  raw?: unknown;
};

export type BookshelfSummary = {
  totalVisibleEntries: number;
  bookCount: number;
  albumCount: number;
  mpCount: 0 | 1;
  publicCount: number;
  secretCount: number;
};

export type BookDetail = {
  bookId: string;
  title: string;
  author?: string;
  translator?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  ratingPercent?: number;
  ratingCount?: number;
};

export type ReadingProgress = {
  bookId: string;
  chapterUid?: number;
  chapterOffset?: number;
  progressPercent: number;
  updatedAt?: number;
  recordReadingTimeSeconds?: number;
  finishTime?: number;
  isStarted: boolean;
  isFinished: boolean;
};

export type Chapter = {
  bookId: string;
  chapterUid: number;
  chapterIdx: number;
  title: string;
  wordCount?: number;
  level: number;
  price?: number;
  paid?: boolean;
  isMPChapter?: boolean;
};

export type NotebookBook = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  totalNoteCount: number;
  readingProgress?: number;
  markedStatus?: number;
  sort?: number;
};

export type Highlight = {
  bookmarkId: string;
  bookId: string;
  chapterUid?: number;
  chapterTitle?: string;
  markText: string;
  createTime?: number;
  range?: string;
  deepLink?: string;
};

export type Thought = {
  reviewId: string;
  bookId: string;
  content: string;
  abstractText?: string;
  createTime?: number;
  star?: number;
  chapterName?: string;
  chapterUid?: number;
  range?: string;
  deepLink?: string;
  isFinish?: boolean;
};

export type ChapterNoteGroup = {
  chapterUid?: number;
  title: string;
  highlights: Highlight[];
  thoughts: Thought[];
};

export type BookNotes = {
  bookId: string;
  book?: NotebookBook;
  highlights: Highlight[];
  thoughts: Thought[];
  chapters: Chapter[];
  chapterGroups: ChapterNoteGroup[];
  bookmarkCount: number;
  exportableCount: number;
  bookmarkContentNotice: string;
};

export type BulkExportStrategy = "localCachedOnly" | "syncMissingNotes" | "selectedBooksOnly";

export type BulkExportItemStatus =
  | "ready"
  | "needsSync"
  | "noContent"
  | "skipped"
  | "failed"
  | "exported"
  | "canceled";

export type BulkExportPreflightItem = {
  bookId: string;
  title: string;
  author?: string;
  totalNoteCount: number;
  cachedExportableCount: number;
  hasCachedNotes: boolean;
  hasCachedAiReview: boolean;
  status: BulkExportItemStatus;
  reason: string;
};

export type BulkExportPreflight = {
  totalBooks: number;
  readyCount: number;
  needsSyncCount: number;
  noContentCount: number;
  cachedAiReviewCount: number;
  items: BulkExportPreflightItem[];
};

export type BulkExportRequest = {
  strategy: BulkExportStrategy;
  selectedBookIds?: string[];
  concurrency?: number;
  excludeWithoutExportableNotes?: boolean;
};

export type BulkExportResultItem = {
  bookId: string;
  title: string;
  status: BulkExportItemStatus;
  notesFile?: string;
  aiReviewFile?: string;
  reason: string;
};

export type BulkExportReport = {
  exportedAt: string;
  strategy: BulkExportStrategy;
  concurrency: number;
  items: BulkExportResultItem[];
};

export type BulkExportResponse = {
  exportId: string;
  path: string;
  exportedAt: string;
  files: string[];
  report: BulkExportReport;
};

export type BulkExportProgressPhase =
  | "preparing"
  | "exportingCached"
  | "syncing"
  | "writingReport"
  | "completed";

export type BulkExportProgressBook = {
  bookId: string;
  title: string;
};

export type BulkExportProgressLatest = BulkExportProgressBook & {
  status: BulkExportItemStatus;
  reason: string;
};

export type BulkExportProgress = {
  phase: BulkExportProgressPhase;
  total: number;
  completed: number;
  exported: number;
  failed: number;
  skipped: number;
  canceled: number;
  active: BulkExportProgressBook[];
  latest?: BulkExportProgressLatest;
  message: string;
};

export type ReadingStatsMode = "weekly" | "monthly" | "annually" | "overall";

export type ReadingTimeBucket = {
  startTime: number;
  readTimeSeconds: number;
};

export type ReadingRankItem = {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  type: "book" | "album";
  readTimeSeconds: number;
  tags?: string[];
};

export type ReadingCategory = {
  categoryId?: string;
  title: string;
  parentTitle?: string;
  value?: number;
  readingTimeSeconds?: number;
  readingCount?: number;
};

export type ReadingStats = {
  mode: ReadingStatsMode;
  baseTime: number;
  readDays?: number;
  totalReadTimeSeconds?: number;
  dayAverageReadTimeSeconds?: number;
  compare?: number;
  buckets: ReadingTimeBucket[];
  longestItems: ReadingRankItem[];
  categories: ReadingCategory[];
  raw?: unknown;
};

export type SearchScope = 0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16;

export type SearchResult = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  ratingPercent?: number;
  ratingCount?: number;
  ratingTitle?: string;
  readingCount?: number;
  soldout?: boolean;
  searchIdx?: number;
};

export type Recommendation = SearchResult & {
  reason?: string;
};

export type SearchGroup = {
  title: string;
  scope?: SearchScope;
  scopeCount?: number;
  currentCount?: number;
  books: SearchResult[];
};

export type SearchBooksResult = {
  sid?: string;
  scope: SearchScope;
  hasMore: boolean;
  nextMaxIdx?: number;
  groups: SearchGroup[];
  results: SearchResult[];
};

export type RecommendationResult = {
  books: Recommendation[];
  hasMore: boolean;
  nextMaxIdx?: number;
};

export type SimilarBooksResult = RecommendationResult & {
  sessionId?: string;
};

export type SettingsState = {
  credential: CredentialStatus;
  syncStates: SyncState[];
  localData: LocalDataState;
  exportData: ExportDataState;
  appVersion: string;
  supportsNativeUpdater: boolean;
};

export type AppUpdateStatus = {
  available: boolean;
  currentVersion: string;
  supportsNativeUpdater: boolean;
  latestVersion?: string;
  notes?: string;
  publishedAt?: string;
};

export type AppUpdateRuntime = {
  currentVersion: string;
  supportsNativeUpdater: boolean;
};

export type AppUpdateNoticeState = {
  lastCheckedAt?: string;
  dismissedVersion?: string;
  reviewedVersion?: string;
};

export type LocalDataState = {
  dataDir: string;
  defaultDataDir: string;
  databasePath: string;
  databaseSizeBytes: number;
  cacheRowCount: number;
  isCustomDataDir: boolean;
  lastDataOperationError?: string;
  tableCounts: TableCountRecord[];
};

export type ExportDataState = {
  exportDir: string;
  defaultExportDir: string;
  isCustomExportDir: boolean;
};

export type TableCountRecord = {
  table: string;
  rowCount: number;
};

export type ClearLocalCacheResult = {
  deletedRows: number;
  state: SettingsState;
};

export type ClearAiOutputCacheResult = {
  deletedRows: number;
  state: SettingsState;
};

export type ExportDiagnosticsResult = {
  fileName: string;
  path: string;
  exportedAt: string;
};

export type ExportImageResult = {
  fileName: string;
  path: string;
  exportedAt: string;
};

export type ExportBackupResult = {
  backupId: string;
  path: string;
  exportedAt: string;
  files: string[];
};

export type RestoreBackupResult = {
  restoredFrom: string;
  restoredAt: string;
  state: SettingsState;
};

export type ChooseDataDirectoryResult = {
  path?: string;
  state: SettingsState;
};

export type ChooseExportDirectoryResult = {
  path?: string;
};

export type SaveExportDirectoryResult = {
  path: string;
  state: SettingsState;
};

export type MigrateDataDirectoryResult = {
  previousDataDir: string;
  dataDir: string;
  migratedAt: string;
  files: string[];
  state: SettingsState;
  restartRequired: boolean;
};

export type ResetExportDirectoryResult = {
  state: SettingsState;
};
