import { startTransition, useDeferredValue, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Compass,
  Loader2,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import { useToast } from "../components/ToastProvider";
import {
  getCommandErrorMessage,
  getLatestBookDecision,
  listReadingItemStates,
  removeReadingItemState,
  searchBooks,
  summarizeBookDecision,
  upsertReadingItemState,
  type BookshelfResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import { dedupeRecommendedBookSearchResults } from "../lib/reading-assistant-recommendations";
import type {
  BookDecisionGoal,
  CredentialStatus,
  ReadingStatsMode,
  SearchResult
} from "../lib/types";
import {
  buildBookDecisionCandidates,
  buildCandidateConfirmationSearchKeyword,
  buildCandidateFilteredEmptyState,
  buildCandidateMap,
  buildCandidateSourceStats,
  canOpenCandidateDetail,
  filterCandidatesBySource,
  getCandidateSourceLabel,
  getCandidateSourceTone,
  isUnconfirmedAiCandidate,
  isSavedCandidateState,
  resolveCandidateReplacement,
  type CandidateSourceFilter,
  type LocalCandidateBook
} from "./candidate-books";
import {
  getRecentReadingContext,
  type RecentReadingWindowMode
} from "./book-decision-context";
import {
  getBookDecisionDraftStorage,
  readBookDecisionDraft,
  writeBookDecisionDraft
} from "./book-decision-draft";
import { BookDecisionInputDialog } from "./BookDecisionInputDialog";
import {
  maxDecisionCandidates,
  referenceFactorIds,
  type BookDecisionSession,
  type ReferenceFactor
} from "./book-decision-input-model";
import { type ReadingStatsCache } from "./reading-stats-period";

type CandidateBookshelfPageProps = {
  credentialStatus?: CredentialStatus;
  bookshelf?: BookshelfResponse;
  readingStatsCache: ReadingStatsCache;
  refreshKey?: number;
  onOpenSettings: () => void;
  onOpenDiscovery: () => void;
  onOpenBookDetail: (book: SearchResult) => void;
  onBookDecisionGenerated: (session: BookDecisionSession) => void;
};

type CandidateConfirmationSearchStatus = "idle" | "searching" | "found" | "notFound" | "failed";

type CandidateConfirmationSearchState = {
  status: CandidateConfirmationSearchStatus;
  results: SearchResult[];
  errorMessage?: string;
};

export function CandidateBookshelfPage({
  credentialStatus,
  bookshelf,
  readingStatsCache = {},
  refreshKey = 0,
  onOpenSettings,
  onOpenDiscovery,
  onOpenBookDetail,
  onBookDecisionGenerated
}: CandidateBookshelfPageProps) {
  const [candidateMap, setCandidateMap] = useState<Map<string, LocalCandidateBook>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [confirmingResultIds, setConfirmingResultIds] = useState<Set<string>>(() => new Set());
  const [candidateConfirmationSearchStates, setCandidateConfirmationSearchStates] = useState<
    Record<string, CandidateConfirmationSearchState>
  >({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedFactorIds, setSelectedFactorIds] = useState<Set<ReferenceFactor>>(() => new Set());
  const [candidateLimitMessage, setCandidateLimitMessage] = useState<string>();
  const [decisionGoal, setDecisionGoal] = useState<BookDecisionGoal>("轻松读");
  const [recentReadingWindowMode, setRecentReadingWindowMode] =
    useState<RecentReadingWindowMode>("auto");
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [query, setQuery] = useState("");
  const [candidateSourceFilter, setCandidateSourceFilter] =
    useState<CandidateSourceFilter>("all");
  const [openActionMenuBookId, setOpenActionMenuBookId] = useState<string>();
  const [error, setError] = useState<string>();
  const deferredQuery = useDeferredValue(query);
  const { showToast } = useToast();
  const candidateBooks = [...candidateMap.values()].sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN"));
  const candidateSourceStats = buildCandidateSourceStats(candidateBooks);
  const sourceFilteredBooks = filterCandidatesBySource(candidateBooks, candidateSourceFilter);
  const visibleBooks = filterCandidateBooks(sourceFilteredBooks, deferredQuery);
  const filteredEmptyState = buildCandidateFilteredEmptyState({
    query: deferredQuery,
    sourceFilter: candidateSourceFilter,
    sourceFilteredCount: sourceFilteredBooks.length,
    visibleCount: visibleBooks.length
  });
  const hasWechatCredential = credentialStatus?.hasCredential === true;
  const selectedCandidateBooks = candidateBooks.filter((book) => selectedIds.has(book.bookId));
  const decisionCandidates = buildBookDecisionCandidates(selectedCandidateBooks);
  const hasStatsSignal = Object.values(readingStatsCache).some(Boolean);
  const recentReadingContext = getRecentReadingContext(
    bookshelf?.snapshot.entries ?? [],
    undefined,
    recentReadingWindowMode
  );

  useEffect(() => {
    let isMounted = true;

    async function loadCandidates() {
      setIsLoading(true);
      setError(undefined);

      try {
        const states = await listReadingItemStates();
        if (isMounted) {
          const candidates = buildCandidateMap(states.filter(isSavedCandidateState));
          const draft = readBookDecisionDraft(getBookDecisionDraftStorage());
          const availableIds = new Set(candidates.keys());

          setCandidateMap(candidates);
          setSelectedIds(
            new Set(
              draft?.selectedIds
                .filter((bookId) => availableIds.has(bookId))
                .slice(0, maxDecisionCandidates) ?? []
            )
          );

          if (draft) {
            setDecisionGoal(draft.decisionGoal);
            setRecentReadingWindowMode(draft.recentReadingWindowMode);
            setSelectedFactorIds(
              new Set(
                draft.selectedFactorIds.filter((factorId): factorId is ReferenceFactor =>
                  referenceFactorIds.includes(factorId as ReferenceFactor)
                )
              )
            );
          }
        }
      } catch (candidateError) {
        if (isMounted) {
          setError(getCommandErrorMessage(candidateError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCandidates();

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

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
    if (!openActionMenuBookId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenActionMenuBookId(undefined);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-candidate-card-menu-root]")) {
        return;
      }

      setOpenActionMenuBookId(undefined);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openActionMenuBookId]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    writeBookDecisionDraft(getBookDecisionDraftStorage(), {
      selectedIds: Array.from(selectedIds),
      selectedFactorIds: Array.from(selectedFactorIds),
      decisionGoal,
      recentReadingWindowMode
    });
  }, [decisionGoal, isLoading, recentReadingWindowMode, selectedFactorIds, selectedIds]);

  async function handleRemoveCandidate(book: LocalCandidateBook) {
    setRemovingIds((current) => new Set(current).add(book.bookId));
    setError(undefined);

    try {
      await removeReadingItemState(book.bookId);
      startTransition(() => {
        setCandidateMap((current) => {
          const next = new Map(current);
          next.delete(book.bookId);
          return next;
        });
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(book.bookId);
          return next;
        });
      });
      showToast({ message: `已从候选书架移除《${book.title}》`, tone: "success" });
    } catch (removeError) {
      const message = getCommandErrorMessage(removeError);
      setError(message);
      showToast({ message, tone: "error" });
    } finally {
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(book.bookId);
        return next;
      });
    }
  }

  function handleToggleCandidateActionMenu(bookId: string) {
    setOpenActionMenuBookId((current) => (current === bookId ? undefined : bookId));
  }

  function handleRemoveCandidateFromMenu(book: LocalCandidateBook) {
    setOpenActionMenuBookId(undefined);
    void handleRemoveCandidate(book);
  }

  async function handleSearchCandidateConfirmation(book: LocalCandidateBook) {
    const keyword = buildCandidateConfirmationSearchKeyword(book);
    if (!keyword) {
      setCandidateConfirmationSearchStates((current) => ({
        ...current,
        [book.bookId]: {
          status: "failed",
          results: [],
          errorMessage: "缺少可搜索的书名。"
        }
      }));
      return;
    }

    setCandidateConfirmationSearchStates((current) => ({
      ...current,
      [book.bookId]: { status: "searching", results: [] }
    }));
    setError(undefined);

    try {
      const response = await searchBooks({ keyword, scope: 0, count: 5 });
      const results = dedupeRecommendedBookSearchResults(response.result.results, 5);
      setCandidateConfirmationSearchStates((current) => ({
        ...current,
        [book.bookId]: {
          status: results.length > 0 ? "found" : "notFound",
          results
        }
      }));
    } catch (searchError) {
      setCandidateConfirmationSearchStates((current) => ({
        ...current,
        [book.bookId]: {
          status: "failed",
          results: [],
          errorMessage: getCommandErrorMessage(searchError)
        }
      }));
    }
  }

  async function handleConfirmCandidateSearchResult(
    book: LocalCandidateBook,
    result: SearchResult
  ) {
    const resultKey = confirmationResultKey(book.bookId, result.bookId);
    setConfirmingResultIds((current) => new Set(current).add(resultKey));
    setError(undefined);

    try {
      const states = await listReadingItemStates();
      const existingState = states.find((state) => state.itemId.trim() === result.bookId.trim());
      const replacementResolution = resolveCandidateReplacement(book, result, existingState);
      if (replacementResolution.status === "blocked") {
        const message = `《${result.title}》已存在本地阅读状态，未替换候选。`;
        setError(message);
        showToast({ message, tone: "error" });
        return;
      }

      const confirmed =
        typeof window === "undefined" ||
        window.confirm(
          `替换未确认候选？\n\n将《${book.title}》替换为微信读书搜索结果《${result.title}》。\n这只更新本地候选，不会写入微信读书远端书架。`
        );
      if (!confirmed) {
        return;
      }

      const replacement = replacementResolution.replacement;

      if (replacementResolution.status === "create") {
        await upsertReadingItemState({
          itemId: result.bookId,
          itemType: "candidate",
          status: "toRead",
          title: result.title,
          author: result.author,
          cover: result.cover,
          category: result.category,
          note: replacement.localNote
        });
      }

      await removeReadingItemState(book.bookId);

      startTransition(() => {
        setCandidateMap((current) => {
          const next = new Map(current);
          next.delete(book.bookId);
          next.set(replacement.bookId, replacement);
          return next;
        });
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.delete(book.bookId)) {
            next.add(replacement.bookId);
          }
          return next;
        });
        setCandidateConfirmationSearchStates((current) => {
          const next = { ...current };
          delete next[book.bookId];
          return next;
        });
      });
      showToast({ message: `已确认《${replacement.title}》为微信读书候选`, tone: "success" });
    } catch (confirmError) {
      const message = getCommandErrorMessage(confirmError);
      setError(message);
      showToast({ message, tone: "error" });
    } finally {
      setConfirmingResultIds((current) => {
        const next = new Set(current);
        next.delete(resultKey);
        return next;
      });
    }
  }

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

  function handleOpenDecisionDialog() {
    setError(undefined);
    setCandidateLimitMessage(undefined);
    setIsInputDialogOpen(true);
  }

  async function handleGenerateDecision() {
    if (decisionCandidates.length === 0) {
      setError("请至少选择 1 本候选书，再生成选书决策。");
      return;
    }

    setIsGenerating(true);
    setError(undefined);

    try {
      const cached = await getLatestBookDecision(decisionCandidates, decisionGoal);
      const response =
        cached ??
        (await summarizeBookDecision({
          candidates: decisionCandidates,
          goal: decisionGoal,
          regenerate: true
        }));

      setIsInputDialogOpen(false);
      onBookDecisionGenerated({
        response,
        candidateBooks,
        selectedIds: Array.from(selectedIds),
        selectedFactorIds: Array.from(selectedFactorIds),
        decisionGoal,
        recentReadingWindowMode
      });
    } catch (generateError) {
      const message = getCommandErrorMessage(generateError);
      setError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsGenerating(false);
    }
  }

  function renderCandidateConfirmationSearchResults(
    book: LocalCandidateBook,
    searchState: CandidateConfirmationSearchState
  ) {
    if (searchState.status === "idle" || searchState.status === "searching") {
      return null;
    }

    if (searchState.status === "notFound") {
      return <p className="candidate-confirmation-status">没有找到明确匹配项，可以保留为未确认候选。</p>;
    }

    if (searchState.status === "failed") {
      return (
        <p className="candidate-confirmation-status is-error">
          {searchState.errorMessage || "搜索失败，可重试。"}
        </p>
      );
    }

    return (
      <div className="candidate-confirmation-results">
        <span className="candidate-confirmation-results-title">选择微信读书匹配项</span>
        {searchState.results.map((result) => {
          const resultKey = confirmationResultKey(book.bookId, result.bookId);
          const isConfirming = confirmingResultIds.has(resultKey);
          return (
            <div className="candidate-confirmation-result" key={result.bookId}>
              {result.cover ? (
                <img src={result.cover} alt="" loading="lazy" />
              ) : (
                <span className="candidate-confirmation-cover" aria-hidden="true" />
              )}
              <span>
                <strong>{result.title}</strong>
                <small>{[result.author, result.category].filter(Boolean).join(" · ")}</small>
              </span>
              <button
                className="text-button"
                type="button"
                disabled={isConfirming}
                onClick={() => void handleConfirmCandidateSearchResult(book, result)}
              >
                {isConfirming ? (
                  <Loader2 aria-hidden="true" size={14} className="spin" />
                ) : (
                  <Check aria-hidden="true" size={14} />
                )}
                {isConfirming ? "确认中" : "确认替换"}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="candidate-bookshelf-page" aria-label="候选书架">
      <div className="bookshelf-toolbar candidate-bookshelf-hero">
        <div>
          <p className="section-kicker">本地候选</p>
          <h3>候选书架管理</h3>
          <p aria-label="候选书架说明">这里管理从发现页保存的候选书，只保存在本机，不写回微信读书。</p>
        </div>
        <button className="secondary-action" type="button" onClick={onOpenDiscovery}>
          <Compass aria-hidden="true" size={18} />
          去发现页保存候选
        </button>
      </div>

      <section className="shelf-summary-row" aria-label="候选书架统计">
        <SummaryPill label="候选书" value={candidateBooks.length} />
        <SummaryPill label="已确认" value={candidateSourceStats.confirmed} />
        <SummaryPill label="待确认" value={candidateSourceStats.unconfirmed} />
        <SummaryPill label="本地保存" value="不写回" />
      </section>

      {!hasWechatCredential ? (
        <CredentialSetupCard
          title="先保存微信读书 API Key"
          description="候选书架读取本地状态；发现页保存候选前仍需要先连接微信读书。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="shelf-loading" aria-label="正在读取候选书架">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : null}

      {!isLoading && candidateBooks.length === 0 ? (
        <section className="empty-inline" aria-label="候选书架为空">
          <BookOpen aria-hidden="true" size={28} />
          <h3>还没有候选书</h3>
          <p>选书决策需要先保存至少 1 本候选。先在发现页搜索、推荐或相似探索里保存候选，再回到这里做取舍。</p>
          <button className="secondary-action" type="button" onClick={onOpenDiscovery}>
            去发现页保存候选
          </button>
        </section>
      ) : null}

      {!isLoading && candidateBooks.length > 0 ? (
        <>
          <section className="candidate-decision-entry" aria-label="候选书架决策入口">
            <div>
              <p className="section-kicker">选书决策</p>
              <h3>把候选池推进到下一步行动</h3>
              <p>从这里确认本地候选、目标和参考因子，生成“下一本读什么、为什么暂缓其他书、接下来怎么读”的决策记录。</p>
            </div>
            <button className="secondary-action" type="button" onClick={handleOpenDecisionDialog}>
              {isGenerating ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <Sparkles aria-hidden="true" size={18} />}
              推荐下一本
            </button>
          </section>

          <section className="candidate-bookshelf-list-panel" aria-label="候选书架条目">
            <div className="candidate-bookshelf-section-heading">
              <div>
                <p className="section-kicker">候选池</p>
                <h3>准备取舍的书</h3>
              </div>
              <label className="search-field candidate-bookshelf-search">
                <Search aria-hidden="true" size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="按书名或作者筛选候选"
                />
              </label>
              {query ? (
                <button className="text-button" type="button" onClick={() => setQuery("")}>
                  <X aria-hidden="true" size={16} />
                  清空
                </button>
              ) : null}
            </div>

            <div className="candidate-source-filter" aria-label="候选来源筛选">
              <CandidateSourceFilterButton
                active={candidateSourceFilter === "all"}
                count={candidateSourceStats.total}
                label="全部"
                onClick={() => setCandidateSourceFilter("all")}
              />
              <CandidateSourceFilterButton
                active={candidateSourceFilter === "confirmed"}
                count={candidateSourceStats.confirmed}
                label="已确认"
                onClick={() => setCandidateSourceFilter("confirmed")}
              />
              <CandidateSourceFilterButton
                active={candidateSourceFilter === "unconfirmed"}
                count={candidateSourceStats.unconfirmed}
                label="待确认"
                onClick={() => setCandidateSourceFilter("unconfirmed")}
              />
              <CandidateSourceFilterButton
                active={candidateSourceFilter === "light"}
                count={candidateSourceStats.light}
                label="轻管理"
                onClick={() => setCandidateSourceFilter("light")}
              />
            </div>

            {visibleBooks.length > 0 ? (
              <div className="candidate-bookshelf-grid">
                {visibleBooks.map((book) => {
                  const canOpenDetail = canOpenCandidateDetail(book);
                  const canConfirmSource = isUnconfirmedAiCandidate(book);
                  const searchState = candidateConfirmationSearchStates[book.bookId] ?? {
                    status: "idle",
                    results: []
                  };
                  const isSearching = searchState.status === "searching";
                  const isActionMenuOpen = openActionMenuBookId === book.bookId;
                  const isRemoving = removingIds.has(book.bookId);
                  return (
                    <article key={book.bookId} className="shelf-card shelf-card--menu-card candidate-bookshelf-card">
                      <button
                        type="button"
                        className="shelf-card-main shelf-card-main--button"
                        disabled={!canOpenDetail}
                        title={canOpenDetail ? undefined : "AI 本地候选尚未确认微信读书书源"}
                        onClick={() => handleOpenCandidateBook(book, onOpenBookDetail)}
                      >
                        <span className="cover-frame">
                          {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={32} />}
                        </span>
                        <span className="shelf-card-copy">
                          <strong>{book.title}</strong>
                          <small>{book.author || book.category || "本地候选"}</small>
                          <span className="shelf-card-meta">
                            <span className={`candidate-source-badge is-${getCandidateSourceTone(book)}`}>
                              {getCandidateSourceLabel(book)}
                            </span>
                          </span>
                        </span>
                      </button>
                      <div className="shelf-card-menu" data-candidate-card-menu-root>
                        <button
                          className="shelf-card-menu-trigger"
                          type="button"
                          aria-label={`更多候选操作：${book.title}`}
                          aria-haspopup="menu"
                          aria-expanded={isActionMenuOpen}
                          onClick={() => handleToggleCandidateActionMenu(book.bookId)}
                        >
                          <MoreHorizontal aria-hidden="true" size={18} />
                        </button>
                        {isActionMenuOpen ? (
                          <div className="shelf-card-menu-popover" role="menu" aria-label="候选操作">
                            <button
                              className="is-danger"
                              type="button"
                              role="menuitem"
                              disabled={isRemoving}
                              onClick={() => handleRemoveCandidateFromMenu(book)}
                            >
                              <Trash2 aria-hidden="true" size={16} />
                              {isRemoving ? "移除中" : "移除候选"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {canConfirmSource ? (
                        <div className="candidate-card-actions">
                          <button
                            className="text-button"
                            type="button"
                            disabled={isSearching}
                            onClick={() => void handleSearchCandidateConfirmation(book)}
                          >
                            {isSearching ? (
                              <Loader2 aria-hidden="true" className="spin" size={15} />
                            ) : (
                              <Search aria-hidden="true" size={15} />
                            )}
                            {candidateConfirmationSearchActionLabel(searchState.status)}
                          </button>
                        </div>
                      ) : null}
                      {canConfirmSource ? renderCandidateConfirmationSearchResults(book, searchState) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <section className="empty-inline" aria-label="候选筛选无结果">
                <Search aria-hidden="true" size={24} />
                <h3>{filteredEmptyState?.title ?? "没有可展示的候选书"}</h3>
                <p>{filteredEmptyState?.description ?? "候选数据暂时不可见，可以稍后重试。"}</p>
                {filteredEmptyState?.canClearQuery || filteredEmptyState?.canShowAllSources ? (
                  <div className="candidate-filter-empty-actions">
                    {filteredEmptyState.canClearQuery ? (
                      <button className="secondary-action" type="button" onClick={() => setQuery("")}>
                        <X aria-hidden="true" size={16} />
                        清空搜索
                      </button>
                    ) : null}
                    {filteredEmptyState.canShowAllSources ? (
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => setCandidateSourceFilter("all")}
                      >
                        <Compass aria-hidden="true" size={16} />
                        显示全部
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            )}
          </section>
        </>
      ) : null}

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

function SummaryPill({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function CandidateSourceFilterButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`text-button candidate-source-filter-button ${active ? "is-active" : ""}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}

function filterCandidateBooks(books: LocalCandidateBook[], query: string): LocalCandidateBook[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return books;
  }

  return books.filter((book) => {
    const title = book.title.toLowerCase();
    const author = book.author?.toLowerCase() ?? "";
    const category = book.category?.toLowerCase() ?? "";
    return title.includes(keyword) || author.includes(keyword) || category.includes(keyword);
  });
}

function handleOpenCandidateBook(
  book: LocalCandidateBook,
  onOpenBookDetail: (book: SearchResult) => void
) {
  if (!canOpenCandidateDetail(book)) {
    return;
  }

  onOpenBookDetail(book);
}

function candidateConfirmationSearchActionLabel(status: CandidateConfirmationSearchStatus): string {
  switch (status) {
    case "searching":
      return "搜索中";
    case "found":
      return "重新搜索";
    case "notFound":
      return "重试搜索";
    case "failed":
      return "重试搜索";
    case "idle":
    default:
      return "搜索确认";
  }
}

function confirmationResultKey(candidateId: string, resultId: string): string {
  return `${candidateId}::${resultId}`;
}
