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

export type SettingsCredentialError = {
  code: string;
  message: string;
  detail?: string;
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

export type AiProviderCapabilityStatus = "passed" | "failed" | "skipped";

export type AiProviderCapabilityProbe = {
  basic: AiProviderCapabilityStatus;
  jsonObject: AiProviderCapabilityStatus;
  jsonSchema: AiProviderCapabilityStatus;
  recommendedPolicy: AiResponseFormatPolicy;
  checkedAt: string;
  message?: string;
};

export type AiProviderModelListItem = {
  id: string;
  ownedBy?: string;
};

export type AiProviderModelListResponse = {
  models: AiProviderModelListItem[];
  fetchedAt: string;
  message?: string;
};

export type AiProviderPresetId =
  | "openai"
  | "deepseek"
  | "dashscope"
  | "moonshot"
  | "r-api"
  | "custom";

export type AiResponseFormatPolicy =
  | "auto"
  | "jsonSchemaFirst"
  | "jsonObjectFirst"
  | "noResponseFormatFirst";

export type AiProviderSettings = {
  baseUrl: string;
  model: string;
  presetId?: AiProviderPresetId;
  responseFormatPolicy?: AiResponseFormatPolicy;
};

export type AiSettingsState = {
  credential: AiCredentialStatus;
  provider: AiProviderSettings;
};

export type EmbeddingCredentialState = {
  hasCredential: boolean;
};

export type EmbeddingProviderSettings = {
  baseUrl: string;
  model: string;
  providerLabel: string;
  batchSize: number;
  remoteNoteEmbeddingEnabled: boolean;
  consentConfirmedAt?: string;
};

export type SaveEmbeddingSettingsRequest = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  providerLabel?: string;
  batchSize?: number;
  remoteNoteEmbeddingEnabled: boolean;
  consentConfirmedAt?: string;
};

export type EmbeddingSettingsState = {
  credential: EmbeddingCredentialState;
  provider: EmbeddingProviderSettings;
};

export type EmbeddingConnectionProbe = {
  isValid: boolean;
  model: string;
  dimensions: number;
  checkedAt: string;
  message: string;
};

export type EmbeddingIndexStatus =
  | "building"
  | "ready"
  | "failed"
  | "cancelled"
  | "superseded";

export type EmbeddingIndexProfile = {
  id: string;
  providerKind: string;
  modelId: string;
  dimensions: number;
  providerLabel?: string;
  consentConfirmedAt?: string;
  status: EmbeddingIndexStatus;
  totalDocumentCount: number;
  indexedDocumentCount: number;
  cancelRequestedAt?: string;
  lastStartedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type EmbeddingIndexState = {
  active?: EmbeddingIndexProfile;
  ready?: EmbeddingIndexProfile;
  latest?: EmbeddingIndexProfile;
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

export type AssistantContextScope =
  | "global"
  | "bookDetail"
  | "bookNotes"
  | "readingStats"
  | "candidateShelf"
  | "aiAsset"
  | "localReaderSelection";

export type ReadingAssistantContextOption =
  | "currentBook"
  | "bookNotesSummary"
  | "rawBookNotes"
  | "readingStats"
  | "readingPersona"
  | "candidateBooks"
  | "bookExclusionList"
  | "aiAssetSummary"
  | "conversationHistory"
  | "readingMemory";

export type ReadingAssistantUsedContext = {
  contextType: ReadingAssistantContextOption;
  label: string;
  sourceRefs: string[];
  itemCount: number;
  availableItemCount?: number;
  matchedItemCount?: number;
  coverage?: "sampled" | "exhaustiveMatch" | "fullSnapshot";
  truncated?: boolean;
};

export type ReadingAssistantMessageStatus = "pending" | "answered" | "failed";

export type ReadingAssistantMessageRole = "user" | "assistant";

export type ReadingAssistantMessage = {
  id: string;
  role: ReadingAssistantMessageRole;
  content: string;
  status: ReadingAssistantMessageStatus;
  usedContext: ReadingAssistantUsedContext[];
  output?: ReadingAssistantMessageOutput;
  promptVersion?: string;
  inputHash?: string;
  providerModel?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
};

export type ReadingAssistantRecommendedBook = {
  title: string;
  author: string;
  reason: string;
  fit: string;
  risk: string;
};

export type ReadingAssistantActionOutput =
  | {
      type: "wereadSearch";
      payload: ReadingAssistantWereadSearchOutput;
    }
  | {
      type: "statsAggregate";
      payload: ReadingAssistantStatsAggregateOutput;
    }
  | {
      type: "bookReview";
      payload: ReadingAssistantBookReviewActionOutput;
    }
  | {
      type: "categoryBooks";
      payload: ReadingAssistantCategoryBooksOutput;
    }
  | {
      type: "noteSearch";
      payload: ReadingAssistantNoteSearchOutput;
    }
  | {
      type: "noteCount";
      payload: ReadingAssistantNoteCountOutput;
    };

export type ReadingAssistantWereadSearchOutput = {
  keyword: string;
  status: "found" | "notFound";
  message: string;
  results: ReadingAssistantWereadSearchResult[];
};

export type ReadingAssistantWereadSearchResult = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  category?: string;
  intro?: string;
  searchIdx?: number;
  localStatus: "available" | "inLibrary" | "inCandidate";
  localLabel: string;
  canAddToCandidate: boolean;
};

export type ReadingAssistantStatsAggregateOutput = {
  rangeLabel: string;
  dataStatus: "complete" | "partial" | "empty";
  message: string;
  totalReadingTimeText: string;
  readDays?: number;
  shelfBookCount: number;
  finishedBookCount: number;
  readingBookCount: number;
  candidateBookCount: number;
  updatedAt?: string;
  topCategories: ReadingAssistantStatsCategory[];
};

export type ReadingAssistantStatsCategory = {
  title: string;
  readingTimeText: string;
  readingCount?: number;
};

export type ReadingAssistantBookReviewActionOutput = {
  bookId: string;
  title: string;
  author?: string;
  message: string;
  ctaLabel: string;
};

export type ReadingAssistantCategoryBooksOutput = {
  categoryLabel: string;
  matchedCategoryTitles: string[];
  queryStatus: "found" | "partial" | "empty";
  totalStatCount?: number;
  totalStatReadingTimeText?: string;
  listedCount: number;
  message: string;
  books: ReadingAssistantCategoryBookItem[];
};

export type ReadingAssistantCategoryBookItem = {
  bookId: string;
  title: string;
  author?: string;
  category?: string;
  progressPercent?: number;
  isFinished: boolean;
  readingTimeText?: string;
  source: string;
};

export type ReadingAssistantNoteCountOutput = {
  bookId: string;
  title?: string;
  totalCount: number;
  highlightCount: number;
  thoughtCount: number;
  message: string;
};

export type ReadingAssistantNoteSearchItem = {
  documentId: string;
  sourceId: string;
  noteType: "highlight" | "thought";
  chapterUid?: number;
  chapterTitle?: string;
  text?: string;
  createdAt?: number;
};

export type ReadingAssistantNoteSearchOutput = {
  bookId: string;
  title?: string;
  queryText: string;
  mode: "recent" | "lexical" | "likeFallback" | "hybrid" | "hybridFallback";
  coverage: "sampled" | "exhaustiveMatch";
  matchedItemCount: number;
  includedItemCount: number;
  truncated: boolean;
  hasMore: boolean;
  nextCursor?: string;
  noteTypes: Array<"highlight" | "thought">;
  items: ReadingAssistantNoteSearchItem[];
};

export type ReadingAssistantNoteSearchRequest = {
  bookId: string;
  query: string;
  cursor?: string;
  pageLimit?: number;
};

export type ReadingAssistantMessageOutput = {
  suggestions: string[];
  recommendedBooks: ReadingAssistantRecommendedBook[];
  basisNotice: string;
  action?: ReadingAssistantActionOutput;
};

export type ReadingAssistantThreadSummary = {
  id: string;
  scope: AssistantContextScope;
  entityId?: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
};

export type ReadingAssistantThreadDetail = {
  id: string;
  scope: AssistantContextScope;
  entityId?: string;
  title: string;
  contextSummary: unknown;
  createdAt: string;
  updatedAt: string;
  messages: ReadingAssistantMessage[];
};

export type ReadingAssistantPreferences = {
  usePersonalizedContext: boolean;
  useReadingMemory: boolean;
  allowRawBookNotes: boolean;
  saveConversationHistory: boolean;
};

export type ReadingAssistantRequest = {
  threadId?: string;
  scope: AssistantContextScope;
  entityId?: string;
  message: string;
  enabledContext: ReadingAssistantContextOption[];
  replaceFromMessageId?: string;
};

export type ReadingAssistantStreamEvent = {
  streamId: string;
  delta: string;
  content: string;
};

export type ReadingAssistantAnswer = {
  threadId: string;
  userMessageId: string;
  messageId: string;
  answer: string;
  suggestions: string[];
  recommendedBooks: ReadingAssistantRecommendedBook[];
  action?: ReadingAssistantActionOutput;
  usedContext: ReadingAssistantUsedContext[];
  generatedAt: string;
  promptVersion: string;
  providerModel?: string;
  basisNotice: string;
};

export type BookAiSummarySourceStats = {
  highlightCount: number;
  thoughtCount: number;
  bookmarkCount: number;
  chapterCount: number;
  includedHighlightCount: number;
  includedThoughtCount: number;
};

export type FeedbackOutcomeSummary = {
  summary: string;
  appliedChanges?: string[];
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
  feedbackOutcomeSummary?: FeedbackOutcomeSummary;
};

export type BookAiRepresentativeQuote = {
  quote: string;
  reason: string;
  chapter?: string;
  noteType: string;
};

export type BookAiSummarySource = "cache" | "generated" | "staleCache" | "empty";
export type AiResponseFormatKind = "json_schema" | "json_object";

export type NoteSynthesisJobStatus =
  | "queued"
  | "snapshotting"
  | "batching"
  | "summarizing"
  | "merging"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export type NoteSynthesisCoverageReport = {
  totalCount: number;
  processedCount: number;
  pendingCount: number;
  skippedEmptyCount: number;
  skippedDuplicateCount: number;
  failedItemCount: number;
  fullSnapshot: boolean;
};

export type NoteSynthesisFailedBatch = {
  batchIndex: number;
  sourceCount: number;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
};

export type NoteSynthesisResultReference = {
  feature: string;
  promptVersion: string;
  inputHash: string;
};

export type NoteSynthesisJob = {
  id: string;
  bookId: string;
  status: NoteSynthesisJobStatus;
  sourceSnapshotHash: string;
  totalCount: number;
  processedCount: number;
  batchCount: number;
  completedBatchCount: number;
  failedBatchCount: number;
  providerModel: string;
  providerLabel: string;
  consentConfirmedAt: string;
  cancelRequestedAt?: string;
  lastStartedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: NoteSynthesisResultReference;
  failedBatches: NoteSynthesisFailedBatch[];
  coverage: NoteSynthesisCoverageReport;
  createdAt: string;
  updatedAt: string;
};

export type NoteSynthesisPreview = {
  bookId: string;
  totalCount: number;
  highlightCount: number;
  thoughtCount: number;
  estimatedBatchCount: number;
  estimatedCharCount: number;
  providerModel: string;
  providerLabel: string;
  activeJob?: NoteSynthesisJob;
};

export type StartNoteSynthesisResult = {
  created: boolean;
  job: NoteSynthesisJob;
};

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

export type ReadingRouteUpdateContext = Pick<PreparedAssetUpdate, "feature" | "scopeId" | "inputHash">;

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
  feedbackOutcomeSummary?: FeedbackOutcomeSummary;
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

export type BookDecisionReferenceFactor = "recent" | "finished" | "habits";

export type BookDecisionRecentReadingContext = {
  finishedTitles: string[];
  activeCategories: Array<{
    name: string;
    minutes: number;
  }>;
  averageDailyMinutes: number;
};

export type BookDecisionCandidateInput = {
  bookId: string;
  title: string;
  author?: string;
  category?: string;
  lifeStatus: ReadingItemLifeStatus;
  organizeStatus: ReadingItemOrganizeStatus;
};

export type BookDecisionRequest = {
  candidates: BookDecisionCandidateInput[];
  goal?: string;
  referenceFactors: BookDecisionReferenceFactor[];
  recentReadingWindowDays?: number;
  recentReadingContext: BookDecisionRecentReadingContext;
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
  referenceFactors?: BookDecisionReferenceFactor[];
  recentReadingWindowDays?: number;
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

export type ReadingItemKind = ShelfEntryType | "localBook";

export type ReadingItemCandidateSource =
  | "weread"
  | "ai_unconfirmed"
  | "ai_confirmed"
  | "light";

export type ReadingItemLifeStatus =
  | "none"
  | "want"
  | "reading"
  | "paused"
  | "finished"
  | "dropped";

export type ReadingItemFinishedSource = "weread_auto" | "manual";

export type ReadingItemOrganizeStatus = "none" | "to_organize" | "organized";

export type ReadingItemSourceMetaValue =
  | string
  | number
  | boolean
  | null
  | ReadingItemSourceMetaValue[]
  | { [key: string]: ReadingItemSourceMetaValue };

export type ReadingItemSourceMeta = Record<string, ReadingItemSourceMetaValue>;

export type ReadingItem = {
  itemId: string;
  itemKind: ReadingItemKind;
  isCandidate: boolean;
  candidateSource?: ReadingItemCandidateSource;
  lifeStatus: ReadingItemLifeStatus;
  finishedSource?: ReadingItemFinishedSource;
  organizeStatus: ReadingItemOrganizeStatus;
  userNote?: string;
  sourceMeta?: ReadingItemSourceMeta;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * 旧页面迁移期兼容类型。三维字段是事实源，itemType/status/note 仅供尚未迁移的读取点使用。
 */
export type ReadingItemState = {
  itemId: string;
  itemType: ReadingItemStateType;
  status: ReadingItemStatus;
  itemKind?: ReadingItemKind;
  isCandidate?: boolean;
  candidateSource?: ReadingItemCandidateSource;
  lifeStatus?: ReadingItemLifeStatus;
  finishedSource?: ReadingItemFinishedSource;
  organizeStatus?: ReadingItemOrganizeStatus;
  userNote?: string;
  sourceMeta?: ReadingItemSourceMeta;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReadingItemPatch = {
  isCandidate?: boolean;
  candidateSource?: ReadingItemCandidateSource;
  lifeStatus?: ReadingItemLifeStatus;
  finishedSource?: ReadingItemFinishedSource;
  organizeStatus?: ReadingItemOrganizeStatus;
  userNote?: string;
  clearUserNote?: boolean;
  sourceMeta?: ReadingItemSourceMeta;
};

export type ReadingItemMeta = {
  itemKind: ReadingItemKind;
  title?: string;
  author?: string;
  cover?: string;
  category?: string;
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

export type ShelfArchive = {
  id: string;
  name: string;
  bookIds: string[];
  matchedEntryCount: number;
  missingBookCount: number;
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

export type WereadSourceLocation = {
  bookId: string;
  chapterUid?: number;
  range?: string;
};

export type WereadSourcePrecision = "range" | "chapter" | "book";

export type OpenWereadSourceResult = {
  opened: boolean;
  deepLink: string;
  precision: WereadSourcePrecision;
  warning?: string;
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

export type PublicReviewAuthor = {
  userVid?: string;
  name?: string;
  avatar?: string;
};

export type PublicReviewBook = {
  bookId?: string;
  title?: string;
  author?: string;
};

export type PublicReview = {
  idx?: number;
  reviewId: string;
  content: string;
  star?: number;
  starLevel?: number;
  isFinish?: boolean;
  createTime?: number;
  chapterName?: string;
  author?: PublicReviewAuthor;
  book?: PublicReviewBook;
};

export type PublicReviewsResult = {
  bookId: string;
  reviewListType: number;
  totalCount?: number;
  recentTotalCount?: number;
  hasMore: boolean;
  has5Star: boolean;
  has1Star: boolean;
  hasRecent: boolean;
  friendCommentCount?: number;
  friendUniqueCount?: number;
  synckey?: number;
  nextMaxIdx?: number;
  reviews: PublicReview[];
};

export type BestBookmark = {
  bookmarkId: string;
  bookId: string;
  chapterUid?: number;
  chapterTitle?: string;
  range?: string;
  markText: string;
  totalCount?: number;
};

export type BestBookmarksResult = {
  bookId: string;
  chapterUid: number;
  synckey?: number;
  totalCount?: number;
  items: BestBookmark[];
};

export type ReadReview = {
  reviewId: string;
  content: string;
  abstractText?: string;
  createTime?: number;
  range?: string;
  author?: PublicReviewAuthor;
};

export type ReadReviewsResult = {
  bookId: string;
  chapterUid: number;
  range: string;
  totalCount?: number;
  hasMore: boolean;
  maxIdx?: number;
  synckey?: number;
  reviews: ReadReview[];
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
  /** 外部目标选择；缺省等价于仅 Markdown。Markdown 始终写入批量目录作为兜底。 */
  targets?: MultiTargetExportRequest;
};

export type BulkExportResultItem = {
  bookId: string;
  title: string;
  /** 作者，用于区分同名不同版本的书。 */
  author?: string;
  status: BulkExportItemStatus;
  notesFile?: string;
  aiReviewFile?: string;
  /** 目标级结果（Obsidian / Notion）；仅当批量请求选择了外部目标时非空。 */
  targets?: ExportTargetResult[];
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
  deepLink?: string;
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
  credentialError?: SettingsCredentialError;
  syncStates: SyncState[];
  localData: LocalDataState;
  exportData: ExportDataState;
  integrationData: IntegrationDataState;
  network: NetworkState;
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

export type ExternalExportTarget = "markdown" | "obsidian" | "notion";

export type ObsidianAttachmentMode = "siblingAssets" | "centralAssets";

export type NotionParentType = "page" | "database";

export type NotionCoverMode = "pageCover" | "contentImageOnly";

export type NotionLogicalField =
  | "title"
  | "author"
  | "cover"
  | "bookId"
  | "assetType"
  | "source"
  | "exportedAt"
  | "importStatus"
  | "readingStatus"
  | "readingStage"
  | "progress"
  | "tags"
  | "wereadUrl"
  | "obsidianPath"
  | "promptVersion"
  | "inputHash"
  | "scopeId"
  | "period"
  | "actionCount"
  | "candidateCount"
  | "highlightCount"
  | "thoughtCount"
  | "bookmarkCount"
  | "exportableCount";

export type NotionPropertyMapping = {
  logicalField: NotionLogicalField;
  propertyId: string;
  propertyNameSnapshot: string;
  propertyType: string;
  enabled: boolean;
};

export type NotionPropertySummary = {
  id: string;
  name: string;
  type: string;
};

export type NotionDatabaseConnection = {
  databaseId: string;
  databaseName?: string;
  databaseUrl?: string;
  titlePropertyId: string;
  titlePropertyNameSnapshot: string;
  mappings: NotionPropertyMapping[];
  schemaCheckedAt: string;
  schemaFingerprint?: string;
};

export type NotionDatabaseCompatibilityLevel = "full" | "basic" | "invalid";

export type NotionDatabaseIssue = {
  code: string;
  message: string;
  logicalField?: NotionLogicalField;
  propertyId?: string;
};

export type AnalyzeNotionDatabaseResult = {
  compatibility: NotionDatabaseCompatibilityLevel;
  databaseId: string;
  databaseName?: string;
  databaseUrl?: string;
  titleProperty?: NotionPropertySummary;
  properties: NotionPropertySummary[];
  suggestedMappings: NotionPropertyMapping[];
  issues: NotionDatabaseIssue[];
  schemaCheckedAt: string;
  schemaFingerprint?: string;
};

export type NotionCoverPropertyAction = "reuse" | "create" | "conflict";

export type NotionCoverPropertyPlan = {
  action: NotionCoverPropertyAction;
  propertyId?: string;
  propertyName?: string;
  propertyType?: string;
  message: string;
};

export type NotionCoverBackfillPreflight = {
  preflightId: string;
  databaseId: string;
  databaseName?: string;
  schemaFingerprint: string;
  connectionSchemaChanged: boolean;
  coverProperty: NotionCoverPropertyPlan;
  bookIdPropertyId?: string;
  bookIdPropertyName?: string;
  totalPages: number;
  pagesWithBookId: number;
  pagesWithLocalCover: number;
  missingLocalCover: number;
  missingCoverProperty: number;
  missingPageCover: number;
  preservedCoverProperty: number;
  preservedPageCover: number;
  eligiblePages: number;
  canRun: boolean;
  blockers: string[];
  warnings: string[];
};

export type RunNotionCoverBackfillRequest = {
  preflightId: string;
  databaseId: string;
  schemaFingerprint: string;
  coverPropertyAction: NotionCoverPropertyAction;
  confirm: boolean;
};

export type NotionCoverBackfillPhase =
  | "validating"
  | "upgradingSchema"
  | "updatingPages"
  | "canceling"
  | "completed";

export type NotionCoverBackfillItemStatus =
  | "updated"
  | "partial"
  | "preserved"
  | "skipped"
  | "failed"
  | "canceled";

export type NotionCoverBackfillItemResult = {
  pageId: string;
  title: string;
  bookId?: string;
  status: NotionCoverBackfillItemStatus;
  propertyUpdated: boolean;
  pageCoverUpdated: boolean;
  reason: string;
};

export type NotionCoverBackfillProgress = {
  operationId: string;
  phase: NotionCoverBackfillPhase;
  total: number;
  completed: number;
  updated: number;
  partial: number;
  preserved: number;
  skipped: number;
  failed: number;
  canceled: number;
  currentPageId?: string;
  currentTitle?: string;
  message: string;
};

export type NotionCoverBackfillReport = {
  operationId: string;
  preflightId: string;
  databaseId: string;
  coverPropertyId: string;
  coverPropertyName: string;
  total: number;
  completed: number;
  updated: number;
  partial: number;
  preserved: number;
  skipped: number;
  failed: number;
  canceled: number;
  wasCanceled: boolean;
  schemaUpgraded: boolean;
  startedAt: string;
  completedAt: string;
  items: NotionCoverBackfillItemResult[];
  warnings: string[];
};

export type NotionStandardProvisioningPhase =
  | "creatingDatabase"
  | "databaseCreateUnknown"
  | "databaseCreated"
  | "connectionSaved"
  | "viewsInitializing"
  | "partial"
  | "complete";

export type NotionStandardProvisioningStatus =
  | "complete"
  | "partial"
  | "recoveryRequired"
  | "unknown";

export type NotionStandardViewKey = "recent" | "notes" | "reviewQueue" | "reviews";

export type NotionDefaultViewStatus =
  | "created"
  | "updated"
  | "reused"
  | "skipped"
  | "conflict"
  | "failed"
  | "unknown";

export type NotionDefaultViewResult = {
  key: NotionStandardViewKey;
  name: string;
  type: "table";
  status: NotionDefaultViewStatus;
  viewId?: string;
  url?: string;
  managedConfigFingerprint?: string;
  warning?: string;
};

export type NotionViewInitializationStatus =
  | "notStarted"
  | "initializing"
  | "partial"
  | "complete";

export type NotionStandardProvisioningResolution =
  | "linkCurrentConnection"
  | "confirmNotCreated";

export type NotionProvisioningError = {
  step: string;
  code: string;
  message: string;
  retryable: boolean;
  resultUnknown: boolean;
};

export type CreateNotionStandardDatabaseResult = {
  provisioningId: string;
  phase: NotionStandardProvisioningPhase;
  status: NotionStandardProvisioningStatus;
  databaseId?: string;
  dataSourceId?: string;
  url?: string;
  title: string;
  connection?: NotionDatabaseConnection;
  state?: SettingsState;
  views: NotionDefaultViewResult[];
  viewInitialization: NotionViewInitializationStatus;
  warnings: string[];
  lastError?: NotionProvisioningError;
};

export type IntegrationDataState = {
  obsidian: {
    vaultDir?: string;
    hasConfiguredVault: boolean;
    attachmentMode: ObsidianAttachmentMode;
    openAfterExport: boolean;
  };
  notion: {
    credential: CredentialStatus;
    parentId?: string;
    parentType?: NotionParentType;
    coverMode: NotionCoverMode;
    databaseConnection?: NotionDatabaseConnection;
  };
};

export type MultiTargetExportRequest = {
  targets: ExternalExportTarget[];
  obsidian?: {
    vaultDir?: string;
    openAfterExport?: boolean;
  };
  notion?: {
    parentId?: string;
    parentType?: NotionParentType;
  };
};

export type ExportSourceKind =
  | "bookNotes"
  | "bookReview"
  | "readingStatsReview"
  | "readingRoute"
  | "bookDecision";

export type ExportTargetStatus = "succeeded" | "failed" | "skipped";

export type ExportTargetResult = {
  target: ExternalExportTarget;
  status: ExportTargetStatus;
  title?: string;
  path?: string;
  url?: string;
  pageId?: string;
  fileCount?: number;
  warning?: string;
  error?: SettingsCredentialError;
};

export type MultiTargetExportResponse = {
  exportId: string;
  sourceKind: ExportSourceKind;
  sourceId: string;
  exportedAt: string;
  results: ExportTargetResult[];
};

export type BookNotesSummaryTargetSelection = {
  bookId: string;
  targets: ExternalExportTarget[];
  knownObsidianPath?: string;
};

export type BookNotesSummariesTargetExportRequest = {
  items: BookNotesSummaryTargetSelection[];
  options: BookNotesSummariesExportOptions;
  obsidian?: MultiTargetExportRequest["obsidian"];
  notion?: MultiTargetExportRequest["notion"];
};

export type BookNotesSummariesTargetExportItemResult = {
  bookId: string;
  title: string;
  author?: string;
  results: ExportTargetResult[];
};

export type BookReviewMarkdownBatchResult = {
  path: string;
  indexPath?: string;
  warning?: string;
};

export type BookNotesSummariesTargetExportResponse = {
  exportId: string;
  exportedAt: string;
  markdownBatch?: BookReviewMarkdownBatchResult;
  items: BookNotesSummariesTargetExportItemResult[];
};

export type CreateNotionReadingLibraryTemplateResult = {
  databaseId: string;
  url: string;
  title: string;
  state: SettingsState;
};

export type CreateNotionReadingWorkspaceTemplateResult = {
  homePageId: string;
  homePageUrl: string;
  databaseId: string;
  databaseUrl: string;
  title: string;
  warning?: string;
  state: SettingsState;
};

export type ChooseObsidianVaultDirectoryResult = {
  path?: string;
};

export type NetworkState = {
  wereadProxyUrl?: string;
  isCustomWereadProxy: boolean;
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

export type SaveWereadProxyResult = {
  state: SettingsState;
};

export type ResetWereadProxyResult = {
  state: SettingsState;
};
