import { useDeferredValue, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ListChecks,
  Loader2,
  Search,
  SearchX,
  Sparkles,
  Waypoints,
  X
} from "lucide-react";
import { AiActionFeedbackChecklist } from "../components/AiActionFeedbackChecklist";
import { reflectionFeedbackLabels } from "../components/AiActionFeedbackChecklist";
import { calculateTotalNotes } from "../lib/business-rules";
import { buildAssetVersionChangeSummary } from "../lib/ai-asset-version-diff";
import {
  buildAiActionItemId,
  buildAiReflectionQuestionId,
  deriveAiAssetActionItemFeedback,
  getAiActionItemStorage,
  hasAiReviewFeedback,
  readAiAssetActionItemFeedback,
  readAiReviewFeedback,
  summarizeAiActionFeedback,
  writeAiReviewFeedback,
  type AiActionFeedbackByItemId,
  type AiActionFeedbackRecord,
  type AiActionFeedbackSummary,
  type AiReviewFeedbackState
} from "../lib/ai-action-items";
import {
  getAIAssetDetail,
  getAIAssetVersionDetail,
  getAIAssetVersionHistory,
  getAiReviewFeedback,
  getCommandErrorMessage,
  getNotebookOverview,
  listAIAssetSummaries,
  listBookNotesSummaries,
  saveAiReviewFeedback,
  type NotebookOverviewResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import { formatAiTimestamp } from "../lib/formatters";
import type {
  AIAssetDetail,
  AIAssetVersionDetail,
  AIAssetVersionSummary,
  AIAssetSummary,
  AssetVersionRef,
  BookAiSummaryListItem,
  CredentialStatus,
  ExportAiBulkMarkdownResponse,
  NotebookBook,
  ReadingStatsMode
} from "../lib/types";
import { BookReviewExportDialog, filterBookAiSummaryItems } from "./BookReviewExportDialog";
import { ReadingRouteResultPanel } from "./reading-route/ReadingRouteResultPanel";
import { buildGuideActionText, buildGuideDetailSections } from "./reading-route/guide-prescription";
import { ReadingReviewPage } from "./ReadingReviewPage";

type ReadingHubTab = "books" | "guides" | "report";
type AIAssetDetailTab = "guide" | "routes" | "review";
type SelectedAssetVersion = Pick<AssetVersionRef, "feature" | "scopeId" | "inputHash">;

type ReadingHubPageProps = {
  credentialStatus?: CredentialStatus;
  cache: Partial<Record<ReadingStatsMode, ReadingStatsResponse>>;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
  activeTab: ReadingHubTab;
  onOpenBookSummary: (book: NotebookBook) => void;
  onPrepareAssetUpdate: (detail: AIAssetVersionDetail, book: AIAssetDetail) => void;
  onOpenNotes: () => void;
  notesOverview?: NotebookOverviewResponse;
  onNotesOverviewChange: (overview: NotebookOverviewResponse | undefined) => void;
};

export function ReadingHubPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings,
  activeTab,
  onOpenBookSummary,
  onPrepareAssetUpdate,
  onOpenNotes,
  notesOverview,
  onNotesOverviewChange
}: ReadingHubPageProps) {
  const [summaryItems, setSummaryItems] = useState<BookAiSummaryListItem[]>([]);
  const [assetSummaries, setAssetSummaries] = useState<AIAssetSummary[]>([]);
  const [selectedAssetBookId, setSelectedAssetBookId] = useState<string>();
  const [assetDetail, setAssetDetail] = useState<AIAssetDetail>();
  const [selectedAssetVersion, setSelectedAssetVersion] = useState<SelectedAssetVersion>();
  const [assetVersionDetail, setAssetVersionDetail] = useState<AIAssetVersionDetail>();
  const [previousAssetVersionDetail, setPreviousAssetVersionDetail] = useState<AIAssetVersionDetail>();
  const [assetDetailTab, setAssetDetailTab] = useState<AIAssetDetailTab>("guide");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [isLoadingSummaries, setIsLoadingSummaries] = useState(false);
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);
  const [isLoadingAssetDetail, setIsLoadingAssetDetail] = useState(false);
  const [isLoadingAssetVersionDetail, setIsLoadingAssetVersionDetail] = useState(false);
  const [isLoadingNotebook, setIsLoadingNotebook] = useState(false);
  const [exportResult, setExportResult] = useState<ExportAiBulkMarkdownResponse>();
  const [isBookReviewExportDialogOpen, setIsBookReviewExportDialogOpen] = useState(false);
  const [error, setError] = useState<string>();
  const hasCredential = credentialStatus?.hasCredential === true;

  useEffect(() => {
    if (activeTab !== "books") {
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
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
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
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "guides" || !selectedAssetBookId) {
      return;
    }

    let isMounted = true;
    const bookId = selectedAssetBookId;

    async function loadAssetDetail() {
      setIsLoadingAssetDetail(true);
      setError(undefined);

      try {
        const response = await getAIAssetDetail(bookId);
        if (isMounted) {
          setAssetDetail(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingAssetDetail(false);
        }
      }
    }

    void loadAssetDetail();

    return () => {
      isMounted = false;
    };
  }, [activeTab, selectedAssetBookId]);

  useEffect(() => {
    if (activeTab !== "guides" || !selectedAssetVersion) {
      return;
    }

    let isMounted = true;
    const version = selectedAssetVersion;

    async function loadAssetVersionDetail() {
      setIsLoadingAssetVersionDetail(true);
      setError(undefined);
      setPreviousAssetVersionDetail(undefined);

      try {
        const response = await getAIAssetVersionDetail(version);

        if (!isMounted) {
          return;
        }

        setAssetVersionDetail(response);
        if (!response?.previousVersion) {
          setPreviousAssetVersionDetail(undefined);
          return;
        }

        try {
          const previousDetail = await getAIAssetVersionDetail({
            feature: response.previousVersion.feature,
            scopeId: response.previousVersion.scopeId,
            inputHash: response.previousVersion.inputHash
          });

          if (isMounted) {
            setPreviousAssetVersionDetail(previousDetail);
          }
        } catch {
          if (isMounted) {
            setPreviousAssetVersionDetail(undefined);
          }
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingAssetVersionDetail(false);
        }
      }
    }

    void loadAssetVersionDetail();

    return () => {
      isMounted = false;
    };
  }, [activeTab, selectedAssetVersion]);

  useEffect(() => {
    if (activeTab !== "guides") {
      return;
    }

    let isMounted = true;

    async function loadAssets() {
      setIsLoadingAssets(true);
      setError(undefined);

      try {
        const response = await listAIAssetSummaries();
        if (isMounted) {
          setAssetSummaries(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingAssets(false);
        }
      }
    }

    void loadAssets();

    return () => {
      isMounted = false;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "books" || notesOverview || !hasCredential) {
      return;
    }

    let isMounted = true;

    async function loadNotebookOverview() {
      setIsLoadingNotebook(true);

      try {
        const response = await getNotebookOverview();
        if (isMounted) {
          onNotesOverviewChange(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingNotebook(false);
        }
      }
    }

    void loadNotebookOverview();

    return () => {
      isMounted = false;
    };
  }, [activeTab, notesOverview, hasCredential, onNotesOverviewChange]);

  const filteredItems = filterBookAiSummaryItems(summaryItems, deferredQuery);
  const filteredAssetSummaries = filterAssetSummaries(assetSummaries, deferredQuery);
  const reviewCandidates = getReviewCandidates(notesOverview?.books ?? [], summaryItems);
  const latestSummaryTime = getLatestSummaryTime(summaryItems);
  const latestAssetTime = getLatestAssetTime(assetSummaries);
  const summariesWithFeedbackCount = summaryItems.filter((item) => item.feedbackCount > 0).length;

  function handleQueryKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  }

  function handleOpenSummary(item: BookAiSummaryListItem) {
    onOpenBookSummary({
      bookId: item.bookId,
      title: item.title,
      author: item.author,
      cover: item.cover,
      reviewCount: 0,
      noteCount: 0,
      bookmarkCount: 0,
      totalNoteCount: 0
    });
  }

  function handleOpenAssetDetail(item: AIAssetSummary) {
    setSelectedAssetBookId(item.bookId);
    setAssetDetail(undefined);
    setSelectedAssetVersion(undefined);
    setAssetVersionDetail(undefined);
    setPreviousAssetVersionDetail(undefined);
    setAssetDetailTab(item.hasSingleGuide ? "guide" : item.crossRouteCount > 0 ? "routes" : "review");
  }

  function handleBackToAssetList() {
    setSelectedAssetBookId(undefined);
    setAssetDetail(undefined);
    setSelectedAssetVersion(undefined);
    setAssetVersionDetail(undefined);
    setPreviousAssetVersionDetail(undefined);
    setAssetDetailTab("guide");
  }

  function handleOpenAssetVersion(version: AssetVersionRef) {
    setSelectedAssetVersion({
      feature: version.feature,
      scopeId: version.scopeId,
      inputHash: version.inputHash
    });
    setAssetVersionDetail(undefined);
    setPreviousAssetVersionDetail(undefined);
  }

  function handleBackToAssetDetail() {
    setSelectedAssetVersion(undefined);
    setAssetVersionDetail(undefined);
    setPreviousAssetVersionDetail(undefined);
  }

  return (
    <section className="reading-hub-page" aria-label="复盘中心">
      {activeTab === "books" ? (
        <section className="reading-hub-books" aria-label="书籍复盘列表">
          <div className="reading-hub-books-toolbar">
            <div>
              <p className="section-kicker">书籍复盘</p>
              <h3>书籍复盘管理</h3>
              <p>左侧查看已生成复盘，右侧处理有笔记但还没复盘的书。</p>
            </div>
            <div className="reading-hub-toolbar-actions">
              <label className="search-field">
                <Search aria-hidden="true" size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleQueryKeyDown}
                  placeholder="按书名、作者或复盘概览筛选"
                />
                {query ? (
                  <button className="text-button bookshelf-search-clear" type="button" onClick={() => setQuery("")}>
                    <X aria-hidden="true" size={16} />
                    清空
                  </button>
                ) : null}
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setExportResult(undefined);
                  setIsBookReviewExportDialogOpen(true);
                }}
                disabled={summaryItems.length === 0}
              >
                <Download aria-hidden="true" size={16} />
                导出书籍复盘
              </button>
            </div>
          </div>

          {error ? (
            <div className="status-message status-message--error">
              <AlertCircle aria-hidden="true" size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          {exportResult ? (
            <div className="status-message status-message--neutral" aria-label="复盘导出结果">
              <Download aria-hidden="true" size={18} />
              <span>
                已导出 {exportResult.itemCount} 本书籍复盘，路径：{exportResult.path}
              </span>
            </div>
          ) : null}

          {isLoadingNotebook ? (
            <section className="book-detail-loading" aria-label="正在读取复盘候选">
              <Loader2 aria-hidden="true" size={26} className="spin" />
              <div>
                <h3>正在读取本地笔记索引</h3>
                <p>用于判断哪些书值得生成复盘，不会自动调用 AI。</p>
              </div>
            </section>
          ) : null}

          <section className="reading-hub-status-strip" aria-label="书籍复盘状态">
            <StatusPill label="已生成" value={`${summaryItems.length} 本`} />
            <StatusPill label="待生成" value={`${reviewCandidates.length} 本`} />
            <StatusPill label="有反馈" value={`${summariesWithFeedbackCount} 本`} />
            <StatusPill label="最近更新" value={latestSummaryTime ? formatAiTimestamp(latestSummaryTime) : "暂无"} />
          </section>

          <div className="reading-hub-management-layout">
            <section className="reading-hub-generated-panel" aria-label="已生成复盘">
              <div className="reading-hub-section-heading">
                <div>
                  <p className="section-kicker">已生成</p>
                  <h3>已生成的书籍复盘</h3>
                </div>
                <span>{filteredItems.length} 本</span>
              </div>

              {isLoadingSummaries ? (
                <section className="book-detail-loading" aria-label="正在读取书籍复盘缓存">
                  <Loader2 aria-hidden="true" size={26} className="spin" />
                  <div>
                    <h3>正在读取本地复盘缓存</h3>
                    <p>这里只展示已经生成过 AI 复盘的书，不会自动调用 AI。</p>
                  </div>
                </section>
              ) : null}

              {!isLoadingSummaries && summaryItems.length === 0 ? (
                <section className="empty-inline stats-empty" aria-label="暂无书籍复盘">
                  <Database aria-hidden="true" size={28} />
                  <h3>还没有书籍复盘</h3>
                  <p>先去笔记页打开一本书并生成 AI 复盘，这里才会出现列表。</p>
                  <button className="secondary-action" type="button" onClick={onOpenNotes}>
                    去笔记中心
                  </button>
                </section>
              ) : null}

              {!isLoadingSummaries && summaryItems.length > 0 && filteredItems.length === 0 ? (
                <section className="empty-inline stats-empty" aria-label="筛选无结果">
                  <SearchX aria-hidden="true" size={28} />
                  <h3>没有匹配的书籍复盘</h3>
                  <p>搜索只过滤已生成复盘；建议生成列表保持不变。</p>
                </section>
              ) : null}

              {!isLoadingSummaries && filteredItems.length > 0 ? (
                <div className="reading-hub-book-grid">
                  {filteredItems.map((item) => (
                    <button
                      type="button"
                      key={item.bookId}
                      className="reading-hub-book-card"
                      onClick={() => handleOpenSummary(item)}
                    >
                      <span className="reading-hub-book-cover">
                        {item.cover ? <img src={item.cover} alt="" /> : <BookOpen aria-hidden="true" size={26} />}
                      </span>
                      <span className="reading-hub-book-copy">
                        <strong>{item.title}</strong>
                        <small>{item.author || "未知作者"}</small>
                        <p>{item.overview}</p>
                      </span>
                      <span className="reading-hub-book-meta">
                        <span>{formatAiTimestamp(item.cachedUpdatedAt)}</span>
                        {item.providerModel ? <small>{item.providerModel}</small> : null}
                        {item.feedbackCount > 0 ? <b>{item.feedbackCount} 条反馈</b> : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="review-candidate-panel" aria-label="建议生成复盘">
              <div className="review-candidate-heading">
                <div>
                  <p className="section-kicker">建议生成</p>
                  <h3>有笔记但还没复盘</h3>
                  <p>按想法数、总笔记数和阅读进度排序。搜索不会影响这里，生成仍需手动确认。</p>
                </div>
                <span>{reviewCandidates.length} 本候选</span>
              </div>
              {reviewCandidates.length > 0 ? (
                <div className="review-candidate-grid">
                  {reviewCandidates.map((book) => (
                    <ReviewCandidateCard key={book.bookId} book={book} onOpen={onOpenBookSummary} />
                  ))}
                </div>
              ) : (
                <div className="review-candidate-empty">
                  <Sparkles aria-hidden="true" size={24} />
                  <span>当前没有待生成的书籍复盘。</span>
                  <button className="secondary-action" type="button" onClick={onOpenNotes}>
                    去同步笔记
                  </button>
                </div>
              )}
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "guides" && selectedAssetBookId && selectedAssetVersion ? (
        <AIAssetVersionDetailView
          detail={assetVersionDetail}
          previousDetail={previousAssetVersionDetail}
          isLoading={isLoadingAssetVersionDetail}
          assetBook={assetDetail}
          onBack={handleBackToAssetDetail}
          onPrepareUpdate={onPrepareAssetUpdate}
        />
      ) : null}

      {activeTab === "guides" && selectedAssetBookId && !selectedAssetVersion ? (
        <AIAssetDetailView
          detail={assetDetail}
          isLoading={isLoadingAssetDetail}
          activeTab={assetDetailTab}
          onTabChange={setAssetDetailTab}
          onBack={handleBackToAssetList}
          onOpenVersion={handleOpenAssetVersion}
        />
      ) : null}

      {activeTab === "guides" && !selectedAssetBookId ? (
        <section className="reading-hub-books" aria-label="阅读指南资产列表">
          <div className="reading-hub-books-toolbar">
            <div>
              <p className="section-kicker">阅读指南</p>
              <h3>按书聚合的阅读资产</h3>
              <p>这里按书展示已生成的本书指南、跨书路线和复盘状态，不会自动调用 AI。</p>
            </div>
            <div className="reading-hub-toolbar-actions">
              <label className="search-field">
                <Search aria-hidden="true" size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleQueryKeyDown}
                  placeholder="按书名、作者或阶段筛选阅读资产"
                />
                {query ? (
                  <button className="text-button bookshelf-search-clear" type="button" onClick={() => setQuery("")}>
                    <X aria-hidden="true" size={16} />
                    清空
                  </button>
                ) : null}
              </label>
            </div>
          </div>

          {error ? (
            <div className="status-message status-message--error">
              <AlertCircle aria-hidden="true" size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="reading-hub-status-strip" aria-label="阅读指南资产状态">
            <StatusPill label="资产书籍" value={`${assetSummaries.length} 本`} />
            <StatusPill label="本书指南" value={`${assetSummaries.filter((item) => item.hasSingleGuide).length} 本`} />
            <StatusPill
              label="跨书路线"
              value={`${assetSummaries.reduce((total, item) => total + item.crossRouteCount, 0)} 条`}
            />
            <StatusPill label="最近更新" value={latestAssetTime ? formatAiTimestamp(latestAssetTime) : "暂无"} />
          </section>

          <section className="reading-hub-generated-panel" aria-label="已生成阅读指南">
            <div className="reading-hub-section-heading">
              <div>
                <p className="section-kicker">资产列表</p>
                <h3>阅读指南与复盘资产</h3>
              </div>
              <span>{filteredAssetSummaries.length} 本</span>
            </div>

            {isLoadingAssets ? (
              <section className="book-detail-loading" aria-label="正在读取阅读资产缓存">
                <Loader2 aria-hidden="true" size={26} className="spin" />
                <div>
                  <h3>正在读取本地阅读资产</h3>
                  <p>只聚合已经生成的 AI 缓存，不读取远端笔记。</p>
                </div>
              </section>
            ) : null}

            {!isLoadingAssets && assetSummaries.length === 0 ? (
              <section className="empty-inline stats-empty" aria-label="暂无阅读指南资产">
                <Waypoints aria-hidden="true" size={28} />
                <h3>还没有阅读指南资产</h3>
                <p>从书籍详情生成本书阅读指南或跨书路线后，这里会按书归档展示。</p>
              </section>
            ) : null}

            {!isLoadingAssets && assetSummaries.length > 0 && filteredAssetSummaries.length === 0 ? (
              <section className="empty-inline stats-empty" aria-label="筛选无阅读资产">
                <SearchX aria-hidden="true" size={28} />
                <h3>没有匹配的阅读资产</h3>
                <p>搜索只过滤当前资产列表，不影响已生成缓存。</p>
              </section>
            ) : null}

            {!isLoadingAssets && filteredAssetSummaries.length > 0 ? (
              <div className="reading-hub-book-grid">
                {filteredAssetSummaries.map((item) => (
                  <AIAssetCard key={item.bookId} item={item} onOpen={handleOpenAssetDetail} />
                ))}
              </div>
            ) : null}
          </section>
        </section>
      ) : null}

      {activeTab === "report" ? (
        <ReadingReviewPage
          credentialStatus={credentialStatus}
          cache={cache}
          onCacheChange={onCacheChange}
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {isBookReviewExportDialogOpen ? (
        <BookReviewExportDialog
          items={summaryItems}
          onClose={() => setIsBookReviewExportDialogOpen(false)}
          onExportComplete={setExportResult}
        />
      ) : null}
    </section>
  );
}

function filterAssetSummaries(items: AIAssetSummary[], query: string): AIAssetSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }

  return items.filter((item) =>
    [
      item.title,
      item.author,
      item.readingStage,
      item.readingStageLabel,
      item.localStatus,
      refreshReasonLabel(item.refreshReason)
    ]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(normalized))
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <article className="reading-hub-status-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReviewCandidateCard({
  book,
  onOpen
}: {
  book: NotebookBook;
  onOpen: (book: NotebookBook) => void;
}) {
  const totalNotes = calculateTotalNotes(book);
  const thoughtRatio = totalNotes > 0 ? Math.round((book.reviewCount / totalNotes) * 100) : 0;

  return (
    <button type="button" className="review-candidate-card" onClick={() => onOpen(book)}>
      <span className="review-candidate-icon">
        <Sparkles aria-hidden="true" size={18} />
      </span>
      <span className="review-candidate-copy">
        <strong>{book.title}</strong>
        <small>{book.author || "暂无作者信息"}</small>
        <span>
          {book.reviewCount} 条想法 · {totalNotes} 条笔记 · 想法占比 {thoughtRatio}%
        </span>
        <b>去生成</b>
      </span>
      <ChevronRight aria-hidden="true" size={17} />
    </button>
  );
}

function AIAssetCard({
  item,
  onOpen
}: {
  item: AIAssetSummary;
  onOpen: (item: AIAssetSummary) => void;
}) {
  const progressText = typeof item.progress === "number" ? `进度 ${item.progress}%` : "无进度缓存";

  return (
    <button type="button" className="reading-hub-book-card ai-asset-card" onClick={() => onOpen(item)}>
      <span className="reading-hub-book-cover">
        {item.cover ? <img src={item.cover} alt="" /> : <Waypoints aria-hidden="true" size={26} />}
      </span>
      <div className="reading-hub-book-copy">
        <strong>{item.title}</strong>
        <small>{item.author || "未知作者"}</small>
        <p>
          {item.readingStageLabel ? `${item.readingStageLabel}阶段` : "暂无进度阶段"} ·{" "}
          {progressText}
        </p>
      </div>
      <div className="reading-hub-book-meta ai-asset-meta">
        {item.hasSingleGuide ? <span>本书指南</span> : null}
        {item.crossRouteCount > 0 ? <span>{item.crossRouteCount} 条跨书路线</span> : null}
        {item.hasBookReview ? <span>书籍复盘</span> : null}
        {item.refreshState === "suggested" ? <span>建议更新：{refreshReasonLabel(item.refreshReason)}</span> : null}
        {item.updatedAt ? <small>更新：{formatAiTimestamp(item.updatedAt)}</small> : null}
      </div>
    </button>
  );
}

export function AIAssetDetailView({
  detail,
  isLoading,
  activeTab,
  onTabChange,
  onBack,
  onOpenVersion
}: {
  detail?: AIAssetDetail;
  isLoading: boolean;
  activeTab: AIAssetDetailTab;
  onTabChange: (tab: AIAssetDetailTab) => void;
  onBack: () => void;
  onOpenVersion: (version: AssetVersionRef) => void;
}) {
  const routeCount = (detail?.mainCrossRoutes.length ?? 0) + (detail?.participantCrossRoutes.length ?? 0);

  return (
    <section className="reading-hub-books ai-asset-detail" aria-label="书籍阅读资产详情">
      <div className="ai-asset-detail-hero">
        <button className="text-button" type="button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={16} />
          返回阅读指南库
        </button>
        <div>
          <p className="section-kicker">书籍资产</p>
          <h3>{detail?.title ?? "正在读取资产详情"}</h3>
          <p>
            {detail?.author || "未知作者"} ·{" "}
            {detail?.readingStageLabel ? `${detail.readingStageLabel}阶段` : "暂无阶段"} ·{" "}
            {typeof detail?.progress === "number" ? `进度 ${detail.progress}%` : "无进度缓存"}
          </p>
        </div>
        {detail?.refreshState === "suggested" ? (
          <div className="ai-asset-detail-refresh">
            <strong>建议更新</strong>
            <span>{refreshReasonLabel(detail.refreshReason)}</span>
            <p>生成新版本时会优先参考当前阶段、本地笔记变化和最近阅读状态，不会静默读取未缓存远端内容。</p>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <section className="book-detail-loading" aria-label="正在读取书籍资产详情">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取资产详情</h3>
            <p>只读取本地 AI 缓存引用，不触发生成。</p>
          </div>
        </section>
      ) : null}

      {!isLoading && !detail ? (
        <section className="empty-inline stats-empty" aria-label="没有书籍资产详情">
          <Database aria-hidden="true" size={28} />
          <h3>没有可展示的资产详情</h3>
          <p>当前书还没有本书指南、跨书路线或书籍复盘缓存。</p>
        </section>
      ) : null}

      {detail ? (
        <>
          <div className="ai-asset-detail-tabs" role="tablist" aria-label="资产详情分类">
            <AssetTabButton
              id="guide"
              label="阅读指南"
              count={detail.currentGuide ? 1 : 0}
              activeTab={activeTab}
              onTabChange={onTabChange}
            />
            <AssetTabButton
              id="routes"
              label="跨书路线"
              count={routeCount}
              activeTab={activeTab}
              onTabChange={onTabChange}
            />
            <AssetTabButton
              id="review"
              label="书籍复盘"
              count={detail.currentBookReview ? 1 : 0}
              activeTab={activeTab}
              onTabChange={onTabChange}
            />
          </div>

          {activeTab === "guide" ? (
            <AssetRefSection
              title="当前本书阅读指南"
              emptyTitle="还没有本书阅读指南"
              emptyCopy="从书籍详情点击“本书阅读指南”生成后，这里会显示当前有效引用。"
              refs={detail.currentGuide ? [detail.currentGuide] : []}
              bookTitle={detail.title}
              onOpenVersion={onOpenVersion}
              historyFeature={detail.currentGuide?.feature}
              historyScopeId={detail.currentGuide?.scopeId}
            />
          ) : null}

          {activeTab === "routes" ? (
            <section className="ai-asset-detail-section" aria-label="跨书路线资产">
              <AssetRefSection
                title="以本书为起点的跨书路线"
                emptyTitle="还没有主路线"
                emptyCopy="在本书阅读指南中加入候选书生成跨书路线后，这里会显示。"
                refs={detail.mainCrossRoutes}
                bookTitle={detail.title}
                onOpenVersion={onOpenVersion}
              />
              <AssetRefSection
                title="包含本书的其他路线"
                emptyTitle="还没有参与路线"
                emptyCopy="当其他书的跨书路线包含本书时，这里会显示引用。"
                refs={detail.participantCrossRoutes}
                bookTitle={detail.title}
                onOpenVersion={onOpenVersion}
              />
              {detail.mainCrossRoutes.length + detail.participantCrossRoutes.length > 0 ? (
                <section className="ai-asset-detail-section" aria-label="跨书路线历史">
                  <div className="reading-hub-section-heading">
                    <div>
                      <p className="section-kicker">历史版本</p>
                      <h3>跨书路线历史</h3>
                    </div>
                    <span>{detail.mainCrossRoutes.length + detail.participantCrossRoutes.length} 条</span>
                  </div>
                  <AssetVersionHistoryGroupList
                    refs={[...detail.mainCrossRoutes, ...detail.participantCrossRoutes]}
                    renderHistory={(ref) => (
                      <AssetVersionHistoryLoader
                        feature={ref.feature}
                        scopeId={ref.scopeId}
                        onOpenVersion={onOpenVersion}
                      />
                    )}
                  />
                </section>
              ) : null}
            </section>
          ) : null}

          {activeTab === "review" ? (
            <AssetRefSection
              title="当前书籍复盘"
              emptyTitle="还没有书籍复盘"
              emptyCopy="从单本笔记生成 AI 复盘后，这里会显示当前有效引用。"
              refs={detail.currentBookReview ? [detail.currentBookReview] : []}
              bookTitle={detail.title}
              onOpenVersion={onOpenVersion}
              historyFeature={detail.currentBookReview?.feature}
              historyScopeId={detail.currentBookReview?.scopeId}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function AssetTabButton({
  id,
  label,
  count,
  activeTab,
  onTabChange
}: {
  id: AIAssetDetailTab;
  label: string;
  count: number;
  activeTab: AIAssetDetailTab;
  onTabChange: (tab: AIAssetDetailTab) => void;
}) {
  const isActive = activeTab === id;

  return (
    <button
      type="button"
      className={isActive ? "is-active" : ""}
      onClick={() => onTabChange(id)}
      role="tab"
      aria-selected={isActive}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}

function AssetRefSection({
  title,
  emptyTitle,
  emptyCopy,
  refs,
  bookTitle,
  onOpenVersion,
  historyFeature,
  historyScopeId
}: {
  title: string;
  emptyTitle: string;
  emptyCopy: string;
  refs: AssetVersionRef[];
  bookTitle?: string;
  onOpenVersion: (version: AssetVersionRef) => void;
  historyFeature?: AssetVersionRef["feature"];
  historyScopeId?: string;
}) {
  return (
    <section className="ai-asset-detail-section" aria-label={title}>
      <div className="reading-hub-section-heading">
        <div>
          <p className="section-kicker">当前有效</p>
          <h3>{title}</h3>
        </div>
        <span>{refs.length} 条</span>
      </div>

      {refs.length > 0 ? (
        <div className="ai-asset-ref-grid">
          {refs.map((item) => (
            <article key={`${item.feature}-${item.scopeId}-${item.inputHash}`} className="ai-asset-ref-card">
              <div className="ai-asset-ref-card-heading">
                <div>
                  <p className="section-kicker">{assetFeatureLabel(item.feature)}</p>
                  <strong>{assetRefDisplayTitle(item, bookTitle)}</strong>
                </div>
                <div className="ai-asset-ref-heading-actions">
                  <span>{historySourceLabel(item.source)}</span>
                  <button className="secondary-action" type="button" onClick={() => onOpenVersion(item)}>
                    {assetRefActionLabel(item)}
                  </button>
                </div>
              </div>
              <div className="ai-asset-ref-status" aria-label="资产版本状态">
                <span>{formatAiTimestamp(item.generatedAt) || "未知生成时间"}</span>
                <span>{assetRefScopeLabel(item)}</span>
                {item.providerModel ? <span>{item.providerModel}</span> : null}
              </div>
              <p className="ai-asset-ref-technical">技术信息：Prompt {item.promptVersion}</p>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-inline stats-empty" aria-label={emptyTitle}>
          <Waypoints aria-hidden="true" size={28} />
          <h3>{emptyTitle}</h3>
          <p>{emptyCopy}</p>
        </section>
      )}

      {historyFeature && historyScopeId ? (
        <AssetVersionHistoryLoader
          feature={historyFeature}
          scopeId={historyScopeId}
          onOpenVersion={onOpenVersion}
        />
      ) : null}
    </section>
  );
}

function AssetVersionHistoryLoader({
  feature,
  scopeId,
  onOpenVersion
}: {
  feature: AssetVersionRef["feature"];
  scopeId: string;
  onOpenVersion: (version: AssetVersionRef) => void;
}) {
  const [versions, setVersions] = useState<AIAssetVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      setIsLoading(true);
      setError(undefined);

      try {
        const response = await getAIAssetVersionHistory({ feature, scopeId });
        if (isMounted) {
          setVersions(response);
        }
      } catch (loadError) {
        if (isMounted) {
          setVersions([]);
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, [feature, scopeId]);

  return (
    <AssetVersionHistorySection
      title="历史版本"
      versions={versions}
      error={error}
      isLoading={isLoading}
      onOpenVersion={(item) =>
        onOpenVersion({
          feature: item.feature,
          scopeId: item.scopeId,
          inputHash: item.inputHash,
          promptVersion: item.promptVersion,
          generatedAt: item.generatedAt,
          updatedAt: item.updatedAt,
          source: item.source,
          title: item.title,
          providerModel: item.providerModel
        })
      }
    />
  );
}

export function AssetVersionHistorySection({
  title,
  versions,
  isLoading = false,
  error,
  onOpenVersion
}: {
  title: string;
  versions: AIAssetVersionSummary[];
  isLoading?: boolean;
  error?: string;
  onOpenVersion: (version: AIAssetVersionSummary) => void;
}) {
  return (
    <details className="ai-asset-history">
      <summary>
        <span>历史版本</span>
        <small>{versions.length} 条</small>
      </summary>

      <div className="ai-asset-history-panel" aria-label={title}>
        {isLoading ? (
          <p className="ai-asset-history-empty">正在读取历史版本…</p>
        ) : null}

        {!isLoading && error ? (
          <p className="ai-asset-history-empty">读取历史版本失败：{error}</p>
        ) : null}

        {!isLoading && !error && versions.length === 0 ? (
          <p className="ai-asset-history-empty">暂无历史版本。只有生成过旧版本后，这里才会出现可回看的历史记录。</p>
        ) : null}

        {!isLoading && !error && versions.length > 0 ? (
          <div className="ai-asset-history-list">
            {versions.map((item) => (
              <article
                key={`${item.feature}-${item.scopeId}-${item.inputHash}`}
                className="ai-asset-history-row"
              >
                <div className="ai-asset-history-main">
                  <strong>{item.title || assetFeatureLabel(item.feature)}</strong>
                  <div className="ai-asset-history-meta">
                    <span>生成：{formatAiTimestamp(item.generatedAt) || "未知"}</span>
                    <span>阶段：{item.readingStageLabel || "未知阶段"}</span>
                    <span>{typeof item.progress === "number" ? `进度 ${item.progress}%` : "无进度缓存"}</span>
                    <span>触发：{refreshReasonLabel(item.refreshReason)}</span>
                    <span>Prompt：{item.promptVersion}</span>
                    <span>{historySourceLabel(item.source)}</span>
                    {item.previousVersion ? <span>上一版：{item.previousVersion.title || "未命名版本"}</span> : null}
                  </div>
                </div>
                <button className="secondary-action" type="button" onClick={() => onOpenVersion(item)}>
                  查看该版本
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function AssetVersionHistoryGroupList({
  refs,
  renderHistory
}: {
  refs: AssetVersionRef[];
  renderHistory: (ref: AssetVersionRef) => ReactNode;
}) {
  const uniqueRefs = refs.filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.feature === item.feature && candidate.scopeId === item.scopeId) ===
      index
  );

  return (
    <section className="ai-asset-history-group-list" aria-label="跨书路线分组">
      {uniqueRefs.map((item) => (
        <section
          key={`${item.feature}-${item.scopeId}`}
          className="ai-asset-history-group"
          aria-label={`${item.title || assetFeatureLabel(item.feature)} 路线分组`}
        >
          <div className="ai-asset-history-group-heading">
            <div>
              <p className="section-kicker">路线分组</p>
              <h4>{item.title || assetFeatureLabel(item.feature)}</h4>
            </div>
            <span>路线范围</span>
          </div>
          {renderHistory(item)}
        </section>
      ))}
    </section>
  );
}

export function AIAssetVersionDetailView({
  detail,
  previousDetail,
  isLoading,
  assetBook,
  onBack,
  onPrepareUpdate
}: {
  detail?: AIAssetVersionDetail;
  previousDetail?: AIAssetVersionDetail;
  isLoading: boolean;
  assetBook?: AIAssetDetail;
  onBack: () => void;
  onPrepareUpdate?: (detail: AIAssetVersionDetail, book: AIAssetDetail) => void;
}) {
  const route = detail?.readingRoute;
  const summary = detail?.bookSummary;
  const changeSummary = detail ? buildAssetVersionChangeSummary(detail, previousDetail) : undefined;
  const previousVersionRef = detail?.previousVersion;
  const [actionFeedbackByItemId, setActionFeedbackByItemId] = useState<AiActionFeedbackByItemId>(() =>
    detail ? readAIAssetVersionActionFeedback(detail, getAIAssetVersionActionTexts(detail)) : {}
  );
  const [reviewFeedback, setReviewFeedback] = useState<AiReviewFeedbackState>(() =>
    detail?.feature === "book-review"
      ? readAiReviewFeedback(getAiActionItemStorage(), detail.scopeId, detail.inputHash)
      : createEmptyReviewFeedback()
  );
  const actionItemIds = detail ? getAIAssetVersionActionTexts(detail).map((item, index) => buildAiActionItemId(item, index)) : [];
  const displayedActionFeedback =
    detail?.feature === "book-review" ? reviewFeedback.actionItems : actionFeedbackByItemId;
  const actionFeedbackSummary = detail ? summarizeAiActionFeedback(actionItemIds, displayedActionFeedback) : undefined;
  const updateContextItems = detail ? buildRegenerationReviewItems(detail, previousDetail, actionFeedbackSummary) : [];
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (!detail) {
      setActionFeedbackByItemId({});
      setReviewFeedback(createEmptyReviewFeedback());
      return () => {
        isMounted = false;
      };
    }

    setActionFeedbackByItemId(readAIAssetVersionActionFeedback(detail, getAIAssetVersionActionTexts(detail)));
    if (detail.feature !== "book-review") {
      setReviewFeedback(createEmptyReviewFeedback());
      return () => {
        isMounted = false;
      };
    }

    const legacy = readAiReviewFeedback(getAiActionItemStorage(), detail.scopeId, detail.inputHash);
    setReviewFeedback(legacy);

    async function loadReviewFeedback() {
      if (!detail || detail.feature !== "book-review") {
        return;
      }

      try {
        const stored = await getAiReviewFeedback({
          feature: "book-review",
          scopeId: detail.scopeId,
          inputHash: detail.inputHash
        });
        if (!isMounted) {
          return;
        }

        if (hasAiReviewFeedback(stored)) {
          setReviewFeedback(stored);
          return;
        }

        if (hasAiReviewFeedback(legacy)) {
          void saveBookReviewFeedbackState(detail.scopeId, detail.inputHash, legacy);
        }
      } catch {
        if (isMounted) {
          setReviewFeedback(legacy);
        }
      }
    }

    void loadReviewFeedback();

    return () => {
      isMounted = false;
    };
  }, [detail]);

  function handleBookReviewActionFeedbackChange(itemId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!detail || detail.feature !== "book-review") {
      return;
    }

    setReviewFeedback((current) => {
      const next = {
        ...current,
        actionItems: updateFeedbackById(current.actionItems, itemId, feedback)
      };

      void persistBookReviewFeedbackState(detail.scopeId, detail.inputHash, next);
      return next;
    });
  }

  function handleBookReviewReflectionFeedbackChange(questionId: string, feedback: AiActionFeedbackRecord | undefined) {
    if (!detail || detail.feature !== "book-review") {
      return;
    }

    setReviewFeedback((current) => {
      const next = {
        ...current,
        reflectionQuestions: updateFeedbackById(current.reflectionQuestions, questionId, feedback)
      };

      void persistBookReviewFeedbackState(detail.scopeId, detail.inputHash, next);
      return next;
    });
  }

  return (
    <section className="reading-hub-books ai-asset-detail" aria-label="AI 资产版本详情">
      <div className="ai-asset-detail-hero">
        <button className="text-button" type="button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={16} />
          返回书籍资产详情
        </button>
        <div>
          <p className="section-kicker">资产版本</p>
          <h3>{detail ? assetVersionStableTitle(detail, assetBook) : "正在读取完整内容"}</h3>
          <p>
            {detail ? assetFeatureLabel(detail.feature) : "AI 资产"} ·{" "}
            {detail?.readingStageLabel ? `${detail.readingStageLabel}阶段` : "暂无阶段"} ·{" "}
            {typeof detail?.progress === "number" ? `进度 ${detail.progress}%` : "无进度缓存"}
          </p>
          {previousVersionRef ? (
            <p className="ai-asset-version-previous">
              上一版：{previousVersionRef.title || "未命名版本"} · {formatAiTimestamp(previousVersionRef.generatedAt) || "未知时间"}
            </p>
          ) : null}
          {detail ? (
            <section className="ai-asset-version-context" aria-label="更新依据">
              <h4>更新依据</h4>
              <ul>
                {updateContextItems.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {detail ? (
          <div className="ai-asset-detail-refresh">
            <strong>{formatAiTimestamp(detail.generatedAt) || "未知时间"}</strong>
            <span>{detail.promptVersion}</span>
            <p>{detail.basisNotice}</p>
          </div>
        ) : null}
        {detail ? (
          <div className="ai-asset-detail-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => setIsUpdateDialogOpen(true)}
              disabled={!assetBook || !onPrepareUpdate}
            >
              {detail.feature === "book-review" ? "准备更新复盘" : "准备更新指南"}
            </button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <section className="book-detail-loading" aria-label="正在读取 AI 资产版本详情">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取完整版本内容</h3>
            <p>只读取当前缓存版本，不触发重新生成。</p>
          </div>
        </section>
      ) : null}

      {!isLoading && !detail ? (
        <section className="empty-inline stats-empty" aria-label="没有版本详情">
          <Database aria-hidden="true" size={28} />
          <h3>没有可展示的版本详情</h3>
          <p>当前版本缓存不存在或已失效。</p>
        </section>
      ) : null}

      {!isLoading && detail ? (
        <>
          {route ? (
            <ReadingRouteResultPanel
              route={route}
              routeResponse={{
                bookId: route.books[0]?.bookId ?? detail.scopeId,
                scopeId: detail.scopeId,
                promptVersion: detail.promptVersion,
                inputHash: detail.inputHash,
                providerModel: detail.providerModel,
                source: detail.source,
                route,
                cachedUpdatedAt: detail.updatedAt
              }}
              currentBook={
                route.books[0]
                  ? {
                      bookId: route.books[0].bookId,
                      title: route.books[0].title,
                      author: route.books[0].author
                    }
                  : undefined
              }
              isCrossBookRoute={detail.scopeId.includes(":candidates:")}
              resultTitle={assetVersionStableTitle(detail, assetBook)}
            />
          ) : null}

          {summary ? (
            <BookReviewVersionContent
              summary={summary}
              providerModel={detail.providerModel}
              updatedAt={detail.updatedAt}
              actionFeedbackByItemId={reviewFeedback.actionItems}
              onActionFeedbackChange={handleBookReviewActionFeedbackChange}
              reflectionFeedbackByQuestionId={reviewFeedback.reflectionQuestions}
              onReflectionFeedbackChange={handleBookReviewReflectionFeedbackChange}
            />
          ) : null}

          {isUpdateDialogOpen ? (
            <AIAssetUpdateDialog
              detail={detail}
              previousDetail={previousDetail}
              summary={actionFeedbackSummary}
              changeSummary={changeSummary}
              assetBook={assetBook}
              onClose={() => setIsUpdateDialogOpen(false)}
              onPrepareUpdate={onPrepareUpdate}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );

  async function persistBookReviewFeedbackState(
    scopeId: string,
    inputHash: string,
    feedback: AiReviewFeedbackState
  ) {
    writeAiReviewFeedback(getAiActionItemStorage(), scopeId, inputHash, feedback);
    await saveBookReviewFeedbackState(scopeId, inputHash, feedback);
  }
}

function AIAssetUpdateDialog({
  detail,
  previousDetail,
  summary,
  changeSummary,
  assetBook,
  onClose,
  onPrepareUpdate
}: {
  detail: AIAssetVersionDetail;
  previousDetail?: AIAssetVersionDetail;
  summary?: AiActionFeedbackSummary;
  changeSummary?: ReturnType<typeof buildAssetVersionChangeSummary>;
  assetBook?: AIAssetDetail;
  onClose: () => void;
  onPrepareUpdate?: (detail: AIAssetVersionDetail, book: AIAssetDetail) => void;
}) {
  const label = detail.feature === "book-review" ? "准备更新书籍复盘" : "准备更新阅读指南";
  const target = detail.feature === "book-review" ? "单本 AI 复盘页" : "本书阅读指南页";
  const canPrepare = Boolean(assetBook && onPrepareUpdate);
  const checklist = buildRegenerationReviewItems(detail, previousDetail, summary);
  const hasFeedback = Boolean(summary && (summary.completed > 0 || summary.skipped > 0 || summary.notApplicable > 0 || summary.withNote > 0));

  return (
    <div className="ai-asset-update-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="ai-asset-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="更新前确认"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ai-asset-update-dialog-heading">
          <div>
            <p className="section-kicker">更新前确认</p>
            <h3>{label}</h3>
            <p>进入{target}后会带上当前书和上一版上下文提示，但仍需要你手动点击生成按钮才会调用 AI。</p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭更新前确认">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="ai-asset-update-dialog-body">
          <section className="ai-asset-update-source" aria-label="来源版本">
            <strong>{assetVersionStableTitle(detail, assetBook)}</strong>
            <span>{formatAiTimestamp(detail.generatedAt) || "未知时间"} · {detail.promptVersion}</span>
            {detail.previousVersion ? (
              <small>
                上一版：{detail.previousVersion.title || "未命名版本"} · {formatAiTimestamp(detail.previousVersion.generatedAt) || "未知时间"}
              </small>
            ) : null}
          </section>

          <section className="ai-asset-update-section" aria-label="更新前核对">
            <h4>重新生成前应核对</h4>
            <ul className="ai-asset-regeneration-checklist">
              {checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="ai-asset-update-section" aria-label="行动反馈摘要">
            <h4>行动反馈摘要</h4>
            {hasFeedback ? (
              <dl className="ai-asset-update-feedback-grid">
                <div>
                  <dt>已完成</dt>
                  <dd>{summary?.completed ?? 0}</dd>
                </div>
                <div>
                  <dt>暂不做</dt>
                  <dd>{summary?.skipped ?? 0}</dd>
                </div>
                <div>
                  <dt>不适合</dt>
                  <dd>{summary?.notApplicable ?? 0}</dd>
                </div>
                <div>
                  <dt>反馈记录</dt>
                  <dd>{summary?.withNote ?? 0}</dd>
                </div>
              </dl>
            ) : (
              <p className="ai-asset-update-muted">暂无行动反馈记录。</p>
            )}
          </section>

          {changeSummary ? (
            <section className="ai-asset-update-section" aria-label={changeSummary.title}>
              <h4>{changeSummary.title}</h4>
              <ul className="ai-asset-regeneration-checklist">
                {changeSummary.items.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="ai-asset-update-boundary" aria-label="更新边界">
            <strong>边界</strong>
            <p>不会在这里静默读取未缓存远端笔记，也不会自动发送完整反馈明细。跳转后仍需手动确认生成。</p>
          </section>
        </div>

        <div className="ai-asset-update-dialog-actions">
          <button className="text-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!canPrepare}
            onClick={() => {
              if (assetBook && onPrepareUpdate) {
                onPrepareUpdate(detail, assetBook);
              }
            }}
          >
            进入生成页确认更新
          </button>
        </div>
      </section>
    </div>
  );
}

function buildRegenerationReviewItems(
  detail: AIAssetVersionDetail,
  previousDetail: AIAssetVersionDetail | undefined,
  summary?: AiActionFeedbackSummary
): string[] {
  const items = [
    detail.readingStageLabel ? `当前阅读阶段：${detail.readingStageLabel}` : "当前阅读阶段：暂无阶段缓存",
    typeof detail.progress === "number" ? `当前阅读进度：${detail.progress}%` : "当前阅读进度：暂无进度缓存",
    `刷新原因：${refreshReasonLabel(detail.refreshReason)}`,
    previousDetail
      ? `上一版：${formatAiTimestamp(previousDetail.generatedAt) || "未知时间"} · ${previousDetail.promptVersion}`
      : "上一版：暂无可对比版本",
    `行动反馈摘要：已完成 ${summary?.completed ?? 0}，暂不做 ${summary?.skipped ?? 0}，不适合 ${summary?.notApplicable ?? 0}，有记录 ${summary?.withNote ?? 0}`
  ];

  if (detail.feature === "book-review") {
    items.push("复盘更新前应额外核对：关键观点、行动与复盘问题是否仍贴合当前笔记。");
  } else {
    items.push("指南更新前应额外核对：推进任务、复盘点和下一步行动是否仍贴合当前阅读阶段。");
  }

  return items;
}

function BookReviewVersionContent({
  summary,
  providerModel,
  updatedAt,
  actionFeedbackByItemId,
  onActionFeedbackChange,
  reflectionFeedbackByQuestionId,
  onReflectionFeedbackChange
}: {
  summary: NonNullable<AIAssetVersionDetail["bookSummary"]>;
  providerModel?: string;
  updatedAt?: string;
  actionFeedbackByItemId: AiActionFeedbackByItemId;
  onActionFeedbackChange: (itemId: string, feedback: AiActionFeedbackRecord | undefined) => void;
  reflectionFeedbackByQuestionId: AiActionFeedbackByItemId;
  onReflectionFeedbackChange: (questionId: string, feedback: AiActionFeedbackRecord | undefined) => void;
}) {
  return (
    <div className="ai-summary-content ai-asset-version-review">
      <section className="ai-summary-overview" aria-label="AI 复盘概览">
        <Database aria-hidden="true" size={20} />
        <div>
          <h4>概览</h4>
          <p>{summary.overview}</p>
          <small>{summary.basisNotice}</small>
        </div>
      </section>

      <section className="ai-summary-section" aria-label="主题标签">
        <h4>主题标签</h4>
        <div className="ai-summary-tags">
          {summary.themeTags.length > 0 ? (
            summary.themeTags.map((tag) => <span key={tag}>{tag}</span>)
          ) : (
            <p>这次复盘没有提取到主题标签。</p>
          )}
        </div>
      </section>

      <div className="ai-summary-grid">
        <StaticSummaryList title="关键观点" items={summary.keyIdeas} emptyText="这次复盘没有提取到关键观点。" />
        <StaticSummaryList title="我的关注点" items={summary.myFocus} emptyText="这次复盘没有形成稳定关注点。" />
        <AiActionFeedbackChecklist
          title="行动与复盘"
          ariaLabel="行动与复盘"
          icon={<ListChecks aria-hidden="true" size={18} />}
          items={summary.actionItems.map((item, index) => ({
            id: buildAiActionItemId(item, index),
            text: item
          }))}
          emptyText="这次复盘没有生成行动项。"
          feedbackByItemId={actionFeedbackByItemId}
          onFeedbackChange={onActionFeedbackChange}
        />
      </div>

      <section className="ai-summary-section" aria-label="代表性摘录">
        <h4>代表性摘录</h4>
        <div className="ai-quote-grid">
          {summary.representativeQuotes.length > 0 ? (
            summary.representativeQuotes.map((item) => (
              <article key={`${item.quote}-${item.reason}`} className="ai-quote-card">
                <blockquote>{item.quote}</blockquote>
                <p>{item.reason}</p>
                <small>
                  {item.noteType}
                  {item.chapter ? ` · ${item.chapter}` : ""}
                </small>
              </article>
            ))
          ) : (
            <p>这次复盘没有返回代表性摘录。</p>
          )}
        </div>
      </section>

      <AiActionFeedbackChecklist
        title="复盘问题"
        ariaLabel="复盘问题"
        icon={<Sparkles aria-hidden="true" size={18} />}
        items={summary.reflectionQuestions.map((item, index) => ({
          id: buildAiReflectionQuestionId(item, index),
          text: item
        }))}
        emptyText="这次复盘没有生成复盘问题。"
        feedbackByItemId={reflectionFeedbackByQuestionId}
        onFeedbackChange={onReflectionFeedbackChange}
        labels={reflectionFeedbackLabels}
      />

      <section className="ai-summary-source-card" aria-label="AI 复盘来源统计">
        <div>
          <strong>来源统计</strong>
          <small>仅展示当前版本缓存记录里的统计信息。</small>
        </div>
        <div className="ai-summary-stats">
          <SummaryStat label="划线" value={summary.sourceStats.highlightCount} />
          <SummaryStat label="想法" value={summary.sourceStats.thoughtCount} />
          <SummaryStat label="书签" value={summary.sourceStats.bookmarkCount} />
          <SummaryStat label="章节" value={summary.sourceStats.chapterCount} />
          <SummaryStat label="纳入划线" value={summary.sourceStats.includedHighlightCount} />
          <SummaryStat label="纳入想法" value={summary.sourceStats.includedThoughtCount} />
        </div>
      </section>

      <div className="ai-summary-meta">
        <span>生成时间：{formatAiTimestamp(summary.generatedAt) || "尚未生成"}</span>
        <span>Prompt：{summary.promptVersion}</span>
        {providerModel ? <span>模型：{providerModel}</span> : null}
        {updatedAt ? <span>缓存更新：{formatAiTimestamp(updatedAt)}</span> : null}
      </div>
    </div>
  );
}

function readAIAssetVersionActionFeedback(
  detail: AIAssetVersionDetail,
  itemTexts: string[]
): AiActionFeedbackByItemId {
  if (detail.feature === "book-review") {
    return readAiReviewFeedback(getAiActionItemStorage(), detail.scopeId, detail.inputHash).actionItems;
  }

  const reusableFeedback = readAiAssetActionItemFeedback(
    getAiActionItemStorage(),
    detail.feature,
    detail.scopeId,
    detail.inputHash
  );

  return deriveAiAssetActionItemFeedback(itemTexts, reusableFeedback);
}

async function saveBookReviewFeedbackState(
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
    // 后端不可用时 localStorage 仍作为兜底，避免用户刚输入的反馈丢失。
  }
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

function getAIAssetVersionActionTexts(detail: AIAssetVersionDetail): string[] {
  if (detail.bookSummary) {
    return detail.bookSummary.actionItems;
  }

  if (!detail.readingRoute) {
    return [];
  }

  return buildGuideDetailSections(detail.readingRoute, detail.scopeId.includes(":candidates:")).actions.map(buildGuideActionText);
}

function StaticSummaryList({
  title,
  items,
  emptyText
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <section className="ai-summary-list" aria-label={title}>
      <div className="ai-summary-list-heading">
        <h4>{title}</h4>
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

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}

function assetFeatureLabel(feature: AssetVersionRef["feature"]): string {
  return feature === "book-review" ? "书籍复盘" : "阅读指南";
}

function assetRefDisplayTitle(item: AssetVersionRef, bookTitle?: string): string {
  const normalizedBookTitle = bookTitle?.trim();
  const titlePrefix = normalizedBookTitle ? `《${normalizedBookTitle}》` : "";

  if (item.feature === "book-review") {
    return `${titlePrefix}书籍复盘`;
  }

  return item.scopeId.includes(":candidates:")
    ? `${titlePrefix}跨书阅读路线`
    : `${titlePrefix}阅读指南`;
}

function assetRefActionLabel(item: AssetVersionRef): string {
  if (item.feature === "book-review") {
    return "查看复盘";
  }

  return item.scopeId.includes(":candidates:") ? "查看路线" : "查看指南";
}

function assetRefScopeLabel(item: AssetVersionRef): string {
  if (item.feature === "book-review") {
    return "单本复盘";
  }

  return item.scopeId.includes(":candidates:") ? "跨书路线" : "本书指南";
}

function assetVersionStableTitle(detail: AIAssetVersionDetail, assetBook?: AIAssetDetail): string {
  const bookTitle = assetBook?.title?.trim();

  if (detail.feature === "book-review") {
    return bookTitle ? `《${bookTitle}》书籍复盘` : "当前书籍复盘";
  }

  if (detail.scopeId.includes(":candidates:")) {
    return "跨书阅读路线";
  }

  return bookTitle ? `《${bookTitle}》阅读指南` : "当前本书阅读指南";
}

function getLatestSummaryTime(items: BookAiSummaryListItem[]): string | undefined {
  const sortedTimes = items
    .map((item) => Number(item.cachedUpdatedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left);

  return sortedTimes.length > 0 ? String(sortedTimes[0]) : undefined;
}

function getLatestAssetTime(items: AIAssetSummary[]): string | undefined {
  const sortedTimes = items
    .map((item) => Number(item.updatedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left);

  return sortedTimes.length > 0 ? String(sortedTimes[0]) : undefined;
}

function refreshReasonLabel(reason: AIAssetSummary["refreshReason"]): string {
  switch (reason) {
    case "completed":
      return "已读完";
    case "notes_changed":
      return "笔记变化";
    case "stalled":
      return "停滞较久";
    case "stage_changed":
      return "阅读阶段变化";
    default:
      return "无需更新";
  }
}

function historySourceLabel(source: AIAssetVersionSummary["source"]): string {
  switch (source) {
    case "generated":
      return "本次生成";
    case "staleCache":
      return "旧缓存";
    case "empty":
      return "空结果";
    case "cache":
    default:
      return "本地缓存";
  }
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

      return (right.readingProgress ?? 0) - (left.readingProgress ?? 0);
    })
    .slice(0, 3);
}
