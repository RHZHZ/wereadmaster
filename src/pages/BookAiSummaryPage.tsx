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
import { AssetExportDialog } from "../components/export/AssetExportDialog";
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
  getReadingItemState,
  getAiReviewFeedback,
  getAiSettingsState,
  getBookNotes,
  getCommandErrorInfo,
  getCommandErrorMessage,
  getLatestBookNotesSummary,
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
import { formatMultiTargetExportToast } from "../lib/export-targets";
import type {
  AiSettingsState,
  BookAiRepresentativeQuote,
  BookAiSummary,
  BookAiSummaryResponse,
  BookAiSummarySourceStats,
  BookNotes,
  FeedbackOutcomeSummary,
  MultiTargetExportResponse,
  ExternalExportTarget,
  NotebookBook,
  AiReviewFeedbackExport,
  PreparedAssetUpdate,
  ReadingItemState
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

const inFlightBookNotesRequests = new Map<string, Promise<BookNotes>>();

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
  const [summaryResponse, setSummaryResponse] = useState<BookAiSummaryResponse>();
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
  const activeSummaryResponse =
    summaryResponse?.bookId === targetBookId
      ? summaryResponse
      : undefined;
  const summary = activeSummaryResponse?.summary;
  const sourceStats = summary?.sourceStats ?? sourceStatsFromNotes(readyNotes);
  const hasSourceStats = Boolean(summary || readyNotes);
  const hasSummary = Boolean(summary && activeSummaryResponse?.source !== "empty");
  const canGenerate =
    Boolean(targetBookId) &&
    hasReadyNotesForTarget &&
    notesInfo.status === "ready" &&
    notesInfo.exportableCount > 0 &&
    aiState?.credential.hasCredential === true &&
    !isLoadingSettings &&
    !isLoadingSummaryCache &&
    status !== "generating";
  const statusMeta = statusMetaFromState(
    status,
    Boolean(activeSummaryResponse?.errorMessage),
    notesInfo.status
  );
  const summaryInputHash = activeSummaryResponse?.inputHash;
  const isOrganized =
    readingState?.organizeStatus === "organized" || readingState?.status === "organized";

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
        setSummaryResponse(undefined);
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
  }, [targetBookId, notesInfo.status, notesInfo.status === "ready" ? notesInfo.exportableCount : undefined]);

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
      setSummaryResponse(undefined);
      setStatus("loading-cache");

      try {
        const cached = await getLatestBookNotesSummary(targetBookId);

        if (!isMounted) {
          return;
        }

        if (cached) {
          setSummaryResponse(cached);
          setStatus(statusFromSource(cached.source));
          setError(cached.errorMessage ? { message: cached.errorMessage } : undefined);
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
      setSummaryResponse(response);
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
    targets: ExternalExportTarget[]
  ): Promise<MultiTargetExportResponse> {
    if (!targetBookId || !hasSummary) {
      throw new Error("当前没有可导出的书籍复盘。");
    }

    const response = await exportBookNotesSummaryTargets(targetBookId, reviewFeedback, {
      targets
    });
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
          <p>读取已保存复盘；点击生成时使用当前书笔记。</p>
          {displayBook?.author ? <small>{displayBook.author}</small> : null}
        </div>
        <div className="ai-summary-hero-side">
          <span className={`ai-summary-badge ai-summary-badge--${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
          <div className="ai-summary-actions">
            <button
              className="sync-button"
              type="button"
              onClick={() => void handleGenerate(false)}
              disabled={!canGenerate || hasSummary}
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
                    : "生成复盘"}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void handleGenerate(true)}
              disabled={!canGenerate || !hasSummary}
            >
              <RefreshCw aria-hidden="true" size={18} />
              重新生成
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void handleCopyFullSummary()}
              disabled={!hasSummary}
            >
              <Copy aria-hidden="true" size={18} />
              复制完整复盘
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsAssetExportOpen(true)}
              disabled={!hasSummary || isLoadingSummaryCache || status === "generating"}
            >
              <Download aria-hidden="true" size={18} />
              导出书籍复盘
            </button>
          </div>
        </div>
      </section>

      <section className="ai-summary-boundary-strip" aria-label="书籍复盘数据边界">
        <Database aria-hidden="true" size={18} />
        <div>
          <strong>{activeSummaryResponse ? sourceLabelFromResponse(activeSummaryResponse.source) : "待生成"}</strong>
          <p>
            {activeSummaryResponse
              ? "当前展示内容来自本机缓存或本次手动生成结果。"
              : "点击“生成复盘”时使用当前书笔记。"}
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

      {summary ? (
        <div className="ai-summary-content">
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
          <p>点击“生成复盘”后，会使用当前书笔记生成书籍复盘。</p>
        </div>
      )}

      {hasSourceStats ? (
        <section className="ai-summary-source-card" aria-label="书籍复盘来源统计">
          <div>
            <strong>来源统计</strong>
            <small>仅统计当前书本地笔记；书签只计数量，不含正文。</small>
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
        <span>生成时间：{formatAiTimestamp(summary?.generatedAt) || "尚未生成"}</span>
        {summary?.responseFormat ? <span>{formatAiResponseFormat(summary.responseFormat)}</span> : null}
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
        platformMode={resolveExportPlatformMode()}
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
    <section className={`review-completion-strip${isOrganized ? " is-organized" : ""}`} aria-label="复盘整理状态">
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
  notesStatus: NotesInfo["status"]
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
    return { label: "本地缓存", tone: "neutral" };
  }

  if (status === "generating") {
    return { label: "生成中", tone: "neutral" };
  }

  if (status === "generated") {
    return { label: "已生成", tone: "success" };
  }

  if (status === "error") {
    return { label: hasStaleCacheError ? "使用旧缓存" : "生成失败", tone: "warning" };
  }

  if (status === "empty-note") {
    return { label: "无可总结内容", tone: "warning" };
  }

  return { label: "待生成", tone: "neutral" };
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
