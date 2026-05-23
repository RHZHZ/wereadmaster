import { startTransition, useDeferredValue, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Bookmark,
  ChevronRight,
  Download,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  X
} from "lucide-react";
import emptyNotes from "../assets/empty-notes.png";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import { ExportFailurePanel } from "../components/ExportFailurePanel";
import { calculateTotalNotes } from "../lib/business-rules";
import { formatProgress } from "../lib/formatters";
import {
  cancelBulkExport,
  exportBulkNotes,
  getCommandErrorMessage,
  getNotebookOverview,
  listenBulkExportProgress,
  listBookNotesSummaries,
  preflightBulkExport,
  type NotebookOverviewResponse
} from "../lib/reading-api";
import type {
  BookAiSummaryListItem,
  BulkExportPreflight,
  BulkExportPreflightItem,
  BulkExportProgress,
  BulkExportResponse,
  BulkExportStrategy,
  CredentialStatus,
  NotebookBook
} from "../lib/types";
import { useToast } from "../components/ToastProvider";

type NotesPageProps = {
  credentialStatus?: CredentialStatus;
  overview?: NotebookOverviewResponse;
  onOverviewChange: (overview: NotebookOverviewResponse | undefined) => void;
  onOpenSettings: () => void;
  onOpenBookNotes: (book: NotebookBook) => void;
};

export function NotesPage({
  credentialStatus,
  overview,
  onOverviewChange,
  onOpenSettings,
  onOpenBookNotes
}: NotesPageProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [summaryItems, setSummaryItems] = useState<BookAiSummaryListItem[]>();
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [isBulkWizardOpen, setIsBulkWizardOpen] = useState(false);
  const [bulkPreflight, setBulkPreflight] = useState<BulkExportPreflight>();
  const [bulkResult, setBulkResult] = useState<BulkExportResponse>();
  const [bulkExportError, setBulkExportError] = useState<string>();
  const [bulkStrategy, setBulkStrategy] = useState<BulkExportStrategy>("localCachedOnly");
  const [bulkConcurrency, setBulkConcurrency] = useState(2);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [bulkSearchQuery, setBulkSearchQuery] = useState("");
  const [excludeWithoutExportableNotes, setExcludeWithoutExportableNotes] = useState(true);
  const [bulkProgress, setBulkProgress] = useState<BulkExportProgress>();
  const [isBulkPreflighting, setIsBulkPreflighting] = useState(false);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const hasCredential = credentialStatus?.hasCredential === true;
  const { showToast } = useToast();
  const books = overview?.books ?? [];
  const filteredBooks = filterBooks(books, deferredQuery);
  const reviewCandidates = summaryItems ? getReviewCandidates(books, summaryItems) : [];
  const totalHighlights = books.reduce((total, book) => total + book.noteCount, 0);
  const totalThoughts = books.reduce((total, book) => total + book.reviewCount, 0);
  const totalBookmarks = books.reduce((total, book) => total + book.bookmarkCount, 0);

  useEffect(() => {
    if (!hasCredential || overview || isLoading) {
      return;
    }

    void loadOverview();
  }, [hasCredential, overview, isLoading]);

  useEffect(() => {
    if (!hasCredential || summaryItems) {
      return;
    }

    let isMounted = true;

    async function loadSummaries() {
      setIsLoadingSummaries(true);
      setError(undefined);

      try {
        const response = await listBookNotesSummaries();
        if (isMounted) {
          setSummaryItems(response);
        }
      } catch (summaryError) {
        if (isMounted) {
          setError(getCommandErrorMessage(summaryError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingSummaries(false);
        }
      }
    }

    void loadSummaries();

    return () => {
      isMounted = false;
    };
  }, [hasCredential, summaryItems]);

  useEffect(() => {
    if (!isBulkWizardOpen) {
      return;
    }

    let isMounted = true;
    let unlisten: (() => void) | undefined;

    void listenBulkExportProgress((progress) => {
      if (isMounted) {
        setBulkProgress(progress);
      }
    })
      .then((cleanup) => {
        if (isMounted) {
          unlisten = cleanup;
        } else {
          cleanup();
        }
      })
      .catch((listenError) => {
        showToast({ message: getCommandErrorMessage(listenError), tone: "error" });
      });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [isBulkWizardOpen, showToast]);

  async function loadOverview() {
    if (!hasCredential) {
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const response = await getNotebookOverview();
      onOverviewChange(response);
    } catch (loadError) {
      setError(getCommandErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  function handleQueryChange(value: string) {
    startTransition(() => {
      setQuery(value);
    });
  }

  function handleClearQuery() {
    startTransition(() => {
      setQuery("");
    });
  }

  async function handleOpenBulkWizard() {
    setIsBulkWizardOpen(true);
    setBulkResult(undefined);
    setBulkExportError(undefined);
    setBulkProgress(undefined);
    setBulkSearchQuery("");
    setExcludeWithoutExportableNotes(true);
    await runBulkPreflight(undefined, true);
  }

  async function runBulkPreflight(
    bookIds: string[] | undefined,
    excludeFilter = excludeWithoutExportableNotes
  ) {
    setIsBulkPreflighting(true);
    setError(undefined);
    setBulkResult(undefined);
    setBulkExportError(undefined);

    try {
      const response = await preflightBulkExport(
        bookIds && bookIds.length > 0 ? bookIds : undefined,
        excludeFilter
      );
      setBulkPreflight(response);
      const exportableIds = getBulkExportableIds(response);
      setSelectedBookIds((current) =>
        bulkStrategy === "selectedBooksOnly"
          ? current.filter((id) => exportableIds.includes(id))
          : current.length > 0
            ? current.filter((id) => exportableIds.includes(id))
            : exportableIds
      );
    } catch (preflightError) {
      setError(getCommandErrorMessage(preflightError));
    } finally {
      setIsBulkPreflighting(false);
    }
  }

  async function handleRunBulkExport() {
    if (!bulkPreflight) {
      return;
    }

    setIsBulkExporting(true);
    setError(undefined);
    setBulkResult(undefined);
    setBulkExportError(undefined);
    setBulkProgress(undefined);

    const shouldUseSelectedBooks = bulkStrategy === "selectedBooksOnly";
    const selectedIds = shouldUseSelectedBooks ? selectedBookIds : undefined;

    try {
      const response = await exportBulkNotes({
        strategy: bulkStrategy,
        selectedBookIds: selectedIds,
        concurrency: bulkStrategy === "syncMissingNotes" ? bulkConcurrency : 2,
        excludeWithoutExportableNotes
      });
      setBulkResult(response);
      showToast({
        message: `批量导出完成：${response.report.items.filter((item) => item.status === "exported").length} 本已导出。`,
        tone: "success"
      });
    } catch (exportError) {
      const message = getCommandErrorMessage(exportError);
      setBulkExportError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsBulkExporting(false);
    }
  }

  async function handleRetryBulkExportItem(bookId: string) {
    if (!bulkResult || isBulkExporting || isBulkPreflighting) {
      return;
    }

    setIsBulkExporting(true);
    setError(undefined);
    setBulkExportError(undefined);
    setBulkProgress(undefined);

    try {
      const response = await exportBulkNotes({
        strategy: "syncMissingNotes",
        selectedBookIds: [bookId],
        concurrency: 1,
        excludeWithoutExportableNotes
      });
      setBulkResult(response);
      showToast({
        message: `已重试 ${response.report.items[0]?.title ?? "失败书籍"}。`,
        tone: response.report.items.some((item) => item.status === "failed") ? "warning" : "success"
      });
    } catch (retryError) {
      const message = getCommandErrorMessage(retryError);
      setBulkExportError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsBulkExporting(false);
    }
  }

  async function handleCancelBulkExport() {
    try {
      await cancelBulkExport();
      showToast({ message: "已请求停止后续同步，已完成内容会保留在导出报告中。", tone: "warning" });
    } catch (cancelError) {
      showToast({ message: getCommandErrorMessage(cancelError), tone: "error" });
    }
  }

  function handleClearBulkExportError() {
    setBulkExportError(undefined);
    setBulkResult(undefined);
  }

  function toggleSelectedBook(bookId: string) {
    setSelectedBookIds((current) =>
      current.includes(bookId) ? current.filter((id) => id !== bookId) : [...current, bookId]
    );
  }

  function handleBulkStrategyChange(nextStrategy: BulkExportStrategy) {
    setBulkStrategy(nextStrategy);
    setBulkExportError(undefined);
    if (nextStrategy === "selectedBooksOnly") {
      setSelectedBookIds([]);
    } else if (bulkPreflight) {
      setSelectedBookIds(getBulkExportableIds(bulkPreflight));
    }
  }

  function handleExcludeWithoutExportableNotesChange(checked: boolean) {
    setExcludeWithoutExportableNotes(checked);
    void runBulkPreflight(undefined, checked);
  }

  return (
    <section className="notes-page" aria-label="笔记中心">
      <div className="notes-hero">
        <div>
          <p className="section-kicker">个人笔记</p>
          <h3>划线、想法和书签数量</h3>
          <p>书签只纳入统计；正文内容只展示和导出划线、想法/点评。</p>
        </div>
        <div className="notes-hero-actions" aria-label="笔记操作">
          <button
            className="sync-button"
            type="button"
            onClick={() => void loadOverview()}
            disabled={!hasCredential || isLoading}
          >
            {isLoading ? (
              <Loader2 aria-hidden="true" size={18} className="spin" />
            ) : (
              <RefreshCw aria-hidden="true" size={18} />
            )}
            {isLoading ? "同步中" : "同步笔记"}
          </button>
          <button
            className="sync-button"
            type="button"
            onClick={() => void handleOpenBulkWizard()}
            disabled={!hasCredential || isBulkPreflighting}
          >
            {isBulkPreflighting ? (
              <Loader2 aria-hidden="true" size={18} className="spin" />
            ) : (
              <Download aria-hidden="true" size={18} />
            )}
            批量导出
          </button>
        </div>
      </div>

      <section className="shelf-summary-row" aria-label="笔记统计">
        <SummaryPill label="有笔记书籍" value={overview?.summary.totalBookCount ?? books.length} />
        <SummaryPill label="总笔记" value={overview?.summary.totalNoteCount ?? 0} />
        <SummaryPill label="划线" value={totalHighlights} />
        <SummaryPill label="想法/点评" value={totalThoughts} />
        <SummaryPill label="书签" value={totalBookmarks} />
      </section>

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="笔记同步通过本地 Rust 命令执行。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {reviewCandidates.length > 0 ? (
        <section className="notes-review-panel" aria-label="建议复盘">
          <div className="notes-review-heading">
            <div>
              <p className="section-kicker">建议复盘</p>
              <h3>优先整理这些有想法的书</h3>
              <p>只基于本地笔记数量和已生成复盘缓存排序，不会自动调用 AI。</p>
            </div>
            <span>{reviewCandidates.length} 本</span>
          </div>
          <div className="notes-review-grid">
            {reviewCandidates.map((book) => (
              <ReviewSuggestionCard key={book.bookId} book={book} onOpen={onOpenBookNotes} />
            ))}
          </div>
        </section>
      ) : null}

      {books.length > 0 ? (
        <label className="search-field">
          <Search aria-hidden="true" size={18} />
          <input
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="按书名或作者筛选笔记"
          />
        </label>
      ) : null}

      {isLoading && books.length === 0 ? <NotesLoading /> : null}

      {!isLoading && hasCredential && books.length === 0 ? (
        <section className="empty-state" aria-label="笔记为空">
          <img src={emptyNotes} alt="" />
          <div>
            <h3>还没有同步笔记</h3>
            <p>同步后会显示有划线、想法或书签数量的书籍，并支持进入单本书查看内容。</p>
            <button className="secondary-action" type="button" onClick={() => void loadOverview()}>
              同步笔记
            </button>
          </div>
        </section>
      ) : null}

      {books.length > 0 && filteredBooks.length === 0 ? (
        <section className="empty-inline" aria-label="筛选无结果">
          <SearchX aria-hidden="true" size={28} />
          <h3>没有匹配的笔记书籍</h3>
          <p>换一个关键词，或清空搜索后继续浏览。</p>
          <button className="secondary-action" type="button" onClick={handleClearQuery}>
            清空搜索
          </button>
        </section>
      ) : null}

      {filteredBooks.length > 0 ? (
        <div className="notebook-grid" aria-label="有笔记的书">
          {filteredBooks.map((book) => (
            <NotebookBookCard key={book.bookId} book={book} onOpen={onOpenBookNotes} />
          ))}
        </div>
      ) : null}

      {isBulkWizardOpen ? (
        <BulkExportWizard
          preflight={bulkPreflight}
          result={bulkResult}
          exportError={bulkExportError}
          progress={bulkProgress}
          strategy={bulkStrategy}
          concurrency={bulkConcurrency}
          excludeWithoutExportableNotes={excludeWithoutExportableNotes}
          selectedBookIds={selectedBookIds}
          searchQuery={bulkSearchQuery}
          isPreflighting={isBulkPreflighting}
          isExporting={isBulkExporting}
          onStrategyChange={handleBulkStrategyChange}
          onConcurrencyChange={setBulkConcurrency}
          onExcludeWithoutExportableNotesChange={handleExcludeWithoutExportableNotesChange}
          onSearchQueryChange={setBulkSearchQuery}
          onToggleBook={toggleSelectedBook}
          onRefresh={() => void runBulkPreflight(undefined)}
          onExport={() => void handleRunBulkExport()}
          onClearExportError={handleClearBulkExportError}
          onRetryItem={(bookId) => void handleRetryBulkExportItem(bookId)}
          onCancelExport={() => void handleCancelBulkExport()}
          onClose={() => setIsBulkWizardOpen(false)}
        />
      ) : null}
    </section>
  );
}

function BulkExportWizard({
  preflight,
  result,
  exportError,
  progress,
  strategy,
  concurrency,
  excludeWithoutExportableNotes,
  selectedBookIds,
  searchQuery,
  isPreflighting,
  isExporting,
  onStrategyChange,
  onConcurrencyChange,
  onExcludeWithoutExportableNotesChange,
  onSearchQueryChange,
  onToggleBook,
  onRefresh,
  onExport,
  onClearExportError,
  onRetryItem,
  onCancelExport,
  onClose
}: {
  preflight?: BulkExportPreflight;
  result?: BulkExportResponse;
  exportError?: string;
  progress?: BulkExportProgress;
  strategy: BulkExportStrategy;
  concurrency: number;
  excludeWithoutExportableNotes: boolean;
  selectedBookIds: string[];
  searchQuery: string;
  isPreflighting: boolean;
  isExporting: boolean;
  onStrategyChange: (strategy: BulkExportStrategy) => void;
  onConcurrencyChange: (concurrency: number) => void;
  onExcludeWithoutExportableNotesChange: (checked: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onToggleBook: (bookId: string) => void;
  onRefresh: () => void;
  onExport: () => void;
  onClearExportError: () => void;
  onRetryItem: (bookId: string) => void;
  onCancelExport: () => void;
  onClose: () => void;
}) {
  const selectedCount = selectedBookIds.length;
  const exportDisabled =
    isPreflighting ||
    isExporting ||
    !preflight ||
    preflight.items.length === 0 ||
    (strategy === "selectedBooksOnly" && selectedCount === 0);
  const stage = exportError ? "error" : result ? "result" : isExporting ? "running" : "setup";
  const showStatus = stage !== "result" && stage !== "error" && (isPreflighting || isExporting);
  const statusTitle = isExporting ? bulkExportProgressTitle(strategy) : "正在预检本地缓存";
  const statusDescription = isExporting
    ? bulkExportProgressDescription(strategy, concurrency, selectedCount)
    : "正在读取本地笔记概览、单本笔记缓存和已生成复盘缓存，不会请求远端内容。";
  const visiblePreflightItems = preflight
    ? filterBulkPreflightItems(preflight.items, strategy === "selectedBooksOnly" ? searchQuery : "")
    : [];

  return (
    <div className="bulk-export-backdrop" role="presentation">
      <section className="bulk-export-dialog" role="dialog" aria-modal="true" aria-label="批量导出向导">
        <div className="bulk-export-heading">
          <div>
            <p className="section-kicker">批量导出</p>
            <h3>导出笔记与已生成复盘</h3>
            <p>
              先预检本地缓存，再选择导出策略。只有选择同步策略时才会读取缺失书籍；AI 复盘只导出已有缓存。
            </p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭批量导出向导">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {showStatus ? (
          <section className="bulk-export-status" aria-label="批量导出状态" aria-live="polite">
            <Loader2 aria-hidden="true" size={20} className="spin" />
            <div>
              <h4>{statusTitle}</h4>
              <p>{statusDescription}</p>
            </div>
            {isExporting && strategy === "syncMissingNotes" ? (
              <button className="text-button" type="button" onClick={onCancelExport}>
                停止后续同步
              </button>
            ) : null}
          </section>
        ) : null}

        {stage === "setup" ? (
          preflight ? (
            <section className="bulk-export-summary" aria-label="批量导出预检结果">
              <SummaryPill label="可直接导出" value={preflight.readyCount} />
              <SummaryPill label="需要同步" value={preflight.needsSyncCount} />
              <SummaryPill label="无可导出" value={preflight.noContentCount} />
              <SummaryPill label="已有复盘" value={preflight.cachedAiReviewCount} />
            </section>
          ) : (
            <section className="book-detail-loading" aria-label="正在预检批量导出">
              <Loader2 aria-hidden="true" size={24} className="spin" />
              <div>
                <h3>正在读取本地缓存索引</h3>
                <p>预检只扫描本地笔记概览、单本笔记缓存和已生成复盘缓存。</p>
              </div>
            </section>
          )
        ) : null}

        {stage === "running" && preflight ? (
          <section className="bulk-export-run-summary" aria-label="本次导出摘要">
            <SummaryPill label="导出策略" value={bulkStrategySummaryValue(strategy, selectedCount)} />
            <SummaryPill label="可直接导出" value={preflight.readyCount} />
            <SummaryPill label="需要同步" value={preflight.needsSyncCount} />
            <SummaryPill label="已有复盘" value={preflight.cachedAiReviewCount} />
          </section>
        ) : null}

        {stage === "running" && progress ? <BulkExportProgressPanel progress={progress} /> : null}

        {stage === "setup" && preflight ? (
          <>
            <section className="bulk-export-setup" aria-label="导出设置">
              <section className="bulk-export-strategies" aria-label="导出策略">
                <StrategyOption
                  value="localCachedOnly"
                  checked={strategy === "localCachedOnly"}
                  title="仅导出本地已缓存内容"
                  description="不会读取微信读书远端；未缓存书籍会在报告中标记需要同步。"
                  onChange={onStrategyChange}
                />
                <StrategyOption
                  value="syncMissingNotes"
                  checked={strategy === "syncMissingNotes"}
                  title="先同步缺失笔记再导出"
                  description="只在本次确认后按有界队列读取缺失书籍，单本失败不阻断整体导出。"
                  onChange={onStrategyChange}
                />
                <StrategyOption
                  value="selectedBooksOnly"
                  checked={strategy === "selectedBooksOnly"}
                  title="只导出选中的书"
                  description="适合先缩小范围；仍遵守当前缓存边界，不自动生成 AI 复盘。"
                  onChange={onStrategyChange}
                />
              </section>

              <div className="bulk-export-toolbar">
                {strategy === "syncMissingNotes" ? (
                  <label className="bulk-export-concurrency">
                    <span>同步并发</span>
                    <select
                      value={concurrency}
                      onChange={(event) => onConcurrencyChange(Number(event.target.value))}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2（推荐）</option>
                      <option value={3}>3（上限）</option>
                    </select>
                  </label>
                ) : null}

                <label
                  className="bulk-export-filter-option"
                  title="只处理可能导出 Markdown 的书；只有书签或同步后仍无可导出内容会跳过。"
                >
                  <input
                    type="checkbox"
                    checked={excludeWithoutExportableNotes}
                    onChange={(event) => onExcludeWithoutExportableNotesChange(event.target.checked)}
                  />
                  <strong>排除无划线/想法的书</strong>
                </label>

                {strategy === "selectedBooksOnly" ? (
                  <label className="search-field">
                    <Search aria-hidden="true" size={18} />
                    <input
                      value={searchQuery}
                      onChange={(event) => onSearchQueryChange(event.target.value)}
                      placeholder="按书名或作者筛选导出书籍"
                    />
                  </label>
                ) : null}

                {strategy === "selectedBooksOnly" ? (
                  <p className="bulk-export-selection-summary">已选择 {selectedCount} 本</p>
                ) : null}
              </div>
            </section>

            <section className="bulk-export-list" aria-label="批量导出书籍预检">
              {visiblePreflightItems.map((item) => (
                <BulkExportPreflightRow
                  key={item.bookId}
                  item={item}
                  strategy={strategy}
                  checked={selectedBookIds.includes(item.bookId)}
                  selectable={strategy === "selectedBooksOnly"}
                  onToggle={onToggleBook}
                />
              ))}
              {visiblePreflightItems.length === 0 ? (
                <p className="bulk-export-empty">没有匹配的导出书籍。</p>
              ) : null}
            </section>
          </>
        ) : null}

        {stage === "result" && result ? (
          <section className="bulk-export-result" aria-label="批量导出报告">
            <div>
              <h3>导出完成</h3>
              <p>{result.path}</p>
            </div>
            <span>{result.files.length} 个文件</span>
            <div className="bulk-export-result-list">
              {result.report.items.slice(0, 6).map((item) => (
                <article className="bulk-export-result-item" key={item.bookId}>
                  <p>
                    <strong>{item.title}</strong>
                    <span>{bulkStatusLabel(item.status)} · {item.reason}</span>
                  </p>
                  {item.status === "failed" ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onRetryItem(item.bookId)}
                      disabled={isExporting}
                    >
                      重试 {item.title}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {stage === "error" && exportError ? (
          <ExportFailurePanel
            ariaLabel="批量导出报告"
            error={exportError}
            contextTitle="当前不会丢失预检结果和导出设置"
            contextDescription="可以直接重试，也可以返回设置调整策略；不会静默同步微信读书远端或自动生成 AI 复盘。"
          />
        ) : null}

        <div className="bulk-export-actions">
          {stage === "error" ? (
            <>
              <button className="text-button" type="button" onClick={onClearExportError} disabled={isExporting}>
                返回设置
              </button>
              <button className="secondary-action" type="button" onClick={onExport} disabled={exportDisabled}>
                重试导出
              </button>
            </>
          ) : (
            <>
              <button
                className="text-button"
                type="button"
                onClick={onRefresh}
                disabled={isPreflighting || isExporting}
              >
                重新预检
              </button>
              {stage === "result" ? (
                <button className="secondary-action" type="button" onClick={onClose}>
                  完成
                </button>
              ) : (
                <button className="secondary-action" type="button" onClick={onExport} disabled={exportDisabled}>
                  {isBulkBusyText(isPreflighting, isExporting)}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function StrategyOption({
  value,
  checked,
  title,
  description,
  onChange
}: {
  value: BulkExportStrategy;
  checked: boolean;
  title: string;
  description: string;
  onChange: (strategy: BulkExportStrategy) => void;
}) {
  return (
    <label className="bulk-export-strategy">
      <input
        type="radio"
        name="bulk-export-strategy"
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function BulkExportProgressPanel({ progress }: { progress: BulkExportProgress }) {
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const activeTitles = progress.active.map((book) => book.title).join("、") || "等待下一个任务";

  return (
    <section className="bulk-export-progress" aria-label="批量导出同步进度" aria-live="polite">
      <div className="bulk-export-progress-heading">
        <div>
          <span>同步进度</span>
          <strong>
            {progress.completed} / {progress.total}
          </strong>
        </div>
        <p>{bulkExportPhaseLabel(progress.phase)}</p>
      </div>
      <div className="bulk-export-progress-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
      </div>
      <div className="bulk-export-progress-body">
        <p>当前：{activeTitles}</p>
        <p>{progress.message}</p>
      </div>
      <div className="bulk-export-progress-stats">
        <span>已导出 {progress.exported}</span>
        <span>失败 {progress.failed}</span>
        <span>跳过 {progress.skipped}</span>
        <span>取消 {progress.canceled}</span>
      </div>
      {progress.latest ? (
        <p className="bulk-export-progress-latest">
          最近完成：{progress.latest.title} · {bulkStatusLabel(progress.latest.status)}
        </p>
      ) : null}
    </section>
  );
}

function BulkExportPreflightRow({
  item,
  strategy,
  checked,
  selectable,
  onToggle
}: {
  item: BulkExportPreflightItem;
  strategy: BulkExportStrategy;
  checked: boolean;
  selectable: boolean;
  onToggle: (bookId: string) => void;
}) {
  const rowState = getBulkPreflightRowState(item, strategy, checked);

  return (
    <article className={`bulk-export-row is-${rowState.tone}`}>
      {selectable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item.bookId)}
          aria-label={`选择 ${item.title}`}
        />
      ) : null}
      <div>
        <strong>{item.title}</strong>
        <small>
          {item.author || "暂无作者信息"} · {item.totalNoteCount} 条笔记 · 本地可导出{" "}
          {item.cachedExportableCount} 条
        </small>
        <span>{rowState.reason}</span>
      </div>
      <em>{rowState.label}</em>
      {item.hasCachedAiReview ? <b>已有复盘</b> : null}
    </article>
  );
}

function NotebookBookCard({
  book,
  onOpen
}: {
  book: NotebookBook;
  onOpen: (book: NotebookBook) => void;
}) {
  const totalNotes = calculateTotalNotes(book);

  return (
    <button type="button" className="notebook-card" onClick={() => onOpen(book)}>
      <span className="cover-frame notebook-cover">
        {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={30} />}
      </span>
      <span className="notebook-card-copy">
        <strong>{book.title}</strong>
        <small>{book.author || "暂无作者信息"}</small>
        <span className="note-count-row">
          <span>
            <Bookmark aria-hidden="true" size={14} />
            {book.noteCount} 划线
          </span>
          <span>
            <MessageSquareText aria-hidden="true" size={14} />
            {book.reviewCount} 想法
          </span>
        </span>
        <span className="notebook-card-footer">
          <b>{totalNotes}</b> 条笔记
          {book.readingProgress !== undefined ? ` · 进度 ${formatProgress(book.readingProgress)}` : ""}
          <ChevronRight aria-hidden="true" size={16} />
        </span>
      </span>
    </button>
  );
}

function ReviewSuggestionCard({
  book,
  onOpen
}: {
  book: NotebookBook;
  onOpen: (book: NotebookBook) => void;
}) {
  const totalNotes = calculateTotalNotes(book);

  return (
    <button type="button" className="notes-review-card" onClick={() => onOpen(book)}>
      <span className="notes-review-icon">
        <Sparkles aria-hidden="true" size={18} />
      </span>
      <span>
        <strong>{book.title}</strong>
        <small>{book.author || "暂无作者信息"}</small>
        <em>{book.reviewCount} 条想法 · {totalNotes} 条笔记</em>
      </span>
      <ChevronRight aria-hidden="true" size={17} />
    </button>
  );
}

function NotesLoading() {
  return (
    <div className="notes-loading" aria-label="正在读取笔记">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
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

function bulkStatusLabel(status: BulkExportPreflightItem["status"]): string {
  switch (status) {
    case "ready":
      return "可导出";
    case "needsSync":
      return "需要同步";
    case "noContent":
      return "无内容";
    case "exported":
      return "已导出";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    case "skipped":
    default:
      return "已跳过";
  }
}

function getBulkExportableIds(preflight: BulkExportPreflight): string[] {
  return preflight.items
    .filter((item) => item.status === "ready" || item.status === "needsSync")
    .map((item) => item.bookId);
}

function filterBulkPreflightItems(
  items: BulkExportPreflightItem[],
  query: string
): BulkExportPreflightItem[] {
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return items;
  }

  return items.filter((item) => {
    const title = item.title.toLowerCase();
    const author = item.author?.toLowerCase() ?? "";
    return title.includes(keyword) || author.includes(keyword);
  });
}

function getBulkPreflightRowState(
  item: BulkExportPreflightItem,
  strategy: BulkExportStrategy,
  checked: boolean
): { label: string; reason: string; tone: string } {
  if (strategy === "selectedBooksOnly") {
    return {
      label: checked ? "已选" : "未选",
      reason: checked ? item.reason : "不会包含在本次导出中。",
      tone: checked ? item.status : "unselected"
    };
  }

  if (strategy === "syncMissingNotes" && item.status === "needsSync") {
    return {
      label: "将同步",
      reason: "将按队列读取后导出。",
      tone: "willSync"
    };
  }

  return {
    label: bulkStatusLabel(item.status),
    reason: item.reason,
    tone: item.status
  };
}

function isBulkBusyText(isPreflighting: boolean, isExporting: boolean): string {
  if (isPreflighting) {
    return "预检中";
  }

  if (isExporting) {
    return "导出中";
  }

  return "开始导出";
}

function bulkExportProgressTitle(strategy: BulkExportStrategy): string {
  switch (strategy) {
    case "syncMissingNotes":
      return "正在同步缺失笔记并导出";
    case "selectedBooksOnly":
      return "正在导出选中的书";
    case "localCachedOnly":
    default:
      return "正在导出本地已缓存内容";
  }
}

function bulkExportPhaseLabel(phase: BulkExportProgress["phase"]): string {
  switch (phase) {
    case "preparing":
      return "准备导出";
    case "exportingCached":
      return "导出本地缓存";
    case "syncing":
      return "同步缺失笔记";
    case "writingReport":
      return "写入报告";
    case "completed":
    default:
      return "导出完成";
  }
}

function bulkStrategySummaryValue(strategy: BulkExportStrategy, selectedCount: number): string {
  switch (strategy) {
    case "syncMissingNotes":
      return "同步后导出";
    case "selectedBooksOnly":
      return `${selectedCount} 本选中`;
    case "localCachedOnly":
    default:
      return "仅本地缓存";
  }
}

function bulkExportProgressDescription(
  strategy: BulkExportStrategy,
  concurrency: number,
  selectedCount: number
): string {
  switch (strategy) {
    case "syncMissingNotes":
      return `按有界队列读取缺失书籍后导出，当前同步并发 ${concurrency}。已完成内容会保留在报告中。`;
    case "selectedBooksOnly":
      return `正在处理 ${selectedCount} 本选中书籍，不会自动生成 AI 复盘。`;
    case "localCachedOnly":
    default:
      return "只导出本地已缓存笔记和已有复盘，未缓存书籍会在报告中标记需要同步。";
  }
}

function filterBooks(books: NotebookBook[], query: string): NotebookBook[] {
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return books;
  }

  return books.filter((book) => {
    const title = book.title.toLowerCase();
    const author = book.author?.toLowerCase() ?? "";
    return title.includes(keyword) || author.includes(keyword);
  });
}

function getReviewCandidates(
  books: NotebookBook[],
  summaryItems: BookAiSummaryListItem[]
): NotebookBook[] {
  const summarizedBookIds = new Set(summaryItems.map((item) => item.bookId));

  return [...books]
    .filter((book) => calculateTotalNotes(book) > 0 && !summarizedBookIds.has(book.bookId))
    .sort((left, right) => {
      const thoughtDelta = right.reviewCount - left.reviewCount;
      if (thoughtDelta !== 0) {
        return thoughtDelta;
      }

      const noteDelta = calculateTotalNotes(right) - calculateTotalNotes(left);
      if (noteDelta !== 0) {
        return noteDelta;
      }

      return (right.sort ?? 0) - (left.sort ?? 0);
    })
    .slice(0, 3);
}
