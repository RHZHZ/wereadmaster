import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  Quote,
  RefreshCw,
  Settings,
  Sparkles,
  Tags,
  Target
} from "lucide-react";
import { AiActionFeedbackChecklist } from "../components/AiActionFeedbackChecklist";
import {
  AssetExportDialog,
  type AssetExportConfirmation
} from "../components/export/AssetExportDialog";
import { BookInsightSection } from "../components/BookInsightSection";
import { reflectionFeedbackLabels } from "../components/AiActionFeedbackChecklist";
import { SkillUpgradeNotice } from "../components/SkillUpgradeNotice";
import { useToast } from "../components/ToastProvider";
import {
  buildAiActionItemId,
  buildAiReflectionQuestionId,
  getAiActionItemStorage,
  hasAiReviewFeedback,
  readAiReviewFeedback,
  writeAiReviewFeedback,
  type AiActionFeedbackByItemId,
  type AiActionFeedbackRecord,
  type AiReviewFeedbackState
} from "../lib/ai-action-items";
import { buildActionItemAssistantDraft } from "../lib/action-item-drafts";
import { buildBookInsightViewModels } from "../lib/book-insights";
import { copyTextToClipboard } from "../lib/clipboard";
import { buildFeedbackOutcomeAssistantDraft } from "../lib/feedback-outcome-drafts";
import {
  exportBookNotesSummaryTargets,
  getBookNotesSummaryVariants,
  getReadingItemState,
  getAiReviewFeedback,
  getAiSettingsState,
  getBookNotes,
  getCommandErrorInfo,
  getCommandErrorMessage,
  getNoteSynthesisJob,
  getNoteSynthesisJobSummary,
  previewNoteSynthesis,
  startNoteSynthesis,
  continueNoteSynthesis,
  retryFailedNoteSynthesisBatches,
  cancelNoteSynthesis,
  saveAiReviewFeedback,
  summarizeBookNotes,
  patchReadingItemState,
  type CommandErrorInfo
} from "../lib/reading-api";
import { formatAiResponseFormat, formatAiTimestamp } from "../lib/formatters";
import {
  formatArtifactCopiedMessage,
  type ReadingArtifactKind
} from "../lib/reading-artifacts";
import { resolveExportPlatformMode } from "../lib/asset-export-dialog";
import {
  buildMultiTargetExportRequest,
  formatMultiTargetExportToast
} from "../lib/export-targets";
import type {
  AiSettingsState,
  BookAiRepresentativeQuote,
  BookAiSummary,
  BookAiSummaryResponse,
  BookAiSummaryVariants,
  BookAiSummarySourceStats,
  BookNotes,
  FeedbackOutcomeSummary,
  MultiTargetExportResponse,
  ExternalExportTarget,
  NotebookBook,
  AiReviewFeedbackExport,
  PreparedAssetUpdate,
  ReadingItemState,
  NoteSynthesisJob,
  NoteSynthesisJobSummary,
  NoteSynthesisPreview
} from "../lib/types";
import type { SettingsCategoryId } from "./SettingsPage";

type BookAiSummaryPageProps = {
  book?: NotebookBook;
  bookId?: string;
  notes?: BookNotes;
  onNotesChange?: (bookId: string, notes: BookNotes) => void;
  onOpenSettings: (preferredCategory?: SettingsCategoryId) => void;
  onBack: () => void;
  backLabel?: string;
  preparedUpdate?: PreparedAssetUpdate;
  onAskInsight?: (draft: string) => void;
};

type NotesInfo =
  | { status: "unknown" }
  | { status: "loading" }
  | {
      status: "ready";
      notes: BookNotes;
      exportableCount: number;
      totalCount: number;
    };

type AiPageStatus =
  | "idle"
  | "setup-required"
  | "loading-cache"
  | "cached"
  | "generating"
  | "generated"
  | "error"
  | "empty-note";

type BookReviewMode = "quick" | "full";

const inFlightBookNotesRequests = new Map<string, Promise<BookNotes>>();
const QUICK_REVIEW_HIGHLIGHT_BUDGET = 80;
const QUICK_REVIEW_THOUGHT_BUDGET = 20;

export function BookAiSummaryPage({
  book,
  bookId,
  notes,
  onNotesChange,
  onOpenSettings,
  onBack,
  backLabel = "返回单本笔记",
  preparedUpdate,
  onAskInsight
}: BookAiSummaryPageProps) {
  const targetBookId = bookId ?? book?.bookId ?? notes?.bookId;
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [status, setStatus] = useState<AiPageStatus>("idle");
  const [summaryResponses, setSummaryResponses] = useState<BookAiSummaryVariants>({});
  const initialReviewMode = readReviewModeFromLocation();
  const [reviewMode, setReviewMode] = useState<BookReviewMode>(initialReviewMode ?? "quick");
  const hasUserSelectedReviewMode = useRef(Boolean(initialReviewMode));
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isLoadingSummaryCache, setIsLoadingSummaryCache] = useState(false);
  const [isLoadingReadingState, setIsLoadingReadingState] = useState(false);
  const [isAssetExportOpen, setIsAssetExportOpen] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<AiReviewFeedbackState>(createEmptyReviewFeedback);
  const [readingState, setReadingState] = useState<ReadingItemState>();
  const [readingStateError, setReadingStateError] = useState<string>();
  const [notesInfo, setNotesInfo] = useState<NotesInfo>(() => notesInfoFromNotes(notes, targetBookId));
  const [notesError, setNotesError] = useState<CommandErrorInfo>();
  const [notesReloadToken, setNotesReloadToken] = useState(0);
  const [synthesisPreview, setSynthesisPreview] = useState<NoteSynthesisPreview>();
  const [synthesisJob, setSynthesisJob] = useState<NoteSynthesisJob>();
  const [synthesisJobs, setSynthesisJobs] = useState<NoteSynthesisJobSummary>();
  const [synthesisReloadToken, setSynthesisReloadToken] = useState(0);
  const [isLoadingSynthesis, setIsLoadingSynthesis] = useState(false);
  const [synthesisConsent, setSynthesisConsent] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string>();
  const onNotesChangeRef = useRef(onNotesChange);
  const activeNotesBookIdRef = useRef(targetBookId);
  const [error, setError] = useState<CommandErrorInfo>();
  const { showToast } = useToast();
  const readyNotes =
    notesInfo.status === "ready" && notesInfo.notes.bookId === targetBookId
      ? notesInfo.notes
      : undefined;
  const hasReadyNotesForTarget = Boolean(readyNotes);
  const displayBook =
    readyNotes?.book && readyNotes.book.bookId === targetBookId
      ? readyNotes.book
      : book ?? readyNotes?.book;
  const quickSummaryResponse =
    summaryResponses.quick?.bookId === targetBookId ? summaryResponses.quick : undefined;
  const fullSummaryResponse =
    summaryResponses.full?.bookId === targetBookId ? summaryResponses.full : undefined;
  const activeSummaryResponse = reviewMode === "full" ? fullSummaryResponse : quickSummaryResponse;
  const summary = activeSummaryResponse?.summary;
  const quickReviewAvailableCount = readyNotes
    ? readyNotes.highlights.length + readyNotes.thoughts.length
    : 0;
  const quickReviewBudgetCount = readyNotes
    ? Math.min(readyNotes.highlights.length, QUICK_REVIEW_HIGHLIGHT_BUDGET) +
      Math.min(readyNotes.thoughts.length, QUICK_REVIEW_THOUGHT_BUDGET)
    : 0;
  const completedSynthesisJob =
    synthesisJob?.status === "completed" ? synthesisJob : synthesisJobs?.latestCompletedJob;
  const hasActiveSynthesisJob = isActiveNoteSynthesisJob(synthesisJob);
  const hasPendingFullTask = Boolean(
    synthesisJob &&
      (hasActiveSynthesisJob || synthesisJob.status === "partial")
  );
  const isFullSnapshotSummary =
    !hasPendingFullTask && isVerifiedFullSnapshotSummary(completedSynthesisJob, fullSummaryResponse);
  const completedSnapshotIsStale = isNoteSynthesisSnapshotStale(
    synthesisPreview,
    completedSynthesisJob
  );
  const hasSummary = Boolean(
    summary &&
      activeSummaryResponse?.source !== "empty" &&
      (reviewMode === "quick" || isFullSnapshotSummary)
  );
  const visibleSummary = hasSummary ? summary : undefined;
  const sourceStats = visibleSummary?.sourceStats ?? sourceStatsFromNotes(readyNotes);
  const hasSourceStats = Boolean(visibleSummary || readyNotes);
  const hasQuickSummary = Boolean(
    quickSummaryResponse?.summary && quickSummaryResponse.source !== "empty"
  );
  const quickSummarySourceStats = quickSummaryResponse?.summary.sourceStats;
  const quickSummaryIncludedCount = quickSummarySourceStats
    ? quickSummarySourceStats.includedHighlightCount + quickSummarySourceStats.includedThoughtCount
    : quickReviewBudgetCount;
  const quickSummaryAvailableCount = quickSummarySourceStats
    ? quickSummarySourceStats.highlightCount + quickSummarySourceStats.thoughtCount
    : quickReviewAvailableCount;
  const canGenerate =
    Boolean(targetBookId) &&
    hasReadyNotesForTarget &&
    notesInfo.status === "ready" &&
    notesInfo.exportableCount > 0 &&
    aiState?.credential.hasCredential === true &&
    !isLoadingSettings &&
    !isLoadingSummaryCache &&
    status !== "generating" &&
    !hasActiveSynthesisJob;
  const statusMeta = statusMetaFromState(
    status,
    Boolean(activeSummaryResponse?.errorMessage),
    notesInfo.status,
    reviewMode,
    isFullSnapshotSummary
  );
  const summaryInputHash = activeSummaryResponse?.inputHash;
  const isOrganized =
    readingState?.organizeStatus === "organized" || readingState?.status === "organized";

  function handleReviewModeChange(nextMode: BookReviewMode) {
    hasUserSelectedReviewMode.current = true;
    setReviewMode(nextMode);
    replaceReviewModeInLocation(nextMode);
    const nextResponse = nextMode === "full" ? fullSummaryResponse : quickSummaryResponse;
    if (nextResponse) {
      setStatus(statusFromSource(nextResponse.source));
    } else if (status !== "generating" && !isLoadingSummaryCache) {
      setStatus(statusFromAiState(aiState, notesInfo));
    }
  }

  useEffect(() => {
    if (hasUserSelectedReviewMode.current || reviewMode === "full") {
      return;
    }

    if (
      isActiveNoteSynthesisJob(synthesisJob) ||
      synthesisJob?.status === "partial" ||
      isVerifiedFullSnapshotSummary(completedSynthesisJob, fullSummaryResponse)
    ) {
      setReviewMode("full");
      replaceReviewModeInLocation("full");
    }
  }, [completedSynthesisJob, fullSummaryResponse, reviewMode, synthesisJob]);

  useEffect(() => {
    onNotesChangeRef.current = onNotesChange;
  }, [onNotesChange]);

  useEffect(() => {
    let isMounted = true;
    const matchingNotes = notes?.bookId === targetBookId ? notes : undefined;
    const isBookChange = activeNotesBookIdRef.current !== targetBookId;
    activeNotesBookIdRef.current = targetBookId;

    async function loadNotesInfo() {
      if (isBookChange) {
        setSummaryResponses({});
      }
      setNotesError(undefined);

      if (!targetBookId) {
        setNotesInfo({ status: "unknown" });
        setStatus("error");
        setNotesError({ message: "缺少书籍 ID，无法读取真实笔记。" });
        return;
      }

      if (matchingNotes) {
        setNotesInfo(createReadyNotesInfo(matchingNotes));
        return;
      }

      setNotesInfo({ status: "loading" });
      setStatus("idle");

      try {
        const response = await loadBookNotesOnce(targetBookId);
        if (!isMounted) {
          return;
        }

        const normalizedBookId = response.bookId || targetBookId;
        setNotesInfo(createReadyNotesInfo(response));
        onNotesChangeRef.current?.(normalizedBookId, response);
      } catch (loadError) {
        if (isMounted) {
          setNotesInfo({ status: "unknown" });
          setNotesError(getCommandErrorInfo(loadError));
        }
      }
    }

    void loadNotesInfo();

    return () => {
      isMounted = false;
    };
  }, [targetBookId, notes, notesReloadToken]);

  useEffect(() => {
    let isMounted = true;

    async function loadAiState() {
      setIsLoadingSettings(true);
      setError(undefined);
      setStatus((current) =>
        current === "cached" ||
        current === "generated" ||
        current === "generating" ||
        current === "loading-cache"
          ? current
          : statusFromAiState(undefined, notesInfo)
      );

      try {
        const nextState = await getAiSettingsState();
        if (!isMounted) {
          return;
        }

        setAiState(nextState);
        setStatus((current) =>
          current === "cached" ||
          current === "generated" ||
          current === "generating" ||
          current === "loading-cache"
            ? current
            : statusFromAiState(nextState, notesInfo)
        );
      } catch (settingsError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorInfo(settingsError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingSettings(false);
        }
      }
    }

    void loadAiState();

    return () => {
      isMounted = false;
    };
  }, [
    targetBookId,
    notesInfo.status,
    notesInfo.status === "ready" ? notesInfo.exportableCount : undefined
  ]);

  useEffect(() => {
    let isMounted = true;

    async function loadSynthesisState() {
      if (!targetBookId || notesInfo.status !== "ready" || notesInfo.exportableCount <= 0) {
        setSynthesisPreview(undefined);
        setSynthesisJob(undefined);
        setSynthesisJobs(undefined);
        return;
      }

      setIsLoadingSynthesis(true);
      setSynthesisError(undefined);
      try {
        const [preview, jobs] = await Promise.all([
          previewNoteSynthesis(targetBookId),
          getNoteSynthesisJobSummary(targetBookId)
        ]);
        if (isMounted) {
          setSynthesisPreview(preview);
          setSynthesisJobs(jobs);
          setSynthesisJob(
            jobs.activeJob ??
              jobs.latestCompletedJob ??
              jobs.latestTerminalJob ??
              preview.activeJob
          );
        }
      } catch (loadError) {
        if (isMounted) {
          setSynthesisError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingSynthesis(false);
        }
      }
    }

    void loadSynthesisState();

    return () => {
      isMounted = false;
    };
  }, [
    targetBookId,
    notesInfo.status,
    notesInfo.status === "ready" ? notesInfo.exportableCount : undefined,
    notesInfo.status === "ready" ? notesInfo.notes : undefined,
    synthesisReloadToken
  ]);

  useEffect(() => {
    let isMounted = true;
    let timer: number | undefined;
    const activeStatus = synthesisJob?.status;
    if (!targetBookId || !synthesisJob || !["queued", "snapshotting", "batching", "summarizing", "merging"].includes(activeStatus ?? "")) {
      return;
    }

    const refresh = async () => {
      try {
        const nextJob = await getNoteSynthesisJob(synthesisJob.id);
        if (!isMounted) {
          return;
        }

        applySynthesisJob(nextJob);
        if (nextJob.status === "completed") {
          const variants = await getBookNotesSummaryVariants(targetBookId);
          if (isMounted) {
            setSummaryResponses(variants);
            setReviewMode("full");
            hasUserSelectedReviewMode.current = true;
            replaceReviewModeInLocation("full");
            if (variants.full) {
              setStatus(statusFromSource(variants.full.source));
            }
          }
        }
      } catch (loadError) {
        if (isMounted) {
          setSynthesisError(getCommandErrorMessage(loadError));
        }
      }
    };
    timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      isMounted = false;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [targetBookId, synthesisJob?.status]);

  function applySynthesisJob(nextJob: NoteSynthesisJob) {
    setSynthesisJob(nextJob);
    setSynthesisJobs((current) => {
      if (isActiveNoteSynthesisJob(nextJob)) {
        return { ...current, activeJob: nextJob };
      }

      if (nextJob.status === "completed") {
        return {
          ...current,
          activeJob: undefined,
          latestCompletedJob: nextJob,
          latestTerminalJob: nextJob
        };
      }

      return {
        ...current,
        activeJob: undefined,
        latestTerminalJob: nextJob
      };
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadReadingState() {
      if (!targetBookId) {
        setReadingState(undefined);
        setReadingStateError(undefined);
        return;
      }

      setIsLoadingReadingState(true);
      setReadingStateError(undefined);

      try {
        const state = await getReadingItemState(targetBookId);
        if (isMounted) {
          setReadingState(state);
        }
      } catch (stateError) {
        if (isMounted) {
          setReadingStateError(getCommandErrorMessage(stateError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingReadingState(false);
        }
      }
    }

    void loadReadingState();

    return () => {
      isMounted = false;
    };
  }, [targetBookId]);

  useEffect(() => {
    let isMounted = true;

    if (!targetBookId || !summaryInputHash) {
      setReviewFeedback(createEmptyReviewFeedback());
      return () => {
        isMounted = false;
      };
    }

    const feedbackScopeId = targetBookId;
    const feedbackInputHash = summaryInputHash;

    async function loadReviewFeedback() {
      try {
        const stored = await getAiReviewFeedback({
          feature: "book-review",
          scopeId: feedbackScopeId,
          inputHash: feedbackInputHash
        });
        if (!isMounted) {
          return;
        }

        if (hasAiReviewFeedback(stored)) {
          setReviewFeedback(stored);
          return;
        }

        const legacy = readAiReviewFeedback(getAiActionItemStorage(), feedbackScopeId, feedbackInputHash);
        setReviewFeedback(legacy);
        if (hasAiReviewFeedback(legacy)) {
          void saveReviewFeedbackState(feedbackScopeId, feedbackInputHash, legacy);
        }
      } catch {
        if (isMounted) {
          setReviewFeedback(readAiReviewFeedback(getAiActionItemStorage(), feedbackScopeId, feedbackInputHash));
        }
      }
    }

    void loadReviewFeedback();

    return () => {
      isMounted = false;
    };
  }, [targetBookId, summaryInputHash]);

  useEffect(() => {
    let isMounted = true;

    async function loadCachedSummary() {
      if (
        !targetBookId ||
        notesInfo.status !== "ready" ||
        notesInfo.notes.bookId !== targetBookId ||
        notesInfo.exportableCount <= 0
      ) {
        setIsLoadingSummaryCache(false);
        if (
          notesInfo.status === "ready" &&
          notesInfo.notes.bookId === targetBookId &&
          notesInfo.exportableCount <= 0
        ) {
          setStatus("empty-note");
        }
        return;
      }

      setIsLoadingSummaryCache(true);
      setError(undefined);
      setSummaryResponses({});
      setStatus("loading-cache");

      try {
        const cached = await getBookNotesSummaryVariants(targetBookId);

        if (!isMounted) {
          return;
        }

        setSummaryResponses(cached);
        const activeCached = reviewMode === "full" ? cached.full : cached.quick;
        if (activeCached) {
          setStatus(statusFromSource(activeCached.source));
          setError(activeCached.errorMessage ? { message: activeCached.errorMessage } : undefined);
          return;
        }

        setStatus(statusFromAiState(aiState, notesInfo));
      } catch (cacheError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorInfo(cacheError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingSummaryCache(false);
        }
      }
    }

    void loadCachedSummary();

    return () => {
      isMounted = false;
    };
  }, [
    targetBookId,
    notesInfo.status,
    notesInfo.status === "ready" ? notesInfo.exportableCount : undefined
  ]);

  async function handleStartSynthesis() {
    if (!targetBookId || !synthesisConsent) {
      return;
    }

    setIsLoadingSynthesis(true);
    setSynthesisError(undefined);
    try {
      const result = await startNoteSynthesis(targetBookId, new Date().toISOString());
      applySynthesisJob(result.job);
      setSynthesisConsent(false);
      showToast({
        message: result.created ? "完整复盘快照已创建，请点击“开始发送并归纳”。" : "已恢复这本书未完成的完整复盘任务。",
        tone: "success"
      });
    } catch (startError) {
      setSynthesisError(getCommandErrorMessage(startError));
    } finally {
      setIsLoadingSynthesis(false);
    }
  }

  async function handleContinueSynthesis(retryFailed: boolean) {
    if (!synthesisJob) {
      return;
    }

    setIsLoadingSynthesis(true);
    setSynthesisError(undefined);
    try {
      const nextJob = retryFailed
        ? await retryFailedNoteSynthesisBatches(synthesisJob.id)
        : await continueNoteSynthesis(synthesisJob.id);
      applySynthesisJob(nextJob);
      if (nextJob.status === "completed" && targetBookId) {
        const cached = await getBookNotesSummaryVariants(targetBookId);
        setSummaryResponses(cached);
        setReviewMode("full");
        hasUserSelectedReviewMode.current = true;
        replaceReviewModeInLocation("full");
        if (cached.full) {
          setStatus(statusFromSource(cached.full.source));
        }
      }
    } catch (continueError) {
      setSynthesisError(getCommandErrorMessage(continueError));
    } finally {
      setIsLoadingSynthesis(false);
    }
  }

  async function handleCancelSynthesis() {
    if (!synthesisJob) {
      return;
    }

    setIsLoadingSynthesis(true);
    setSynthesisError(undefined);
    try {
      applySynthesisJob(await cancelNoteSynthesis(synthesisJob.id));
    } catch (cancelError) {
      setSynthesisError(getCommandErrorMessage(cancelError));
    } finally {
      setIsLoadingSynthesis(false);
    }
  }

  async function handleGenerate(regenerate: boolean) {
    if (!targetBookId) {
      setStatus("error");
      setError({ message: "缺少书籍 ID，无法生成 书籍复盘。" });
      return;
    }

    if (
      notesInfo.status !== "ready" ||
      notesInfo.notes.bookId !== targetBookId
    ) {
      return;
    }

    if (notesInfo.exportableCount <= 0) {
      setStatus("empty-note");
      return;
    }

    if (aiState?.credential.hasCredential !== true) {
      setStatus("setup-required");
      return;
    }

    setStatus("generating");
    setError(undefined);

    try {
      const response = await summarizeBookNotes({
        bookId: targetBookId,
        regenerate,
        updateFrom: regenerate ? preparedUpdate : undefined
      });
      setSummaryResponses((current) => ({ ...current, quick: response }));
      setStatus(statusFromSource(response.source));
      if (response.errorMessage) {
        setError({ message: response.errorMessage });
      }
    } catch (summaryError) {
      setStatus("error");
      setError(getCommandErrorInfo(summaryError));
    }
  }

  async function exportBookReview(
    targets: ExternalExportTarget[],
    confirmation: AssetExportConfirmation
  ): Promise<MultiTargetExportResponse> {
    if (!targetBookId || !hasSummary) {
      throw new Error("当前没有可导出的书籍复盘。");
    }

    const response = await exportBookNotesSummaryTargets(
      targetBookId,
      reviewFeedback,
      buildMultiTargetExportRequest(
        targets,
        confirmation.confirmImaBodyExport,
        confirmation.forceImaNewSnapshot
      ),
      reviewMode,
      activeSummaryResponse?.inputHash
    );
    showToast(formatMultiTargetExportToast(response));
    return response;
  }

  async function handleMarkOrganized() {
    if (!targetBookId || !hasSummary) {
      return;
    }

    setIsLoadingReadingState(true);
    setReadingStateError(undefined);

    try {
      const nextState = await patchReadingItemState(
        targetBookId,
        { organizeStatus: "organized" },
        {
          itemKind: "book",
          title: displayBook?.title,
          author: displayBook?.author,
          cover: displayBook?.cover
        }
      );
      setReadingState(nextState);
      showToast({ message: "已标记为「已整理」", tone: "success" });
    } catch (stateError) {
      const message = getCommandErrorMessage(stateError);
      setReadingStateError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsLoadingReadingState(false);
    }
  }

  async function handleCopySection(title: string, items: string[]) {
    if (items.length === 0) {
      return;
    }

    try {
      await copyTextToClipboard(formatSummarySection(title, items));
      showToast({
        message: formatSummarySectionCopiedMessage(title),
        tone: "success"
      });
    } catch (copySectionError) {
      showToast({
        message: copySectionError instanceof Error ? copySectionError.message : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  async function handleCopyFullSummary() {
    if (!summary) {
      return;
    }

    try {
      await copyTextToClipboard(
        formatFullSummary({
          book: displayBook,
          providerModel: activeSummaryResponse?.providerModel,
          reviewFeedback,
          responseSource: activeSummaryResponse?.source,
          sourceStats,
          summary
        })
      );
      showToast({
        message: formatArtifactCopiedMessage("book-review-markdown"),
        tone: "success"
      });
    } catch (copyFullError) {
      showToast({
        message: copyFullError instanceof Error ? copyFullError.message : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  function handleActionFeedbackChange(itemId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!targetBookId || !summaryInputHash) {
      return;
    }

    setReviewFeedback((current) => {
      const next = {
        ...current,
        actionItems: updateFeedbackById(current.actionItems, itemId, feedback)
      };

      void persistReviewFeedbackState(targetBookId, summaryInputHash, next);
      return next;
    });
  }

  function handleReflectionFeedbackChange(questionId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!targetBookId || !summaryInputHash) {
      return;
    }

    setReviewFeedback((current) => {
      const next = {
        ...current,
        reflectionQuestions: updateFeedbackById(current.reflectionQuestions, questionId, feedback)
      };

      void persistReviewFeedbackState(targetBookId, summaryInputHash, next);
      return next;
    });
  }

  async function handleCopyActionChecklist(items: string[]) {
    if (items.length === 0) {
      return;
    }

    try {
      await copyTextToClipboard(formatActionChecklist(items, reviewFeedback.actionItems));
      showToast({
        message: formatArtifactCopiedMessage("action-checklist"),
        tone: "success"
      });
    } catch (copyActionChecklistError) {
      showToast({
        message:
          copyActionChecklistError instanceof Error
            ? copyActionChecklistError.message
            : "复制失败，请稍后重试。",
        tone: "warning"
      });
    }
  }

  return (
    <section className="ai-summary-page" aria-label="单本 书籍复盘">
      <button className="text-button back-button" type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={16} />
        {backLabel}
      </button>

      <section className="ai-summary-hero">
        <div className="ai-summary-icon">
          <Bot aria-hidden="true" size={24} />
        </div>
        <div>
          <p className="section-kicker">本地 书籍复盘</p>
          <h3>{displayBook?.title ? `《${displayBook.title}》书籍复盘` : "书籍复盘"}</h3>
          <p>
            {reviewMode === "full" && isFullSnapshotSummary
              ? "本次完整复盘基于已固定的任务快照生成。"
              : reviewMode === "quick" && hasQuickSummary
                ? "本次快速复盘使用有限样本生成。"
                : "读取已保存复盘；点击生成时使用当前书笔记。"}
          </p>
          {reviewMode === "quick" && readyNotes ? (
            <small className="ai-summary-quick-coverage">
              {hasQuickSummary
                ? `本次使用 ${quickSummaryIncludedCount} / ${quickSummaryAvailableCount} 条笔记，按章节分层抽样，不代表全量覆盖。`
                : `快速复盘最多使用 ${quickReviewBudgetCount} / ${quickReviewAvailableCount} 条，按章节分层抽样，不代表全量覆盖。`}
            </small>
          ) : null}
          {reviewMode === "full" && isFullSnapshotSummary && completedSynthesisJob ? (
            <small className="ai-summary-quick-coverage">
              完整快照已覆盖 {completedSynthesisJob.processedCount} / {completedSynthesisJob.totalCount} 条笔记。
            </small>
          ) : null}
          {displayBook?.author ? <small>{displayBook.author}</small> : null}
        </div>
        <div className="ai-summary-hero-side">
          <span className={`ai-summary-badge ai-summary-badge--${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
          <div className="ai-summary-actions">
            {reviewMode === "quick" ? (
              hasQuickSummary ? (
                <button
                  className="sync-button"
                  type="button"
                  onClick={() => void handleGenerate(true)}
                  disabled={!canGenerate}
                  aria-busy={status === "generating"}
                >
                  {status === "generating" ? (
                    <Loader2 aria-hidden="true" size={18} className="spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" size={18} />
                  )}
                  {status === "generating" ? "重新生成中" : "重新生成快速复盘"}
                </button>
              ) : (
                <button
                  className="sync-button"
                  type="button"
                  onClick={() => void handleGenerate(false)}
                  disabled={!canGenerate}
                  aria-busy={status === "generating" || isLoadingSummaryCache || notesInfo.status === "loading"}
                >
                  {status === "generating" || isLoadingSummaryCache ? (
                    <Loader2 aria-hidden="true" size={18} className="spin" />
                  ) : (
                    <Database aria-hidden="true" size={18} />
                  )}
                  {notesInfo.status === "loading"
                    ? "读取笔记中"
                    : status === "generating"
                      ? "生成中"
                      : isLoadingSummaryCache
                        ? "读取缓存中"
                        : "生成快速复盘"}
                </button>
              )
            ) : null}
            {hasSummary ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void handleCopyFullSummary()}
                >
                  <Copy aria-hidden="true" size={18} />
                  {reviewMode === "full" ? "复制完整复盘" : "复制快速复盘"}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setIsAssetExportOpen(true)}
                  disabled={isLoadingSummaryCache || status === "generating"}
                >
                  <Download aria-hidden="true" size={18} />
                  {reviewMode === "full" ? "导出完整复盘" : "导出快速复盘"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <div className="ai-summary-mode-tabs" role="tablist" aria-label="复盘模式">
        <button
          className={`ai-summary-mode-tab${reviewMode === "quick" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={reviewMode === "quick"}
          onClick={() => handleReviewModeChange("quick")}
        >
          <Sparkles aria-hidden="true" size={16} />
          快速复盘（抽样）
        </button>
        <button
          className={`ai-summary-mode-tab${reviewMode === "full" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={reviewMode === "full"}
          onClick={() => handleReviewModeChange("full")}
        >
          <Database aria-hidden="true" size={16} />
          完整复盘（快照）
        </button>
      </div>

      {reviewMode === "full" && synthesisPreview ? (
        <NoteSynthesisJobCard
          preview={synthesisPreview}
          job={synthesisJob}
          resultVisible={Boolean(hasSummary && isFullSnapshotSummary)}
          consent={synthesisConsent}
          loading={isLoadingSynthesis}
          error={synthesisError}
          onConsentChange={setSynthesisConsent}
          onStart={() => void handleStartSynthesis()}
          onContinue={() => void handleContinueSynthesis(false)}
          onRetry={() => void handleContinueSynthesis(true)}
          onCancel={() => void handleCancelSynthesis()}
          onViewResult={() => {
            handleReviewModeChange("full");
            document.getElementById("book-review-result")?.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }}
          onCreateNew={() => {
            setSynthesisJob(undefined);
            setSynthesisPreview((current) => (current ? { ...current, activeJob: undefined } : current));
            setSynthesisJobs((current) => (current ? { ...current, activeJob: undefined } : current));
            setSynthesisConsent(false);
          }}
        />
      ) : null}

      {reviewMode === "full" && synthesisError && !synthesisPreview ? (
        <section className="ai-summary-callout ai-summary-callout--synthesis" role="alert" aria-label="完整复盘状态读取失败">
          <AlertCircle aria-hidden="true" size={18} />
          <div>
            <strong>完整复盘状态读取失败</strong>
            <p>{synthesisError}</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => setSynthesisReloadToken((current) => current + 1)}
            disabled={isLoadingSynthesis}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {isLoadingSynthesis ? "重新读取中" : "重新读取完整复盘状态"}
          </button>
        </section>
      ) : null}

      {reviewMode === "quick" && synthesisPreview ? (
        <section className={`ai-summary-boundary-strip ai-summary-boundary-strip--full-entry${hasQuickSummary ? " ai-summary-boundary-strip--compact" : ""}`} aria-label="完整复盘入口">
          <Database aria-hidden="true" size={18} />
          <div>
            <strong>想覆盖当前书的全部可处理笔记？</strong>
            <p>
              {synthesisJob && isActiveNoteSynthesisJob(synthesisJob)
                ? "完整复盘任务正在处理中，可切换到完整复盘查看进度。"
                : synthesisJob?.status === "partial"
                  ? "完整复盘有失败批次待重试，可切换到完整复盘处理。"
                : "进入完整复盘，创建快照后再决定是否发送原始笔记正文。"}
            </p>
          </div>
          <button className="secondary-action" type="button" onClick={() => handleReviewModeChange("full")}>
            <Database aria-hidden="true" size={18} />
            进入完整复盘
          </button>
        </section>
      ) : null}

      <section className={`ai-summary-boundary-strip ai-summary-boundary-strip--source${hasSummary ? " ai-summary-boundary-strip--result" : ""}`} aria-label="书籍复盘数据边界">
        <Database aria-hidden="true" size={18} />
        <div>
          <strong>
            {reviewMode === "full" && isFullSnapshotSummary
              ? completedSnapshotIsStale
                ? "完整快照复盘 · 旧快照"
                : "完整快照复盘"
              : reviewMode === "full" && fullSummaryResponse
                ? `完整复盘 · ${sourceLabelFromResponse(fullSummaryResponse.source)}`
                : quickSummaryResponse
                  ? `快速复盘 · ${sourceLabelFromResponse(quickSummaryResponse.source)}`
                : "待生成"}
          </strong>
          <p>
            {reviewMode === "full" && hasPendingFullTask
              ? "完整复盘任务进行中；上一版结果不会冒充当前任务，完成后将显示新的快照结果。"
              : reviewMode === "full" && isFullSnapshotSummary && completedSynthesisJob
              ? `基于任务快照中的 ${completedSynthesisJob.processedCount} / ${completedSynthesisJob.totalCount} 条笔记生成，任务 ${completedSynthesisJob.id}。`
              : reviewMode === "full"
                ? "完整复盘结果只在任务完成并通过覆盖校验后作为正式成果展示。"
              : activeSummaryResponse
                  ? "本次展示内容来自有限样本，不代表全量覆盖。"
                  : "点击“生成快速复盘”时使用当前书笔记。"}
          </p>
        </div>
      </section>

      {hasSummary ? (
        <ReviewCompletionStrip
          isOrganized={isOrganized}
          isLoading={isLoadingReadingState}
          error={readingStateError}
          onMarkOrganized={() => void handleMarkOrganized()}
        />
      ) : null}

      {preparedUpdate ? (
        <section className="ai-summary-boundary-strip ai-summary-boundary-strip--prepared" aria-label="准备更新上下文">
          <RefreshCw aria-hidden="true" size={18} />
          <div>
            <strong>准备更新上一版书籍复盘</strong>
            <p>将参考你上次记录的阅读成果生成新版，避免重复给出已完成或不适合的建议。</p>
          </div>
        </section>
      ) : null}

      {notesInfo.status === "loading" ? (
        <div className="ai-summary-loading" aria-live="polite">
          <Loader2 aria-hidden="true" size={20} className="spin" />
          <span>正在读取当前书真实笔记</span>
        </div>
      ) : null}

      {notesInfo.status === "unknown" && notesError ? (
        <div className="ai-summary-callout" role="alert">
          <AlertCircle aria-hidden="true" size={20} />
          <div>
            <strong>真实笔记读取失败</strong>
            <p>{getCommandErrorMessage(notesError)}</p>
          </div>
          {targetBookId ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => setNotesReloadToken((current) => current + 1)}
            >
              <RefreshCw aria-hidden="true" size={18} />
              重新读取笔记
            </button>
          ) : null}
        </div>
      ) : null}

      {status === "setup-required" ? (
        <div className="ai-summary-callout">
          <Settings aria-hidden="true" size={20} />
          <div>
            <strong>需要先配置 AI Provider</strong>
            <p>AI Key 保存在本机安全存储中，页面不会显示已保存密钥。</p>
          </div>
          <button className="secondary-action" type="button" onClick={() => onOpenSettings()}>
            去设置
          </button>
        </div>
      ) : null}

      {status === "empty-note" ? (
        <div className="ai-summary-callout">
          <AlertCircle aria-hidden="true" size={20} />
          <div>
            <strong>没有可总结的划线或想法</strong>
            <p>请先同步这本书的笔记，或在本地阅读器中写下想法；书签正文不会被微信读书接口返回。</p>
          </div>
        </div>
      ) : null}

      {error?.code === "upgrade_required" ? (
        <SkillUpgradeNotice error={error} onRetry={() => void handleGenerate(true)} />
      ) : error ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{getCommandErrorMessage(error)}</span>
        </div>
      ) : null}

      {isLoadingSettings ? (
        <div className="ai-summary-loading">
          <Loader2 aria-hidden="true" size={20} className="spin" />
          <span>正在读取本机 AI 设置</span>
        </div>
      ) : null}

      {isLoadingSummaryCache ? (
        <div className="ai-summary-loading">
          <Loader2 aria-hidden="true" size={20} className="spin" />
          <span>正在读取本地 书籍复盘缓存</span>
        </div>
      ) : null}

      {summary && hasSummary ? (
        <div className="ai-summary-content" id="book-review-result">
          <section className="ai-summary-overview" aria-label="书籍复盘概览">
            <CheckCircle2 aria-hidden="true" size={20} />
            <div>
              <h4>概览</h4>
              <p>{summary.overview}</p>
              <small>{summary.basisNotice}</small>
            </div>
          </section>

          <FeedbackOutcomeSummarySection summary={summary.feedbackOutcomeSummary} onAskInsight={onAskInsight} />

          <section className="ai-summary-section" aria-label="主题标签">
            <h4>
              <Tags aria-hidden="true" size={18} />
              主题标签
            </h4>
            <div className="ai-summary-tags">
              {summary.themeTags.length > 0 ? (
                summary.themeTags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <p>这次总结没有提取到稳定主题标签。</p>
              )}
            </div>
          </section>

          <BookInsightSection summary={summary} onAskInsight={onAskInsight} />

          <div className="ai-summary-grid">
            <SummaryList
              title="关键观点"
              icon={<Lightbulb aria-hidden="true" size={18} />}
              items={summary.keyIdeas}
              emptyText="这次总结没有提取到明确关键观点。"
              onCopy={(items) => void handleCopySection("关键观点", items)}
            />
            <SummaryList
              title="我的关注点"
              icon={<Target aria-hidden="true" size={18} />}
              items={summary.myFocus}
              emptyText="当前笔记还不足以判断稳定关注点。"
              onCopy={(items) => void handleCopySection("我的关注点", items)}
            />
            <ActionItemChecklist
              title="下一步行动"
              icon={<ListChecks aria-hidden="true" size={18} />}
              items={summary.actionItems}
              emptyText="这次总结没有生成下一步行动。"
              feedbackByItemId={reviewFeedback.actionItems}
              onFeedbackChange={handleActionFeedbackChange}
              onCopy={(items) => void handleCopyActionChecklist(items)}
              onAskAction={onAskInsight}
            />
          </div>

          <section className="ai-summary-section" aria-label="代表性摘录">
            <h4>
              <Quote aria-hidden="true" size={18} />
              代表性摘录
            </h4>
            <div className="ai-quote-grid">
              {summary.representativeQuotes.length > 0 ? (
                summary.representativeQuotes.map((item) => (
                  <RepresentativeQuoteCard key={`${item.quote}-${item.reason}`} quote={item} />
                ))
              ) : (
                <p>这次总结没有返回可核对的代表性摘录。</p>
              )}
            </div>
          </section>

          <ReflectionQuestionChecklist
            title="复盘问题"
            icon={<Sparkles aria-hidden="true" size={18} />}
            items={summary.reflectionQuestions}
            emptyText="这次总结没有生成复盘问题。"
            feedbackByQuestionId={reviewFeedback.reflectionQuestions}
            onFeedbackChange={handleReflectionFeedbackChange}
            onCopy={(items) => void handleCopySection("复盘问题", items)}
          />
        </div>
      ) : (
        <div className="ai-summary-placeholder">
          <Sparkles aria-hidden="true" size={20} />
          <p>
            {reviewMode === "full"
              ? "完整复盘需要先创建快照，再由你确认是否发送原始笔记正文。"
              : "点击“生成快速复盘”后，会使用当前书笔记生成有限样本复盘。"}
          </p>
        </div>
      )}

      {hasSourceStats ? (
        <section className="ai-summary-source-card" aria-label="书籍复盘来源统计">
          <div>
            <strong>来源统计</strong>
            <small>
              {reviewMode === "full" && isFullSnapshotSummary
                ? "完整复盘统计来自任务快照；覆盖量以任务完成校验为准。"
                : reviewMode === "full"
                  ? "当前笔记统计仅供快照预览，不代表已创建或完成完整复盘任务。"
                : sourceStats.selection
                ? `按章节分层抽样，覆盖 ${sourceStats.selection.coveredChapterCount} 个章节；不代表全量覆盖。`
                : "仅统计当前书本地笔记；书签只计数量，不含正文。"}
            </small>
          </div>
          <div className="ai-summary-stats">
            <SummaryStat label="划线" value={sourceStats.highlightCount} />
            <SummaryStat label="想法" value={sourceStats.thoughtCount} />
            <SummaryStat label="书签" value={sourceStats.bookmarkCount} />
            <SummaryStat label="章节" value={sourceStats.chapterCount} />
            <SummaryStat label="纳入划线" value={sourceStats.includedHighlightCount} />
            <SummaryStat label="纳入想法" value={sourceStats.includedThoughtCount} />
          </div>
        </section>
      ) : null}

      <div className="ai-summary-meta">
        <span>生成时间：{formatAiTimestamp(visibleSummary?.generatedAt) || "尚未生成"}</span>
        {visibleSummary?.responseFormat ? <span>{formatAiResponseFormat(visibleSummary.responseFormat)}</span> : null}
        {activeSummaryResponse?.providerModel ? <span>模型：{activeSummaryResponse.providerModel}</span> : null}
        {activeSummaryResponse?.cachedUpdatedAt ? (
          <span>缓存更新：{formatAiTimestamp(activeSummaryResponse.cachedUpdatedAt)}</span>
        ) : null}
      </div>

      <AssetExportDialog
        open={isAssetExportOpen}
        ariaLabel="导出书籍复盘"
        assetTitle="导出书籍复盘"
        assetDescription={displayBook?.title ? `《${displayBook.title}》` : undefined}
        sourceKind="bookReview"
        platformMode={resolveExportPlatformMode()}
        availableTargets={["markdown", "obsidian", "notion", "ima"]}
        onExport={exportBookReview}
        onOpenSettings={() => onOpenSettings("export")}
        onClose={() => setIsAssetExportOpen(false)}
      />
    </section>
  );

  async function persistReviewFeedbackState(
    scopeId: string,
    inputHash: string,
    feedback: AiReviewFeedbackState
  ) {
    writeAiReviewFeedback(getAiActionItemStorage(), scopeId, inputHash, feedback);
    await saveReviewFeedbackState(scopeId, inputHash, feedback);
  }

  async function saveReviewFeedbackState(
    scopeId: string,
    inputHash: string,
    feedback: AiReviewFeedbackState
  ) {
    try {
      await saveAiReviewFeedback({
        feature: "book-review",
        scopeId,
        inputHash,
        feedback
      });
    } catch {
      // 后端不可用时仍保留 localStorage 兜底，避免用户刚输入的反馈丢失。
    }
  }
}

function ReviewCompletionStrip({
  isOrganized,
  isLoading,
  error,
  onMarkOrganized
}: {
  isOrganized: boolean;
  isLoading: boolean;
  error?: string;
  onMarkOrganized: () => void;
}) {
  return (
    <section className={`review-completion-strip review-completion-strip--compact${isOrganized ? " is-organized" : ""}`} aria-label="复盘整理状态">
      <div className="review-completion-icon">
        {isOrganized ? <CheckCircle2 aria-hidden="true" size={20} /> : <ListChecks aria-hidden="true" size={20} />}
      </div>
      <div>
        <p className="section-kicker">整理状态</p>
        <h4>{isOrganized ? "已整理" : "待整理"}</h4>
        <p>
          {isOrganized
            ? "这本书的复盘已经被你确认吸收，后续总览会降低它的复盘提醒。"
            : "这份复盘已经生成；确认吸收后，可以手动标记为已整理。"}
        </p>
        {error ? <small>{error}</small> : null}
      </div>
      {!isOrganized ? (
        <button className="secondary-action" type="button" onClick={onMarkOrganized} disabled={isLoading}>
          {isLoading ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <CheckCircle2 aria-hidden="true" size={18} />}
          {isLoading ? "标记中" : "标记已整理"}
        </button>
      ) : null}
    </section>
  );
}

function SummaryList({
  title,
  icon,
  items,
  emptyText,
  onCopy
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyText: string;
  onCopy?: (items: string[]) => void;
}) {
  return (
    <section className="ai-summary-list" aria-label={title}>
      <div className="ai-summary-list-heading">
        <h4>
          {icon}
          {title}
        </h4>
        {items.length > 0 && onCopy ? (
          <button className="text-button ai-summary-copy-button" type="button" onClick={() => onCopy(items)}>
            <Copy aria-hidden="true" size={15} />
            复制
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function ActionItemChecklist({
  title,
  icon,
  items,
  emptyText,
  feedbackByItemId,
  onFeedbackChange,
  onCopy,
  onAskAction
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyText: string;
  feedbackByItemId: AiActionFeedbackByItemId;
  onFeedbackChange: (itemId: string, feedback: AiActionFeedbackRecord | undefined) => void;
  onCopy: (items: string[]) => void;
  onAskAction?: (draft: string) => void;
}) {
  return (
    <AiActionFeedbackChecklist
      title={title}
      ariaLabel={title}
      icon={icon}
      items={items.map((item, index) => ({
        id: buildAiActionItemId(item, index),
        text: item
      }))}
      emptyText={emptyText}
      feedbackByItemId={feedbackByItemId}
      onFeedbackChange={onFeedbackChange}
      onAskItem={onAskAction ? (item) => onAskAction(buildActionItemAssistantDraft(item.text)) : undefined}
      askItemLabel="拆解"
      onCopy={() => onCopy(items)}
      copyButton={
        <>
          <Copy aria-hidden="true" size={15} />
          复制行动清单
        </>
      }
    />
  );
}

function ReflectionQuestionChecklist({
  title,
  icon,
  items,
  emptyText,
  feedbackByQuestionId,
  onFeedbackChange,
  onCopy
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  emptyText: string;
  feedbackByQuestionId: AiActionFeedbackByItemId;
  onFeedbackChange: (questionId: string, feedback: AiActionFeedbackRecord | undefined) => void;
  onCopy: (items: string[]) => void;
}) {
  return (
    <AiActionFeedbackChecklist
      title={title}
      ariaLabel={title}
      icon={icon}
      items={items.map((item, index) => ({
        id: buildAiReflectionQuestionId(item, index),
        text: item
      }))}
      emptyText={emptyText}
      feedbackByItemId={feedbackByQuestionId}
      onFeedbackChange={onFeedbackChange}
      onCopy={() => onCopy(items)}
      copyButton={
        <>
          <Copy aria-hidden="true" size={15} />
          复制复盘问题
        </>
      }
      labels={reflectionFeedbackLabels}
    />
  );
}

export function NoteSynthesisJobCard({
  preview,
  job,
  resultVisible = false,
  consent,
  loading,
  error,
  onConsentChange,
  onStart,
  onContinue,
  onRetry,
  onCancel,
  onViewResult,
  onCreateNew
}: {
  preview: NoteSynthesisPreview;
  job?: NoteSynthesisJob;
  resultVisible?: boolean;
  consent: boolean;
  loading: boolean;
  error?: string;
  onConsentChange: (value: boolean) => void;
  onStart: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onViewResult: () => void;
  onCreateNew: () => void;
}) {
  const statusLabel: Record<NoteSynthesisJob["status"], string> = {
    queued: "已创建，等待继续",
    snapshotting: "正在创建快照",
    batching: "正在稳定分批",
    summarizing: "正在归纳批次",
    merging: "正在合并复盘",
    completed: "完整复盘已完成",
    partial: "部分批次失败",
    failed: "任务失败",
    cancelled: "任务已取消"
  };
  const activeJob = job ?? preview.activeJob;
  const progress = activeJob
    ? Math.round((activeJob.processedCount / Math.max(activeJob.totalCount, 1)) * 100)
    : 0;
  const canContinue = activeJob?.status === "queued";
  const canRetry = Boolean(
    activeJob &&
      ["partial", "failed"].includes(activeJob.status) &&
      activeJob.failedBatches.length > 0
  );
  const canCancel = Boolean(
    activeJob &&
      ["queued", "snapshotting", "batching", "summarizing", "merging"].includes(
        activeJob.status
      )
  );
  const snapshotIsStale = isNoteSynthesisSnapshotStale(preview, activeJob);
  const displayedStatus = snapshotIsStale
    ? "完整复盘已完成 · 旧快照"
    : activeJob
      ? statusLabel[activeJob.status]
      : undefined;

  return (
    <section className="ai-summary-boundary-strip ai-summary-synthesis-card" aria-label="完整复盘任务">
      <Database aria-hidden="true" size={20} />
      <div className="ai-summary-synthesis-card__body">
        <div className="ai-summary-synthesis-card__heading">
          <div>
            <strong>完整复盘</strong>
            <p>
              {activeJob
                ? `任务快照已固定：${activeJob.totalCount} 条笔记，${activeJob.batchCount} 个批次。`
                : `当前可处理笔记：${preview.totalCount} 条（划线 ${preview.highlightCount} 条、想法 ${preview.thoughtCount} 条），预计 ${preview.estimatedBatchCount} 个批次。`}
            </p>
          </div>
          {activeJob ? (
            <span
              className={`ai-summary-badge ${snapshotIsStale ? "ai-summary-badge--warning" : "ai-summary-badge--neutral"}`}
            >
              {displayedStatus}
            </span>
          ) : null}
        </div>

        {activeJob ? (
          <>
            <div className="ai-summary-synthesis-progress" aria-label={`完整复盘进度 ${progress}%`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="ai-summary-synthesis-meta">
              <span>已处理 {activeJob.processedCount} / {activeJob.totalCount}</span>
              <span>批次 {activeJob.completedBatchCount} / {activeJob.batchCount}</span>
              <span>模型：{activeJob.providerModel}</span>
              {activeJob.finishedAt ? <span>完成：{formatAiTimestamp(activeJob.finishedAt)}</span> : null}
            </div>
            {activeJob.status === "completed" &&
            (activeJob.coverage.skippedDuplicateCount > 0 ||
              activeJob.coverage.skippedEmptyCount > 0) ? (
              <p>
                跳过重复 {activeJob.coverage.skippedDuplicateCount} 条 · 空正文 {activeJob.coverage.skippedEmptyCount} 条
              </p>
            ) : null}
            {snapshotIsStale ? (
              <p className="ai-summary-snapshot-warning">
                当前书籍已有新笔记或修改；本复盘基于旧快照，未包含这些变化。
              </p>
            ) : null}
            {activeJob.errorMessage ? <p className="ai-summary-synthesis-error">{activeJob.errorMessage}</p> : null}
            {activeJob.failedBatches.length > 0 ? (
              <p className="ai-summary-synthesis-error">失败批次：{activeJob.failedBatches.map((batch) => batch.batchIndex + 1).join("、")}，可单独重试。</p>
            ) : null}
            <div className="ai-summary-actions">
              {canContinue ? (
                <button className="sync-button" type="button" onClick={onContinue} disabled={loading}>
                  {loading ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <RefreshCw aria-hidden="true" size={18} />}
                  {activeJob.status === "queued" ? "开始发送并归纳" : "继续归纳"}
                </button>
              ) : null}
              {canRetry ? (
                <button className="secondary-action" type="button" onClick={onRetry} disabled={loading}>
                  重试失败批次
                </button>
              ) : null}
              {activeJob.status === "failed" && activeJob.failedBatches.length === 0 ? (
                <p className="ai-summary-synthesis-error">该任务无法继续或重试；请创建新的快照任务后再归纳。</p>
              ) : null}
              {activeJob.status === "completed" && !resultVisible ? (
                <button className="sync-button" type="button" onClick={onViewResult}>
                  查看完整复盘
                </button>
              ) : null}
              {snapshotIsStale ? (
                <button className="secondary-action" type="button" onClick={onCreateNew} disabled={loading}>
                  创建新快照
                </button>
              ) : null}
              {["failed", "cancelled"].includes(activeJob.status) ? (
                <button className="secondary-action" type="button" onClick={onCreateNew} disabled={loading}>
                  创建新的快照
                </button>
              ) : null}
              {canCancel ? (
                <button className="secondary-action" type="button" onClick={onCancel} disabled={loading}>
                  取消任务
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <label className="ai-summary-synthesis-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => onConsentChange(event.target.checked)}
              />
              <span>我确认：开始完整复盘后，当前快照中的原始笔记正文会发送给 Provider（{preview.providerLabel} / {preview.providerModel}）。</span>
            </label>
            <button className="sync-button" type="button" onClick={onStart} disabled={!consent || loading}>
              {loading ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <Sparkles aria-hidden="true" size={18} />}
              创建本地快照
            </button>
          </>
        )}
        {error ? <p className="ai-summary-synthesis-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

export function isActiveNoteSynthesisJob(job: NoteSynthesisJob | undefined): boolean {
  return Boolean(
    job &&
      ["queued", "snapshotting", "batching", "summarizing", "merging"].includes(
        job.status
      )
  );
}

export function isNoteSynthesisSnapshotStale(
  preview: NoteSynthesisPreview | undefined,
  job: NoteSynthesisJob | undefined
): boolean {
  return Boolean(
    preview &&
      job?.status === "completed" &&
      preview.currentSourceHash !== job.sourceSnapshotHash
  );
}

export function isVerifiedFullSnapshotSummary(
  job: NoteSynthesisJob | undefined,
  response: BookAiSummaryResponse | undefined
): boolean {
  return Boolean(
    job &&
      response &&
      response.source !== "empty" &&
      job.status === "completed" &&
      job.coverage.fullSnapshot &&
      job.processedCount === job.totalCount &&
      job.failedBatchCount === 0 &&
      job.coverage.failedItemCount === 0 &&
      job.result?.feature === "book-notes-summary" &&
      job.result.promptVersion === response.promptVersion &&
      job.result.inputHash === response.inputHash
  );
}

function formatSummarySection(title: string, items: string[]): string {
  return [`## ${title}`, ...items.map((item, index) => `${index + 1}. ${item}`)].join("\n");
}

function formatSummarySectionCopiedMessage(title: string): string {
  const artifactKind = artifactKindFromSummarySectionTitle(title);
  return artifactKind ? formatArtifactCopiedMessage(artifactKind) : `已复制「${title}」`;
}

function artifactKindFromSummarySectionTitle(title: string): ReadingArtifactKind | undefined {
  if (title === "复盘问题") {
    return "reflection-questions";
  }

  return undefined;
}

function formatActionChecklist(items: string[], feedbackByItemId: AiActionFeedbackByItemId): string {
  return [
    "## 下一步行动",
    ...items.map((item, index) => {
      const itemId = buildAiActionItemId(item, index);
      const feedback = feedbackByItemId[itemId];
      const marker = feedback?.status === "completed" ? "x" : " ";
      const suffix = feedback ? `（${actionFeedbackStatusLabel(feedback.status)}）` : "";
      const noteLines = feedback?.note
        ? feedback.note.split("\n").map((line) => (line ? `  - 反馈记录：${line}` : ""))
        : [];
      return [`- [${marker}] ${item}${suffix}`, ...noteLines].join("\n");
    })
  ].join("\n");
}

function createEmptyReviewFeedback(): AiReviewFeedbackState {
  return {
    actionItems: {},
    reflectionQuestions: {}
  };
}

function updateFeedbackById(
  feedbackByItemId: AiActionFeedbackByItemId,
  itemId: string,
  feedback: AiActionFeedbackRecord | undefined
): AiActionFeedbackByItemId {
  const next = { ...feedbackByItemId };

  if (feedback) {
    next[itemId] = feedback;
  } else {
    delete next[itemId];
  }

  return next;
}

function formatFullSummary({
  book,
  providerModel,
  reviewFeedback,
  responseSource,
  sourceStats,
  summary
}: {
  book?: NotebookBook;
  providerModel?: string;
  reviewFeedback: AiReviewFeedbackExport;
  responseSource?: BookAiSummaryResponse["source"];
  sourceStats: BookAiSummarySourceStats;
  summary: BookAiSummary;
}): string {
  const title = book?.title ? `《${book.title}》书籍复盘` : "书籍复盘";
  const feedbackOutcomeMarkdown = formatFeedbackOutcomeSummary(summary.feedbackOutcomeSummary);
  const metaLines = [
    book?.author ? `作者：${book.author}` : undefined,
    `生成时间：${formatAiTimestamp(summary.generatedAt) || "未知"}`,
    `Prompt：${summary.promptVersion}`,
    summary.responseFormat ? formatAiResponseFormat(summary.responseFormat) : undefined,
    providerModel ? `模型：${providerModel}` : undefined,
    responseSource ? `来源：${sourceLabelFromResponse(responseSource)}` : undefined,
    `输入统计：划线 ${sourceStats.highlightCount} 条，想法 ${sourceStats.thoughtCount} 条，书签 ${sourceStats.bookmarkCount} 个，章节 ${sourceStats.chapterCount} 个`
  ].filter(Boolean);

  return [
    `# ${title}`,
    ...metaLines,
    "",
    "## 概览",
    summary.overview,
    summary.basisNotice,
    "",
    ...(feedbackOutcomeMarkdown ? [feedbackOutcomeMarkdown, ""] : []),
    formatSummarySection("主题标签", summary.themeTags),
    "",
    formatBookInsights(summary),
    "",
    formatSummarySection("关键观点", summary.keyIdeas),
    "",
    formatSummarySection("我的关注点", summary.myFocus),
    "",
    formatSummarySection("下一步行动", summary.actionItems),
    "",
    formatFeedbackSection("下一步行动反馈记录", summary.actionItems, reviewFeedback.actionItems, buildAiActionItemId, actionFeedbackStatusLabel),
    "",
    formatRepresentativeQuotes(summary.representativeQuotes),
    "",
    formatSummarySection("复盘问题", summary.reflectionQuestions),
    "",
    formatFeedbackSection(
      "复盘问题反馈记录",
      summary.reflectionQuestions,
      reviewFeedback.reflectionQuestions,
      buildAiReflectionQuestionId,
      reflectionFeedbackStatusLabel
    ),
    "",
    "## 数据边界",
    "本内容基于当前书本地笔记生成；书签只计数量，不含正文；不会包含 API Key、数据库路径或原始接口字段。"
  ].join("\n");
}

function formatFeedbackOutcomeSummary(summary?: FeedbackOutcomeSummary): string | undefined {
  if (!summary?.summary) {
    return undefined;
  }

  const appliedChanges = summary.appliedChanges?.slice(0, 3) ?? [];
  return [
    "## 反馈沉淀",
    summary.summary,
    ...(appliedChanges.length > 0 ? ["", "本次吸收：", ...appliedChanges.map((item) => `- ${item}`)] : [])
  ].join("\n");
}

function formatFeedbackSection(
  title: string,
  items: string[],
  feedbackByItemId: AiActionFeedbackByItemId,
  buildItemId: (text: string, index: number) => string,
  statusLabel: (status: AiActionFeedbackRecord["status"]) => string
): string {
  const lines = items.flatMap((item, index) => {
    const feedback = feedbackByItemId[buildItemId(item, index)];
    if (!feedback) {
      return [];
    }

    const noteLines = feedback.note
      ? ["", ...feedback.note.split("\n").map((line) => (line ? `   - 记录：${line}` : ""))]
      : [];
    return [`${index + 1}. ${item}`, `   - 状态：${statusLabel(feedback.status)}`, ...noteLines];
  });

  return [`## ${title}`, ...(lines.length > 0 ? lines : ["暂无反馈记录。"])].join("\n");
}

function actionFeedbackStatusLabel(status: AiActionFeedbackRecord["status"]): string {
  if (status === "completed") {
    return "已完成";
  }

  if (status === "skipped") {
    return "暂不做";
  }

  if (status === "notApplicable") {
    return "不适合";
  }

  return "待处理";
}

function reflectionFeedbackStatusLabel(status: AiActionFeedbackRecord["status"]): string {
  if (status === "completed") {
    return "已回答";
  }

  if (status === "skipped") {
    return "暂不答";
  }

  if (status === "notApplicable") {
    return "不适合";
  }

  return "待思考";
}

function formatBookInsights(summary: BookAiSummary): string {
  const insights = buildBookInsightViewModels(summary);

  if (insights.length === 0) {
    return "## 阅读洞察\n暂无可整理的阅读洞察。";
  }

  return [
    "## 阅读洞察",
    ...insights.map((insight, index) => {
      const quoteLines = insight.sourceQuotes.flatMap((quote) => {
        const source = [quote.noteType, quote.chapter].filter(Boolean).join(" · ");
        return [
          `   - 来源摘录：${quote.quote}`,
          source ? `     来源：${source}` : undefined
        ].filter(Boolean);
      });
      const questionLines = insight.followUpQuestions.map((question) => `   - 可继续追问：${question}`);

      return [
        `${index + 1}. ${insight.title}`,
        insight.description ? `   - 说明：${insight.description}` : undefined,
        ...quoteLines,
        ...questionLines
      ]
        .filter(Boolean)
        .join("\n");
    })
  ].join("\n");
}

function formatRepresentativeQuotes(quotes: BookAiRepresentativeQuote[]): string {
  if (quotes.length === 0) {
    return "## 代表性摘录\n暂无代表性摘录。";
  }

  return [
    "## 代表性摘录",
    ...quotes.map((quote, index) => {
      const source = [quote.noteType, quote.chapter].filter(Boolean).join(" · ");
      return `${index + 1}. ${quote.quote}\n   - 理由：${quote.reason}${source ? `\n   - 来源：${source}` : ""}`;
    })
  ].join("\n");
}

function sourceLabelFromResponse(source: BookAiSummaryResponse["source"]): string {
  if (source === "cache") {
    return "本地缓存";
  }

  if (source === "generated") {
    return "本次手动生成";
  }

  if (source === "staleCache") {
    return "旧缓存";
  }

  return "无可总结内容";
}

function readReviewModeFromLocation(): BookReviewMode | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const value = new URLSearchParams(window.location.search).get("reviewMode");
  return value === "quick" || value === "full" ? value : undefined;
}

function replaceReviewModeInLocation(mode: BookReviewMode): void {
  if (typeof window === "undefined" || !window.history?.replaceState) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("reviewMode", mode);
  window.history.replaceState(window.history.state, "", url);
}

function RepresentativeQuoteCard({ quote }: { quote: BookAiRepresentativeQuote }) {
  return (
    <article className="ai-quote-card">
      <blockquote>{quote.quote}</blockquote>
      <p>{quote.reason}</p>
      <small>
        {quote.noteType}
        {quote.chapter ? ` · ${quote.chapter}` : ""}
      </small>
    </article>
  );
}

function FeedbackOutcomeSummarySection({
  summary,
  onAskInsight
}: {
  summary?: FeedbackOutcomeSummary;
  onAskInsight?: (draft: string) => void;
}) {
  if (!summary?.summary) {
    return null;
  }

  return (
    <section className="ai-summary-section" aria-label="反馈沉淀">
      <h4>
        <CheckCircle2 aria-hidden="true" size={18} />
        反馈沉淀
      </h4>
      <p>{summary.summary}</p>
      {summary.appliedChanges?.length ? (
        <ul>
          {summary.appliedChanges.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {onAskInsight ? (
        <button
          className="text-button book-insight-ask-button"
          type="button"
          onClick={() => onAskInsight(buildFeedbackOutcomeAssistantDraft(summary))}
        >
          <MessageSquare aria-hidden="true" size={14} />
          追问
        </button>
      ) : null}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}

function statusFromSource(source: BookAiSummaryResponse["source"]): AiPageStatus {
  if (source === "cache") {
    return "cached";
  }

  if (source === "empty") {
    return "empty-note";
  }

  if (source === "staleCache") {
    return "error";
  }

  return "generated";
}

function loadBookNotesOnce(bookId: string): Promise<BookNotes> {
  const existing = inFlightBookNotesRequests.get(bookId);
  if (existing) {
    return existing;
  }

  const request = getBookNotes(bookId);
  inFlightBookNotesRequests.set(bookId, request);
  void request.finally(() => {
    if (inFlightBookNotesRequests.get(bookId) === request) {
      inFlightBookNotesRequests.delete(bookId);
    }
  }).catch(() => undefined);
  return request;
}

function sourceStatsFromNotes(notes?: BookNotes): BookAiSummarySourceStats {
  return {
    highlightCount: notes?.highlights.length ?? 0,
    thoughtCount: notes?.thoughts.length ?? 0,
    bookmarkCount: notes?.bookmarkCount ?? 0,
    chapterCount: notes?.chapterGroups.length ?? 0,
    includedHighlightCount: notes?.highlights.length ?? 0,
    includedThoughtCount: notes?.thoughts.length ?? 0
  };
}

function createReadyNotesInfo(notes: BookNotes): NotesInfo {
  return {
    status: "ready",
    notes,
    exportableCount: notes.exportableCount,
    totalCount: notes.highlights.length + notes.thoughts.length + notes.bookmarkCount
  };
}

function notesInfoFromNotes(notes: BookNotes | undefined, targetBookId: string | undefined): NotesInfo {
  if (notes && notes.bookId === targetBookId) {
    return createReadyNotesInfo(notes);
  }

  return { status: "unknown" };
}

function statusMetaFromState(
  status: AiPageStatus,
  hasStaleCacheError: boolean,
  notesStatus: NotesInfo["status"],
  reviewMode: BookReviewMode,
  isFullSnapshotSummary: boolean
) {
  if (notesStatus === "loading") {
    return { label: "读取笔记中", tone: "neutral" };
  }

  if (notesStatus === "unknown" && status !== "error") {
    return { label: "笔记未就绪", tone: "warning" };
  }

  if (status === "setup-required") {
    return { label: "需要设置", tone: "warning" };
  }

  if (status === "loading-cache") {
    return { label: "读取缓存中", tone: "neutral" };
  }

  if (status === "cached") {
    return {
      label: reviewMode === "full"
        ? isFullSnapshotSummary ? "完整复盘已完成" : "完整复盘待验证"
        : "快速复盘缓存",
      tone: reviewMode === "full" && isFullSnapshotSummary ? "success" : "neutral"
    };
  }

  if (status === "generating") {
    return { label: reviewMode === "full" ? "完整复盘处理中" : "快速复盘生成中", tone: "neutral" };
  }

  if (status === "generated") {
    return {
      label: reviewMode === "full"
        ? isFullSnapshotSummary ? "完整复盘已完成" : "完整复盘待验证"
        : "快速复盘已生成",
      tone: reviewMode === "full" && !isFullSnapshotSummary ? "warning" : "success"
    };
  }

  if (status === "error") {
    return {
      label: hasStaleCacheError
        ? reviewMode === "full" ? "完整复盘使用旧结果" : "快速复盘使用旧结果"
        : reviewMode === "full" ? "完整复盘失败" : "快速复盘失败",
      tone: "warning"
    };
  }

  if (status === "empty-note") {
    return { label: "无可总结内容", tone: "warning" };
  }

  return { label: reviewMode === "full" ? "完整复盘待创建" : "快速复盘待生成", tone: "neutral" };
}

function statusFromAiState(aiState: AiSettingsState | undefined, notesInfo: NotesInfo): AiPageStatus {
  if (notesInfo.status !== "ready") {
    return "idle";
  }

  if (notesInfo.exportableCount <= 0) {
    return "empty-note";
  }

  if (!aiState) {
    return "idle";
  }

  return aiState.credential.hasCredential ? "idle" : "setup-required";
}
