import { useState } from "react";
import { BookOpen, Loader2, Search, Sparkles, X } from "lucide-react";
import type { BookDecisionGoal, SearchResult } from "../lib/types";
import {
  recentReadingWindowOptions,
  type RecentReadingWindowMode
} from "./book-decision-context";
import {
  decisionGoals,
  maxDecisionCandidates,
  referenceFactors,
  type ReferenceFactor
} from "./book-decision-input-model";

type BookDecisionInputDialogProps = {
  candidateBooks: SearchResult[];
  selectedIds: Set<string>;
  selectedFactorIds: Set<ReferenceFactor>;
  candidateLimitMessage?: string;
  decisionGoal: BookDecisionGoal;
  recentReadingContextLabel: string;
  recentReadingWindowMode: RecentReadingWindowMode;
  hasStatsSignal: boolean;
  isSubmitting: boolean;
  submitLabel?: string;
  onCandidateChange: (bookId: string, checked: boolean) => void;
  onSelectTopCandidates: () => void;
  onClearCandidates: () => void;
  onFactorChange: (factorId: ReferenceFactor, checked: boolean) => void;
  onRecentReadingWindowChange: (mode: RecentReadingWindowMode) => void;
  onDecisionGoalChange: (goal: BookDecisionGoal) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function BookDecisionInputDialog({
  candidateBooks,
  selectedIds,
  selectedFactorIds,
  candidateLimitMessage,
  decisionGoal,
  recentReadingContextLabel,
  recentReadingWindowMode,
  hasStatsSignal,
  isSubmitting,
  submitLabel = "生成决策",
  onCandidateChange,
  onSelectTopCandidates,
  onClearCandidates,
  onFactorChange,
  onRecentReadingWindowChange,
  onDecisionGoalChange,
  onSubmit,
  onClose
}: BookDecisionInputDialogProps) {
  const [step, setStep] = useState(1);
  const [candidateQuery, setCandidateQuery] = useState("");
  const canGoBack = step > 1;
  const canGoNext = step < 3;
  const normalizedCandidateQuery = candidateQuery.trim().toLocaleLowerCase("zh-Hans-CN");
  const visibleCandidateBooks = normalizedCandidateQuery
    ? candidateBooks.filter((book) =>
        [book.title, book.author, book.category].some((value) =>
          (value ?? "").toLocaleLowerCase("zh-Hans-CN").includes(normalizedCandidateQuery)
        )
      )
    : candidateBooks;
  const selectedCandidateCount = selectedIds.size;
  const selectedFactorCount = selectedFactorIds.size;
  const statsStatusText = hasStatsSignal ? "已缓存统计可用" : "尚未缓存统计";

  function getFactorStatus(factor: (typeof referenceFactors)[number]) {
    if (factor.status === "recent") {
      return recentReadingContextLabel;
    }

    return statsStatusText;
  }

  function handleRecentWindowChange(value: string) {
    const nextMode =
      value === "auto"
        ? "auto"
        : recentReadingWindowOptions.find((option) => String(option.value) === value)?.value;

    if (nextMode) {
      onRecentReadingWindowChange(nextMode);
    }
  }

  return (
    <div className="reading-route-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="reading-route-dialog book-decision-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-decision-input-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="reading-route-dialog-heading">
          <div>
            <p className="section-kicker">输入确认</p>
            <h3 id="book-decision-input-dialog-title">调整选书决策输入范围</h3>
            <p>步骤 {step} / 3 · 候选书是必选输入；参考因子只在你明确勾选后用于解释边界。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="book-decision-dialog-grid">
          {step === 1 ? (
            <section className="book-decision-panel book-decision-step-panel">
              <div className="book-decision-heading">
                <div>
                  <p className="section-kicker">本次选书目标</p>
                  <h4>先确定这次想解决什么问题</h4>
                </div>
                <Sparkles aria-hidden="true" size={18} />
              </div>
              <section className="book-decision-goal-list" aria-label="本次选书目标">
                {decisionGoals.map((goal) => (
                  <label key={goal.id} className="book-decision-factor">
                    <input
                      type="radio"
                      name="book-decision-goal"
                      checked={decisionGoal === goal.id}
                      onChange={() => onDecisionGoalChange(goal.id)}
                    />
                    <span>
                      <strong>{goal.id}</strong>
                      <small>{goal.description}</small>
                    </span>
                  </label>
                ))}
              </section>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="book-decision-panel book-decision-step-panel" aria-label="候选书选择">
              <div className="book-decision-heading">
                <div>
                  <p className="section-kicker">候选书选择</p>
                  <h4>最多纳入 8 本本地候选</h4>
                  <p>
                    已选 {selectedCandidateCount} / {maxDecisionCandidates} · 共 {candidateBooks.length} 本
                  </p>
                </div>
                <BookOpen aria-hidden="true" size={18} />
              </div>

              {candidateBooks.length > 0 ? (
                <>
                  <div className="book-decision-candidate-toolbar">
                    <button className="text-button" type="button" onClick={onSelectTopCandidates}>
                      选择前 {Math.min(candidateBooks.length, maxDecisionCandidates)} 本
                    </button>
                    <button className="text-button" type="button" onClick={onClearCandidates}>
                      清空选择
                    </button>
                  </div>
                  <label className="search-field book-decision-candidate-search">
                    <Search aria-hidden="true" size={18} />
                    <input
                      type="search"
                      placeholder="搜索候选书名或作者"
                      value={candidateQuery}
                      onChange={(event) => setCandidateQuery(event.target.value)}
                    />
                  </label>
                  {candidateLimitMessage ? (
                    <p className="book-decision-limit-message">{candidateLimitMessage}</p>
                  ) : null}
                  {visibleCandidateBooks.length > 0 ? (
                    <div className="book-decision-candidate-list">
                      {visibleCandidateBooks.map((book) => (
                        <article
                          key={book.bookId}
                          className={`book-decision-candidate ${selectedIds.has(book.bookId) ? "is-selected" : ""}`}
                        >
                          <label>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(book.bookId)}
                              onChange={(event) => onCandidateChange(book.bookId, event.target.checked)}
                              aria-label={book.title}
                            />
                            <span>
                              <strong>{book.title}</strong>
                              <small>{book.author || book.category || "本地候选"}</small>
                            </span>
                          </label>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <section className="candidate-decision-empty">
                      <strong>没有匹配的候选书</strong>
                      <p>换个书名或作者关键词再试。</p>
                    </section>
                  )}
                </>
              ) : (
                <section className="candidate-decision-empty">
                  <strong>还没有可决策的候选书</strong>
                  <p>先去发现页保存候选，再回到这里生成下一本书建议。</p>
                </section>
              )}
            </section>
          ) : null}

          {step === 3 ? (
            <section className="book-decision-panel book-decision-step-panel" aria-label="参考因子选择">
              <div className="book-decision-heading">
                <div>
                  <p className="section-kicker">参考因子选择</p>
                  <h4>让 AI 知道这些信息如何影响判断</h4>
                </div>
              </div>
              <p>
                可选项只用于解释决策边界，不会发送原始笔记正文，也不会把已读书重新加入推荐。
              </p>
              <div className="book-decision-factor-list">
                {referenceFactors.map((factor) => (
                  <label key={factor.id} className="book-decision-factor">
                    <input
                      type="checkbox"
                      checked={selectedFactorIds.has(factor.id)}
                      onChange={(event) =>
                        onFactorChange(factor.id, event.target.checked)
                      }
                    />
                    <span>
                      <strong>{factor.label}</strong>
                      <small>{factor.description}</small>
                      <em>{getFactorStatus(factor)}</em>
                      {factor.id === "recent" ? (
                        <label className="book-decision-factor-control">
                          <span>时间范围</span>
                          <select
                            aria-label="近期阅读时间范围"
                            value={String(recentReadingWindowMode)}
                            onChange={(event) => handleRecentWindowChange(event.target.value)}
                          >
                            {recentReadingWindowOptions.map((option) => (
                              <option key={String(option.value)} value={String(option.value)}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <p className="book-decision-final-summary">
                本次将使用：{selectedCandidateCount} 本候选书，{selectedFactorCount} 项参考因子
              </p>
            </section>
          ) : null}
        </div>

        <div className="reading-route-dialog-footer">
          {canGoBack ? (
            <button className="sync-button" type="button" onClick={() => setStep((current) => current - 1)}>
              上一步
            </button>
          ) : null}
          {canGoNext ? (
            <button className="secondary-action" type="button" onClick={() => setStep((current) => current + 1)}>
              下一步
            </button>
          ) : (
            <button
              className="secondary-action"
              type="button"
              disabled={isSubmitting || selectedCandidateCount === 0}
              onClick={onSubmit}
            >
              {isSubmitting ? <Loader2 aria-hidden="true" size={18} className="spin" /> : null}
              {isSubmitting ? "生成中" : submitLabel}
            </button>
          )}
          <button className="sync-button" type="button" disabled={isSubmitting} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
