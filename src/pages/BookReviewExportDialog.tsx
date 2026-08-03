import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { ExportFailurePanel } from "../components/ExportFailurePanel";
import { ExportTargetSelection } from "../components/export/ExportTargetSelection";
import {
  canSubmitExportTargets,
  exportTargetName,
  resolveExportTargetConfigurations,
  toggleExportTarget,
  type ExportPlatformMode
} from "../lib/asset-export-dialog";
import {
  buildBookReviewBulkExportRequest,
  buildBookReviewBulkRetryRequest,
  mergeBookReviewBulkExportResponses,
  summarizeBookReviewBulkExport
} from "../lib/book-review-bulk-export";
import { getExportAssetBoundary } from "../lib/export-asset-boundaries";
import {
  exportBookNotesSummariesTargets,
  getCommandErrorMessage,
  getSettingsState
} from "../lib/reading-api";
import { formatAiTimestamp } from "../lib/formatters";
import type {
  BookAiSummaryListItem,
  BookNotesSummariesExportOptions,
  BookNotesSummariesTargetExportRequest,
  BookNotesSummariesTargetExportResponse,
  ExportTargetResult,
  ExternalExportTarget,
  SettingsState
} from "../lib/types";

const DEFAULT_TARGETS: ExternalExportTarget[] = ["markdown"];
type BookReviewExportStep = "select" | "settings" | "result";

type BookReviewExportDialogProps = {
  items: BookAiSummaryListItem[];
  platformMode: ExportPlatformMode;
  onClose: () => void;
  onOpenSettings: () => void;
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

export function BookReviewExportDialog({
  items,
  platformMode,
  onClose,
  onOpenSettings
}: BookReviewExportDialogProps) {
  const exportBoundary = getExportAssetBoundary("bookReview");
  const [step, setStep] = useState<BookReviewExportStep>("select");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(() => new Set());
  const [selectedTargets, setSelectedTargets] = useState<ExternalExportTarget[]>(DEFAULT_TARGETS);
  const [includeActionFeedback, setIncludeActionFeedback] = useState(true);
  const [includeReflectionFeedback, setIncludeReflectionFeedback] = useState(true);
  const [includeRepresentativeQuotes, setIncludeRepresentativeQuotes] = useState(true);
  const [settingsState, setSettingsState] = useState<SettingsState>();
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();
  const [isExporting, setIsExporting] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [result, setResult] = useState<BookNotesSummariesTargetExportResponse>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastRequestRef = useRef<BookNotesSummariesTargetExportRequest>();

  const filteredItems = filterBookAiSummaryItems(items, deferredQuery);
  const selectedCount = selectedBookIds.size;
  const selectedVisibleCount = filteredItems.filter((item) => selectedBookIds.has(item.bookId)).length;
  const feedbackItemCount = items.filter((item) => item.feedbackCount > 0).length;
  const configurations = resolveExportTargetConfigurations({
    exportData: settingsState?.exportData,
    integrationData: settingsState?.integrationData,
    platformMode
  });
  const canExport =
    selectedCount > 0 &&
    !isLoadingSettings &&
    !settingsError &&
    !isExporting &&
    canSubmitExportTargets(selectedTargets, configurations);
  const summary = result ? summarizeBookReviewBulkExport(result) : undefined;
  const retryRequest = result ? buildBookReviewBulkRetryRequest(result, currentOptions()) : undefined;
  const runningRequest = lastRequestRef.current;
  const runningBookCount = runningRequest
    ? new Set(runningRequest.items.map((item) => item.bookId)).size
    : selectedCount;
  const runningTargetCount = runningRequest
    ? new Set(runningRequest.items.flatMap((item) => item.targets)).size
    : selectedTargets.length;
  const runningTaskCount = runningRequest
    ? runningRequest.items.reduce((count, item) => count + item.targets.length, 0)
    : selectedCount * selectedTargets.length;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (platformMode === "native") {
      void loadSettings();
    }
  }, [platformMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isExporting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExporting, onClose]);

  useEffect(() => {
    setSelectedBookIds((current) => {
      const availableBookIds = new Set(items.map((item) => item.bookId));
      const next = new Set(Array.from(current).filter((bookId) => availableBookIds.has(bookId)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  function currentOptions(): BookNotesSummariesExportOptions {
    return {
      includeActionFeedback,
      includeReflectionFeedback,
      includeRepresentativeQuotes
    };
  }

  async function loadSettings() {
    setIsLoadingSettings(true);
    setSettingsError(undefined);
    try {
      setSettingsState(await getSettingsState());
    } catch (error) {
      setSettingsState(undefined);
      setSettingsError(getCommandErrorMessage(error));
    } finally {
      setIsLoadingSettings(false);
    }
  }

  function handleClose() {
    if (!isExporting) {
      onClose();
    }
  }

  function handleOpenSettings() {
    if (isExporting) {
      return;
    }
    onClose();
    onOpenSettings();
  }

  function handleToggleBook(bookId: string) {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      next.has(bookId) ? next.delete(bookId) : next.add(bookId);
      return next;
    });
  }

  function handleSelectVisible() {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      filteredItems.forEach((item) => next.add(item.bookId));
      return next;
    });
  }

  async function runExport(request: BookNotesSummariesTargetExportRequest, mergeResult: boolean) {
    if (isExporting) {
      return;
    }
    lastRequestRef.current = request;
    setIsExporting(true);
    setCommandError(undefined);
    try {
      const response = await exportBookNotesSummariesTargets(request);
      setResult((current) => (mergeResult && current ? mergeBookReviewBulkExportResponses(current, response) : response));
      setStep("result");
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
      setStep("result");
    } finally {
      setIsExporting(false);
    }
  }

  function handleExport() {
    if (!canExport) {
      return;
    }
    void runExport(
      buildBookReviewBulkExportRequest({
        bookIds: Array.from(selectedBookIds),
        targets: selectedTargets,
        options: currentOptions()
      }),
      false
    );
  }

  function handleRetryRequest() {
    const request = lastRequestRef.current;
    if (request) {
      void runExport(request, false);
    }
  }

  function handleRetryFailed() {
    if (retryRequest) {
      void runExport(retryRequest, true);
    }
  }

  return (
    <div className="book-review-export-backdrop" role="presentation" onMouseDown={handleClose}>
      <section
        className="book-review-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出书籍复盘"
        aria-busy={isExporting}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="book-review-export-heading">
          <div>
            <p className="section-kicker">书籍复盘导出</p>
            <h3 ref={headingRef} tabIndex={-1}>批量导出书籍复盘</h3>
            <p>{exportBoundary.summary}</p>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={handleClose}
            disabled={isExporting}
            aria-label="关闭书籍复盘导出"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <ol className="book-review-export-steps" aria-label="导出步骤">
          <BookReviewExportStepItem index={1} label="选择复盘" isActive={step === "select"} isDone={step !== "select"} />
          <BookReviewExportStepItem index={2} label="目标与内容" isActive={step === "settings"} isDone={step === "result"} />
          <BookReviewExportStepItem index={3} label="导出结果" isActive={step === "result"} isDone={false} />
        </ol>

        <section className="bulk-export-summary" aria-label="书籍复盘导出摘要">
          <SummaryPill label="可导出复盘" value={items.length} />
          <SummaryPill label="已选择" value={selectedCount} />
          <SummaryPill label="带反馈" value={feedbackItemCount} />
          <SummaryPill label="当前筛选" value={filteredItems.length} />
        </section>

        <div className={`book-review-export-body is-${step}`}>
          {step === "select" ? (
            <>
              <div className="book-review-export-toolbar">
                <label className="search-field">
                  <Search aria-hidden="true" size={18} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按书名、作者或复盘概览筛选" />
                </label>
                <p className="bulk-export-selection-summary">
                  已选 {selectedCount} 本{selectedVisibleCount > 0 ? `，当前筛选 ${selectedVisibleCount} 本` : ""}
                </p>
                <button className="text-button" type="button" onClick={handleSelectVisible} disabled={!filteredItems.length || selectedVisibleCount === filteredItems.length}>
                  选择当前筛选
                </button>
                <button className="text-button" type="button" onClick={() => setSelectedBookIds(new Set())} disabled={!selectedCount}>
                  清空
                </button>
              </div>
              <section className="book-review-export-list" aria-label="可导出的书籍复盘">
                {filteredItems.map((item) => (
                  <label key={item.bookId} className={`book-review-export-row${selectedBookIds.has(item.bookId) ? " is-selected" : ""}`}>
                    <input type="checkbox" checked={selectedBookIds.has(item.bookId)} onChange={() => handleToggleBook(item.bookId)} />
                    <span className="reading-hub-book-cover">
                      {item.cover ? <img src={item.cover} alt="" /> : <BookOpen aria-hidden="true" size={24} />}
                    </span>
                    <span className="book-review-export-row-copy">
                      <strong>{item.title}</strong>
                      <small>{item.author || "未知作者"} · 更新 {formatAiTimestamp(item.cachedUpdatedAt)}</small>
                      <span>{item.overview}</span>
                    </span>
                    <span className="book-review-export-row-meta">
                      {item.providerModel ? <small>{item.providerModel}</small> : null}
                      {item.feedbackCount > 0 ? <b>{item.feedbackCount} 条反馈</b> : <em>无反馈</em>}
                    </span>
                  </label>
                ))}
                {!filteredItems.length ? <p className="bulk-export-empty">没有匹配的书籍复盘。</p> : null}
              </section>
            </>
          ) : null}

          {step === "settings" && !isExporting ? (
            <section className="book-review-export-settings" aria-label="导出目标与内容设置">
              <ExportTargetSelection
                configurations={configurations}
                isLoadingSettings={isLoadingSettings}
                platformMode={platformMode}
                selectedTargets={selectedTargets}
                settingsError={settingsError}
                onOpenSettings={handleOpenSettings}
                onReloadSettings={() => void loadSettings()}
                onTargetChange={(target) => setSelectedTargets((current) => toggleExportTarget(current, target))}
              />
              <section className="book-review-export-range" aria-labelledby="book-review-export-range-title">
                <h4 id="book-review-export-range-title">导出范围</h4>
                <p>将导出你手动选择的 {selectedCount} 本复盘。每个目标独立执行并保留结果。</p>
              </section>
              <ExportContentOption checked={includeActionFeedback} onChange={setIncludeActionFeedback} title="包含行动反馈" detail="导出行动项下已保存的状态和文字记录。" />
              <ExportContentOption checked={includeReflectionFeedback} onChange={setIncludeReflectionFeedback} title="包含复盘问题反馈" detail="导出复盘问题下已保存的回答状态和记录。" />
              <ExportContentOption checked={includeRepresentativeQuotes} onChange={setIncludeRepresentativeQuotes} title="包含代表性摘录" detail="导出用于核对依据的代表性划线或想法摘录。" />
              <article className="book-review-export-boundary">
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

          {step === "settings" && isExporting ? (
            <section
              className="book-review-export-running"
              aria-live="polite"
              aria-label="书籍复盘批量导出执行中"
            >
              <div className="book-review-export-running-status">
                <span className="book-review-export-running-icon">
                  <Loader2 aria-hidden="true" size={30} className="spin" />
                </span>
                <div>
                  <p className="section-kicker">批量任务执行中</p>
                  <h4>正在导出书籍复盘</h4>
                  <p>按书籍和目标独立执行，完成后会自动展示每一项结果。</p>
                </div>
              </div>
              <dl className="book-review-export-running-metrics" aria-label="本次导出任务摘要">
                <div><dt>书籍</dt><dd>{runningBookCount} 本</dd></div>
                <div><dt>目标</dt><dd>{runningTargetCount} 个</dd></div>
                <div><dt>任务组合</dt><dd>{runningTaskCount} 项</dd></div>
              </dl>
              <p className="book-review-export-running-note">为避免产生不完整结果，执行完成前不能关闭窗口或返回修改设置。</p>
            </section>
          ) : null}

          {step === "result" && commandError ? (
            <ExportFailurePanel
              ariaLabel="书籍复盘导出请求失败"
              error={commandError}
              contextTitle="选择和导出设置已保留"
              contextDescription="可以重试整次请求，或返回设置调整目标；不会静默请求微信读书远端。"
            />
          ) : null}

          {step === "result" && result && summary ? (
            <BookReviewExportResults response={result} />
          ) : null}
        </div>

        <div className="bulk-export-actions">
          {step === "select" ? (
            <>
              <button className="text-button" type="button" onClick={handleClose}>取消</button>
              <button className="secondary-action" type="button" onClick={() => setStep("settings")} disabled={!selectedCount}>
                下一步
              </button>
            </>
          ) : null}
          {step === "settings" && !isExporting ? (
            <>
              <button className="text-button" type="button" onClick={() => setStep("select")}>返回选择</button>
              <button className="secondary-action" type="button" onClick={handleExport} disabled={!canExport}>
                <Download aria-hidden="true" size={16} />
                开始导出
              </button>
            </>
          ) : null}
          {step === "result" ? (
            <>
              <button className="text-button" type="button" onClick={() => setStep("settings")} disabled={isExporting}>返回设置</button>
              {commandError ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={handleRetryRequest}
                  disabled={isExporting || !lastRequestRef.current}
                >
                  <RefreshCw aria-hidden="true" size={16} />重试请求
                </button>
              ) : retryRequest ? (
                <button className="secondary-action" type="button" onClick={handleRetryFailed} disabled={isExporting}>
                  {isExporting ? <Loader2 aria-hidden="true" size={16} className="spin" /> : <RefreshCw aria-hidden="true" size={16} />}
                  {isExporting ? "重试中" : "重试失败项"}
                </button>
              ) : (
                <button className="secondary-action" type="button" onClick={handleClose}>完成</button>
              )}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BookReviewExportResults({ response }: { response: BookNotesSummariesTargetExportResponse }) {
  const summary = summarizeBookReviewBulkExport(response);
  const title = summary.outcome === "succeeded" ? "全部导出成功" : summary.outcome === "partial" ? "部分导出成功" : "导出未完成";
  return (
    <section className={`bulk-export-result bulk-export-result--${summary.outcome}`} aria-label="书籍复盘导出结果">
      <div>
        <h3>{title}</h3>
        <p>成功 {summary.succeeded} · 失败 {summary.failed} · 跳过 {summary.skipped}</p>
        {response.markdownBatch ? <p>Markdown 批次：{response.markdownBatch.path}</p> : null}
        {response.markdownBatch?.warning ? <p>{response.markdownBatch.warning}</p> : null}
      </div>
      <span>{summary.total} 项</span>
      <div className="book-review-target-result-list">
        {response.items.map((item) => (
          <article className="book-review-target-result-book" key={item.bookId}>
            <header><strong>{item.title}</strong><small>{item.author || "未知作者"}</small></header>
            <div>
              {item.results.map((result) => <TargetResult key={result.target} result={result} />)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TargetResult({ result }: { result: ExportTargetResult }) {
  const detail = result.error?.message || result.warning || result.path || result.url || (result.status === "succeeded" ? "导出成功" : "已跳过");
  return (
    <div className={`book-review-target-result is-${result.status}`}>
      <span>{result.status === "succeeded" ? <CheckCircle2 aria-hidden="true" size={16} /> : <AlertCircle aria-hidden="true" size={16} />}</span>
      <p><strong>{exportTargetName(result.target)}</strong><small>{detail}</small></p>
      {result.url ? <a href={result.url} target="_blank" rel="noreferrer" aria-label={`打开 ${exportTargetName(result.target)} 导出结果`}><ExternalLink aria-hidden="true" size={15} /></a> : null}
    </div>
  );
}

function ExportContentOption({ checked, onChange, title, detail }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string }) {
  return (
    <label className="book-review-export-option">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span><strong>{title}</strong><small>{detail}</small></span>
    </label>
  );
}

function BookReviewExportStepItem({ index, label, isActive, isDone }: { index: number; label: string; isActive: boolean; isDone: boolean }) {
  return <li className={`${isActive ? "is-active" : ""}${isDone ? " is-done" : ""}`}><span>{index}</span><strong>{label}</strong></li>;
}

function SummaryPill({ label, value }: { label: string; value: number | string }) {
  return <article className="summary-pill"><span>{label}</span><strong>{value}</strong></article>;
}
