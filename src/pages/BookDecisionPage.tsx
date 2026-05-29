import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Loader2,
  RefreshCw
} from "lucide-react";
import {
  exportBookDecisionMarkdown,
  getCommandErrorMessage,
  summarizeBookDecision,
  type BookshelfResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import { formatAiResponseFormat, formatAiTimestamp } from "../lib/formatters";
import {
  buildAiActionItemId,
  getAiActionItemStorage,
  readAiActionItemState,
  writeAiActionItemState
} from "../lib/ai-action-items";
import type {
  BookDecisionGoal,
  BookDecisionResponse,
  ReadingStatsMode,
  SearchResult
} from "../lib/types";
import { buildBookDecisionCandidates } from "./candidate-books";
import {
  getRecentReadingContext,
  type RecentReadingWindowMode
} from "./book-decision-context";
import {
  getBookDecisionDraftStorage,
  writeBookDecisionDraft
} from "./book-decision-draft";
import { BookDecisionInputDialog } from "./BookDecisionInputDialog";
import { type ReadingStatsCache } from "./reading-stats-period";
import {
  maxDecisionCandidates,
  type BookDecisionSession,
  type ReferenceFactor
} from "./book-decision-input-model";

type BookDecisionPageProps = {
  bookshelf?: BookshelfResponse;
  readingStatsCache: ReadingStatsCache;
  session?: BookDecisionSession;
  onSessionChange: (session: BookDecisionSession) => void;
  onBack: () => void;
};

type ExportStatus =
  | { type: "idle" }
  | { type: "running" }
  | { type: "success"; path: string; fileName: string }
  | { type: "error"; message: string };

const bookDecisionActionScope = "book-decision";

const internalActionLabels: Record<string, (title?: string) => string> = {
  openDetails: (title) =>
    title
      ? `打开《${title}》详情，确认目录和试读入口。`
      : "打开推荐书详情，确认目录和试读入口。",
  scheduleReadingBlock: () => "安排一个 30-45 分钟阅读时段，先完成第一段试读。",
  postReadReview: () => "读完后写 3 条复盘：收获、疑问、下一步。"
};

function formatBookDecisionAction(action: string, primaryTitle?: string) {
  const trimmedAction = action.trim();
  const mappedAction = internalActionLabels[trimmedAction]?.(primaryTitle);

  if (mappedAction) {
    return mappedAction;
  }

  if (/^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(trimmedAction)) {
    return primaryTitle
      ? `围绕《${primaryTitle}》完成一次可验证的阅读动作。`
      : "完成一次可验证的阅读动作。";
  }

  return trimmedAction;
}

export function BookDecisionPage({
  bookshelf,
  readingStatsCache,
  session,
  onSessionChange,
  onBack
}: BookDecisionPageProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(session?.selectedIds ?? [])
  );
  const [selectedFactorIds, setSelectedFactorIds] = useState<Set<ReferenceFactor>>(
    () => new Set(session?.selectedFactorIds ?? [])
  );
  const [candidateLimitMessage, setCandidateLimitMessage] = useState<string>();
  const [decisionGoal, setDecisionGoal] = useState<BookDecisionGoal>(
    session?.decisionGoal ?? "轻松读"
  );
  const [recentReadingWindowMode, setRecentReadingWindowMode] =
    useState<RecentReadingWindowMode>(session?.recentReadingWindowMode ?? "auto");
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ type: "idle" });
  const [error, setError] = useState<string>();
  const candidateBooks = session?.candidateBooks ?? [];
  const decisionResponse = session?.response;
  const selectedCandidateBooks = candidateBooks.filter((book) => selectedIds.has(book.bookId));
  const decisionCandidates = buildBookDecisionCandidates(selectedCandidateBooks);
  const hasStatsSignal = Object.values(readingStatsCache).some(Boolean);
  const recentReadingContext = getRecentReadingContext(
    bookshelf?.snapshot.entries ?? [],
    undefined,
    recentReadingWindowMode
  );
  const selectedFactorCount = selectedFactorIds.size;
  const sourceStatus = getDecisionSourceStatus(decisionResponse);
  const statusLabel = isGenerating ? "生成中" : sourceStatus.label;
  const statusTone = isGenerating ? "pending" : sourceStatus.tone;

  useEffect(() => {
    if (!session) {
      return;
    }

    setSelectedIds(new Set(session.selectedIds));
    setSelectedFactorIds(new Set(session.selectedFactorIds));
    setDecisionGoal(session.decisionGoal);
    setRecentReadingWindowMode(session.recentReadingWindowMode);
    setCandidateLimitMessage(undefined);
    setError(undefined);
    setExportStatus({ type: "idle" });
  }, [session]);

  useEffect(() => {
    if (!isInputDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isGenerating) {
        setIsInputDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isGenerating, isInputDialogOpen]);

  useEffect(() => {
    if (!session) {
      return;
    }

    writeBookDecisionDraft(getBookDecisionDraftStorage(), {
      selectedIds: Array.from(selectedIds),
      selectedFactorIds: Array.from(selectedFactorIds),
      decisionGoal,
      recentReadingWindowMode
    });
  }, [decisionGoal, recentReadingWindowMode, selectedFactorIds, selectedIds, session]);

  function handleCandidateChange(bookId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        if (!next.has(bookId) && next.size >= maxDecisionCandidates) {
          setCandidateLimitMessage(`最多纳入 ${maxDecisionCandidates} 本，请先取消一本。`);
          return current;
        }
        next.add(bookId);
      } else {
        next.delete(bookId);
      }
      setCandidateLimitMessage(undefined);
      return next;
    });
  }

  function handleFactorChange(factorId: ReferenceFactor, checked: boolean) {
    setSelectedFactorIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(factorId);
      } else {
        next.delete(factorId);
      }
      return next;
    });
  }

  function handleSelectTopCandidates() {
    setSelectedIds(new Set(candidateBooks.slice(0, maxDecisionCandidates).map((book) => book.bookId)));
    setCandidateLimitMessage(undefined);
  }

  function handleClearCandidates() {
    setSelectedIds(new Set());
    setCandidateLimitMessage(undefined);
  }

  async function handleGenerateDecision() {
    if (decisionCandidates.length === 0) {
      setError("请至少选择 1 本候选书，再生成选书决策。");
      return;
    }

    setIsGenerating(true);
    setError(undefined);

    try {
      const response = await summarizeBookDecision({
        candidates: decisionCandidates,
        goal: decisionGoal,
        regenerate: true
      });
      onSessionChange({
        response,
        candidateBooks,
        selectedIds: Array.from(selectedIds),
        selectedFactorIds: Array.from(selectedFactorIds),
        decisionGoal,
        recentReadingWindowMode
      });
      setIsInputDialogOpen(false);
      setExportStatus({ type: "idle" });
    } catch (generateError) {
      setError(getCommandErrorMessage(generateError));
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleExportMarkdown() {
    if (decisionCandidates.length === 0) {
      setExportStatus({ type: "error", message: "没有可导出的选书决策候选。" });
      return;
    }

    setExportStatus({ type: "running" });

    try {
      const result = await exportBookDecisionMarkdown(decisionCandidates, decisionGoal);
      setExportStatus({ type: "success", path: result.path, fileName: result.fileName });
    } catch (exportError) {
      setExportStatus({ type: "error", message: getCommandErrorMessage(exportError) });
    }
  }

  if (!decisionResponse || !session) {
    return (
      <section className="book-decision-page" aria-label="选书决策助手">
        <section className="book-decision-hero" aria-label="选书决策标题区">
          <div>
            <p className="section-kicker">结果</p>
            <h3>选书决策</h3>
            <p>请先从候选书架点击“推荐下一本”，确认输入后生成选书决策。</p>
          </div>
          <div className="book-decision-hero-actions">
            <span className="ai-summary-badge ai-summary-badge--neutral">待生成</span>
            <button className="secondary-action" type="button" onClick={onBack}>
              <ArrowLeft aria-hidden="true" size={18} />
              返回候选书架
            </button>
          </div>
        </section>

        <section className="book-decision-result-placeholder" aria-label="暂无选书决策">
          <BookOpen aria-hidden="true" size={24} />
          <div>
            <strong>还没有选书决策结果</strong>
            <p>默认引导页已移除，生成入口统一放在候选书架，避免在结果页重复配置输入。</p>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="book-decision-page" aria-label="选书决策助手">
      <section className="book-decision-hero" aria-label="选书决策标题区">
        <div>
          <p className="section-kicker">结果</p>
          <h3>推荐下一本</h3>
          <p>
            基于 {decisionCandidates.length} 本候选和 {selectedFactorCount} 个参考因子生成。结果只用于本地阅读决策，不写回微信读书。
          </p>
        </div>
        <div className="book-decision-hero-actions">
          <span className={`ai-summary-badge ai-summary-badge--${statusTone}`}>
            {statusLabel}
          </span>
          <button
            className="secondary-action"
            type="button"
            disabled={exportStatus.type === "running"}
            onClick={() => void handleExportMarkdown()}
          >
            {exportStatus.type === "running" ? (
              <Loader2 aria-hidden="true" size={18} className="spin" />
            ) : (
              <BookOpen aria-hidden="true" size={18} />
            )}
            {exportStatus.type === "running" ? "导出中" : "导出 Markdown"}
          </button>
          <button
            className="sync-button"
            type="button"
            onClick={() => setIsInputDialogOpen(true)}
            disabled={isGenerating || decisionCandidates.length === 0}
          >
            {isGenerating ? (
              <Loader2 aria-hidden="true" size={18} className="spin" />
            ) : (
              <RefreshCw aria-hidden="true" size={18} />
            )}
            {isGenerating ? "生成中" : "重新生成"}
          </button>
          <button className="secondary-action" type="button" onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={18} />
            返回候选书架
          </button>
        </div>
      </section>

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {sourceStatus.notice ? (
        <div className={`status-message status-message--${sourceStatus.noticeTone}`} aria-label="选书决策缓存说明">
          {sourceStatus.noticeTone === "warning" ? (
            <AlertCircle aria-hidden="true" size={18} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={18} />
          )}
          <span>{sourceStatus.notice}</span>
        </div>
      ) : null}

      {exportStatus.type === "success" ? (
        <div className="status-message status-message--success" aria-label="选书决策导出结果">
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>已导出 {exportStatus.fileName}：{exportStatus.path}</span>
        </div>
      ) : null}

      {exportStatus.type === "error" ? (
        <div className="status-message status-message--error" aria-label="选书决策导出结果">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{exportStatus.message}</span>
        </div>
      ) : null}

      <BookDecisionResult
        response={decisionResponse}
        candidateStates={candidateBooks}
      />

      {isInputDialogOpen ? (
        <BookDecisionInputDialog
          candidateBooks={candidateBooks}
          selectedIds={selectedIds}
          selectedFactorIds={selectedFactorIds}
          candidateLimitMessage={candidateLimitMessage}
          decisionGoal={decisionGoal}
          recentReadingContextLabel={recentReadingContext.label}
          recentReadingWindowMode={recentReadingWindowMode}
          hasStatsSignal={hasStatsSignal}
          isSubmitting={isGenerating}
          onCandidateChange={handleCandidateChange}
          onSelectTopCandidates={handleSelectTopCandidates}
          onClearCandidates={handleClearCandidates}
          onFactorChange={handleFactorChange}
          onRecentReadingWindowChange={setRecentReadingWindowMode}
          onDecisionGoalChange={setDecisionGoal}
          onSubmit={() => void handleGenerateDecision()}
          onClose={() => {
            if (!isGenerating) {
              setIsInputDialogOpen(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function getDecisionSourceStatus(response?: BookDecisionResponse): {
  label: string;
  tone: "neutral" | "success" | "warning";
  notice?: string;
  noticeTone?: "neutral" | "warning";
} {
  if (!response) {
    return { label: "待生成", tone: "neutral" };
  }

  if (response.source === "generated") {
    return { label: "新生成", tone: "success" };
  }

  if (response.source === "staleCache") {
    const isInputChanged = response.errorMessage?.includes("输入较上次生成有变化");

    return {
      label: "使用旧缓存",
      tone: "warning",
      notice: isInputChanged
        ? "当前候选书或目标与缓存输入不同，已展示最近一次缓存。若要基于当前输入更新，请点击重新生成。"
        : `AI 生成失败，已回退展示最近缓存${response.errorMessage ? `：${response.errorMessage}` : "。"}`,
      noticeTone: "warning"
    };
  }

  if (response.source === "cache") {
    return {
      label: "本地缓存",
      tone: "success",
      notice: "已使用相同输入的本地缓存，未重新调用 AI。",
      noticeTone: "neutral"
    };
  }

  return { label: "待生成", tone: "neutral" };
}

function BookDecisionResult({
  response,
  candidateStates
}: {
  response: BookDecisionResponse;
  candidateStates: SearchResult[];
}) {
  const { decision } = response;
  const candidateById = new Map(candidateStates.map((book) => [book.bookId, book]));
  const [primaryCandidate, ...otherCandidates] = decision.topCandidates;
  const formattedActions = decision.nextActions
    .map((action) => formatBookDecisionAction(action, primaryCandidate?.title))
    .filter(Boolean);
  const primaryAction = formattedActions[0] || primaryCandidate?.prerequisiteAction;
  const [completedActionIds, setCompletedActionIds] = useState<Set<string>>(() =>
    readAiActionItemState(getAiActionItemStorage(), bookDecisionActionScope, response.inputHash)
  );

  useEffect(() => {
    setCompletedActionIds(
      readAiActionItemState(getAiActionItemStorage(), bookDecisionActionScope, response.inputHash)
    );
  }, [response.inputHash]);

  function handleToggleAction(actionId: string) {
    setCompletedActionIds((current) => {
      const next = new Set(current);

      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }

      writeAiActionItemState(getAiActionItemStorage(), bookDecisionActionScope, response.inputHash, next);
      return next;
    });
  }

  return (
    <section className="book-decision-result-view" aria-label="选书决策结果">
      <section className="book-decision-primary-card" aria-label="主推荐">
        <div>
          <p className="section-kicker">推荐下一本</p>
          <h4>{primaryCandidate?.title || "暂无推荐"}</h4>
          <p>{decision.decisionOverview}</p>
        </div>
        {primaryCandidate ? (
          <dl>
            <div>
              <dt>为什么现在读</dt>
              <dd>{primaryCandidate.whyNow}</dd>
            </div>
            <div>
              <dt>下一步动作</dt>
              <dd>{primaryAction}</dd>
            </div>
            <div>
              <dt>预计投入</dt>
              <dd>{primaryCandidate.estimatedEffort}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="book-decision-section" aria-label="取舍对比">
        <div className="book-decision-section-heading">
          <div>
            <p className="section-kicker">取舍对比</p>
            <h4>为什么先读它，其他先暂缓</h4>
          </div>
          <span>{decision.topCandidates.length} 本候选</span>
        </div>
        <div className="book-decision-tradeoff-grid">
          {decision.topCandidates.map((candidate) => {
            const localBook = candidateById.get(candidate.bookId);

            return (
              <article className="book-decision-top-card" key={candidate.bookId}>
                <span>{candidate.rank === 1 ? "推荐优先" : `备选 #${candidate.rank}`}</span>
                <h5>{candidate.title}</h5>
                <dl>
                  <div>
                    <dt>取舍理由</dt>
                    <dd>{candidate.tradeoff}</dd>
                  </div>
                  <div>
                    <dt>前置动作</dt>
                    <dd>{candidate.prerequisiteAction}</dd>
                  </div>
                  <div>
                    <dt>复盘触发点</dt>
                    <dd>{candidate.reviewTrigger}</dd>
                  </div>
                  <div>
                    <dt>依据</dt>
                    <dd>{candidate.basis || localBook?.category || "本地候选信号"}</dd>
                  </div>
                </dl>
              </article>
            );
          })}

          {decision.deferredCandidates.map((candidate) => (
            <article className="book-decision-top-card book-decision-top-card--deferred" key={candidate.bookId}>
              <span>暂缓</span>
              <h5>{candidate.title}</h5>
              <p>{candidate.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="book-decision-section" aria-label="行动清单">
        <div className="book-decision-section-heading">
          <div>
            <p className="section-kicker">行动清单</p>
            <h4>下一步动作</h4>
          </div>
          <span>
            已完成 {countCompletedActions(formattedActions, completedActionIds)} / 共 {formattedActions.length} 项
          </span>
        </div>
        <BookDecisionActionChecklist
          actions={formattedActions}
          completedActionIds={completedActionIds}
          onToggle={handleToggleAction}
        />
      </section>

      <div className="ai-summary-meta">
        <span>生成时间：{formatAiTimestamp(decision.generatedAt) || "尚未生成"}</span>
        <span>Prompt：{decision.promptVersion ?? "book-decision-v1"}</span>
        {decision.responseFormat ? <span>{formatAiResponseFormat(decision.responseFormat)}</span> : null}
        {response.providerModel ? <span>模型：{response.providerModel}</span> : null}
        {response.cachedUpdatedAt ? <span>缓存更新：{formatAiTimestamp(response.cachedUpdatedAt)}</span> : null}
      </div>

      <details className="book-decision-section book-decision-evidence" aria-label="依据说明">
        <summary>依据说明</summary>
        <p>{decision.basisNotice}</p>
        {otherCandidates.length > 0 ? (
          <p>
            备选：{otherCandidates.map((candidate) => candidate.title).join("、")}。
          </p>
        ) : null}
      </details>
    </section>
  );
}

function BookDecisionActionChecklist({
  actions,
  completedActionIds,
  onToggle
}: {
  actions: string[];
  completedActionIds: Set<string>;
  onToggle: (actionId: string) => void;
}) {
  if (actions.length === 0) {
    return <p className="book-decision-action-empty">这次决策没有生成下一步动作。</p>;
  }

  return (
    <ol className="book-decision-action-list">
      {actions.map((action, index) => {
        const actionId = buildAiActionItemId(action, index);
        const isCompleted = completedActionIds.has(actionId);

        return (
          <li key={actionId} className={isCompleted ? "is-completed" : ""}>
            <span className="book-decision-action-step">{index + 1}</span>
            <span className="book-decision-action-text">{action}</span>
            <button
              className="text-button book-decision-action-toggle"
              type="button"
              aria-pressed={isCompleted}
              aria-label={`${isCompleted ? "标记未完成" : "标记已完成"}：${action}`}
              onClick={() => onToggle(actionId)}
            >
              {isCompleted ? "已完成" : "待完成"}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function countCompletedActions(actions: string[], completedActionIds: Set<string>) {
  return actions.reduce((count, action, index) => {
    return completedActionIds.has(buildAiActionItemId(action, index)) ? count + 1 : count;
  }, 0);
}
