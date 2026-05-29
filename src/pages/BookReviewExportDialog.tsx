import { useDeferredValue, useEffect, useState } from "react";
import { AlertCircle, BookOpen, Download, Loader2, Search, X } from "lucide-react";
import { ExportFailurePanel } from "../components/ExportFailurePanel";
import { getExportAssetBoundary } from "../lib/export-asset-boundaries";
import { exportBookNotesSummariesMarkdown, getCommandErrorMessage } from "../lib/reading-api";
import { formatAiTimestamp } from "../lib/formatters";
import type { BookAiSummaryListItem, ExportAiBulkMarkdownResponse } from "../lib/types";

type BookReviewExportStep = "select" | "settings" | "result";

type BookReviewExportDialogProps = {
  items: BookAiSummaryListItem[];
  onClose: () => void;
  onExportComplete: (result: ExportAiBulkMarkdownResponse) => void;
};

export function filterBookAiSummaryItems(
  items: BookAiSummaryListItem[],
  query: string
): BookAiSummaryListItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }

  return items.filter((item) =>
    [item.title, item.author, item.overview]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(normalized))
  );
}

export function BookReviewExportDialog({ items, onClose, onExportComplete }: BookReviewExportDialogProps) {
  const exportBoundary = getExportAssetBoundary("bookReview");
  const [step, setStep] = useState<BookReviewExportStep>("select");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(() => new Set());
  const [includeActionFeedback, setIncludeActionFeedback] = useState(true);
  const [includeReflectionFeedback, setIncludeReflectionFeedback] = useState(true);
  const [includeRepresentativeQuotes, setIncludeRepresentativeQuotes] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ExportAiBulkMarkdownResponse>();
  const hasResultError = step === "result" && Boolean(error);
  const filteredItems = filterBookAiSummaryItems(items, deferredQuery);
  const selectedCount = selectedBookIds.size;
  const selectedVisibleCount = filteredItems.filter((item) => selectedBookIds.has(item.bookId)).length;
  const feedbackItemCount = items.filter((item) => item.feedbackCount > 0).length;
  const canMoveToSettings = selectedCount > 0;

  useEffect(() => {
    setSelectedBookIds((current) => {
      const availableBookIds = new Set(items.map((item) => item.bookId));
      const next = new Set(Array.from(current).filter((bookId) => availableBookIds.has(bookId)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  function handleToggleBook(bookId: string) {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }

      return next;
    });
  }

  function handleSelectVisible() {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      for (const item of filteredItems) {
        next.add(item.bookId);
      }

      return next;
    });
  }

  function handleClearSelection() {
    setSelectedBookIds(new Set());
  }

  async function handleExport() {
    if (selectedBookIds.size === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    setError(undefined);
    setResult(undefined);

    try {
      const response = await exportBookNotesSummariesMarkdown(Array.from(selectedBookIds), {
        includeActionFeedback,
        includeReflectionFeedback,
        includeRepresentativeQuotes
      });
      setResult(response);
      onExportComplete(response);
      setStep("result");
    } catch (exportError) {
      setError(getCommandErrorMessage(exportError));
      setStep("result");
    } finally {
      setIsExporting(false);
    }
  }

  function handleBackToSettings() {
    setError(undefined);
    setResult(undefined);
    setStep("settings");
  }

  function handleBackToSelect() {
    setError(undefined);
    setResult(undefined);
    setStep("select");
  }

  return (
    <div className="book-review-export-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="book-review-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出书籍复盘"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="book-review-export-heading">
          <div>
            <p className="section-kicker">书籍复盘导出</p>
            <h3>选择要导出的复盘</h3>
            <p>{exportBoundary.summary}</p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭书籍复盘导出">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <ol className="book-review-export-steps" aria-label="导出步骤">
          <BookReviewExportStepItem index={1} label="选择复盘" isActive={step === "select"} isDone={step !== "select"} />
          <BookReviewExportStepItem
            index={2}
            label="确认设置"
            isActive={step === "settings"}
            isDone={step === "result"}
          />
          <BookReviewExportStepItem index={3} label="导出结果" isActive={step === "result"} isDone={false} />
        </ol>

        <section className="bulk-export-summary" aria-label="书籍复盘导出摘要">
          <SummaryPill label="可导出复盘" value={items.length} />
          <SummaryPill label="已选择" value={selectedCount} />
          <SummaryPill label="带反馈" value={feedbackItemCount} />
          <SummaryPill label="当前筛选" value={filteredItems.length} />
        </section>

        {error && step !== "result" ? (
          <div className="status-message status-message--error">
            <AlertCircle aria-hidden="true" size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="book-review-export-body">
          {step === "select" ? (
            <>
              <div className="book-review-export-toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" size={18} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="按书名、作者或复盘概览筛选"
                  />
                </label>
                <p className="bulk-export-selection-summary">
                  已选 {selectedCount} 本{selectedVisibleCount > 0 ? `，当前筛选 ${selectedVisibleCount} 本` : ""}
                </p>
                <button
                  className="text-button"
                  type="button"
                  onClick={handleSelectVisible}
                  disabled={filteredItems.length === 0 || selectedVisibleCount === filteredItems.length}
                >
                  选择当前筛选
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={handleClearSelection}
                  disabled={selectedCount === 0}
                >
                  清空
                </button>
              </div>

              <section className="book-review-export-list" aria-label="可导出的书籍复盘">
                {filteredItems.map((item) => (
                  <label
                    key={item.bookId}
                    className={`book-review-export-row${selectedBookIds.has(item.bookId) ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedBookIds.has(item.bookId)}
                      onChange={() => handleToggleBook(item.bookId)}
                    />
                    <span className="reading-hub-book-cover">
                      {item.cover ? <img src={item.cover} alt="" /> : <BookOpen aria-hidden="true" size={24} />}
                    </span>
                    <span className="book-review-export-row-copy">
                      <strong>{item.title}</strong>
                      <small>
                        {item.author || "未知作者"} · 更新 {formatAiTimestamp(item.cachedUpdatedAt)}
                      </small>
                      <span>{item.overview}</span>
                    </span>
                    <span className="book-review-export-row-meta">
                      {item.providerModel ? <small>{item.providerModel}</small> : null}
                      {item.feedbackCount > 0 ? <b>{item.feedbackCount} 条反馈</b> : <em>无反馈</em>}
                    </span>
                  </label>
                ))}
                {filteredItems.length === 0 ? <p className="bulk-export-empty">没有匹配的书籍复盘。</p> : null}
              </section>
            </>
          ) : null}

          {step === "settings" ? (
            <section className="book-review-export-settings" aria-label="导出设置确认">
              <article>
                <strong>导出范围</strong>
                <p>将导出你手动选择的 {selectedCount} 本书籍复盘。未生成复盘的书不会出现在这里。</p>
              </article>
              <label className="book-review-export-option">
                <input
                  type="checkbox"
                  checked={includeActionFeedback}
                  onChange={(event) => setIncludeActionFeedback(event.target.checked)}
                />
                <span>
                  <strong>包含行动反馈</strong>
                  <small>导出行动项下已保存的状态和文字记录。</small>
                </span>
              </label>
              <label className="book-review-export-option">
                <input
                  type="checkbox"
                  checked={includeReflectionFeedback}
                  onChange={(event) => setIncludeReflectionFeedback(event.target.checked)}
                />
                <span>
                  <strong>包含复盘问题反馈</strong>
                  <small>导出复盘问题下已保存的回答状态和记录。</small>
                </span>
              </label>
              <label className="book-review-export-option">
                <input
                  type="checkbox"
                  checked={includeRepresentativeQuotes}
                  onChange={(event) => setIncludeRepresentativeQuotes(event.target.checked)}
                />
                <span>
                  <strong>包含代表性摘录</strong>
                  <small>导出 AI 复盘中用于核对依据的代表性划线或想法摘录。</small>
                </span>
              </label>
              <article>
                <strong>本地缓存边界</strong>
                <p>{exportBoundary.behavior}</p>
                <ul className="asset-boundary-list">
                  <li>来源：{exportBoundary.source}</li>
                  <li>包含：{exportBoundary.includes.join("；")}</li>
                  <li>不包含：{exportBoundary.excludes.join("；")}</li>
                </ul>
              </article>
            </section>
          ) : null}

          {step === "result" && result ? (
            <section className="bulk-export-result" aria-label="书籍复盘导出结果">
              <div>
                <h3>导出完成</h3>
                <p>{result.path}</p>
              </div>
              <span>{result.itemCount} 本</span>
              <div className="bulk-export-result-list">
                {result.files.map((file) => (
                  <article className="bulk-export-result-item" key={file}>
                    <p>
                      <strong>{file}</strong>
                      <span>已写入导出目录</span>
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {hasResultError && error ? (
            <ExportFailurePanel
              ariaLabel="书籍复盘导出结果"
              error={error}
              contextTitle="当前不会丢失已选书籍和导出设置"
              contextDescription="可以直接重试，也可以返回设置或选择范围后再继续，不会静默请求微信读书远端。"
            />
          ) : null}
        </div>

        <div className="bulk-export-actions">
          {step === "select" ? (
            <>
              <button className="text-button" type="button" onClick={onClose}>
                取消
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setStep("settings")}
                disabled={!canMoveToSettings}
              >
                下一步
              </button>
            </>
          ) : null}
          {step === "settings" ? (
            <>
              <button className="text-button" type="button" onClick={() => setStep("select")} disabled={isExporting}>
                返回选择
              </button>
              <button className="secondary-action" type="button" onClick={() => void handleExport()} disabled={isExporting}>
                {isExporting ? (
                  <Loader2 aria-hidden="true" size={16} className="spin" />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
                {isExporting ? "导出中" : "开始导出"}
              </button>
            </>
          ) : null}
          {step === "result" ? (
            <>
              {hasResultError ? (
                <>
                  <button className="text-button" type="button" onClick={handleBackToSelect}>
                    返回选择
                  </button>
                  <button className="text-button" type="button" onClick={handleBackToSettings}>
                    返回设置
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      void handleExport();
                    }}
                    disabled={isExporting}
                  >
                    {isExporting ? (
                      <Loader2 aria-hidden="true" size={16} className="spin" />
                    ) : (
                      <Download aria-hidden="true" size={16} />
                    )}
                    {isExporting ? "导出中" : "重试导出"}
                  </button>
                </>
              ) : (
                <button className="secondary-action" type="button" onClick={onClose}>
                  完成
                </button>
              )}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BookReviewExportStepItem({
  index,
  label,
  isActive,
  isDone
}: {
  index: number;
  label: string;
  isActive: boolean;
  isDone: boolean;
}) {
  return (
    <li className={`${isActive ? "is-active" : ""}${isDone ? " is-done" : ""}`}>
      <span>{index}</span>
      <strong>{label}</strong>
    </li>
  );
}

function SummaryPill({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
