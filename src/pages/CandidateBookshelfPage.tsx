import { startTransition, useDeferredValue, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Compass,
  Loader2,
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
  summarizeBookDecision,
  type BookshelfResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import type {
  BookDecisionGoal,
  CredentialStatus,
  ReadingStatsMode,
  SearchResult
} from "../lib/types";
import {
  buildBookDecisionCandidates,
  buildCandidateMap,
  isSavedCandidateState,
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
  onOpenSettings: () => void;
  onOpenDiscovery: () => void;
  onOpenBookDetail: (book: SearchResult) => void;
  onBookDecisionGenerated: (session: BookDecisionSession) => void;
};

export function CandidateBookshelfPage({
  credentialStatus,
  bookshelf,
  readingStatsCache = {},
  onOpenSettings,
  onOpenDiscovery,
  onOpenBookDetail,
  onBookDecisionGenerated
}: CandidateBookshelfPageProps) {
  const [candidateMap, setCandidateMap] = useState<Map<string, LocalCandidateBook>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedFactorIds, setSelectedFactorIds] = useState<Set<ReferenceFactor>>(() => new Set());
  const [candidateLimitMessage, setCandidateLimitMessage] = useState<string>();
  const [decisionGoal, setDecisionGoal] = useState<BookDecisionGoal>("轻松读");
  const [recentReadingWindowMode, setRecentReadingWindowMode] =
    useState<RecentReadingWindowMode>("auto");
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();
  const deferredQuery = useDeferredValue(query);
  const { showToast } = useToast();
  const candidateBooks = [...candidateMap.values()].sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN"));
  const visibleBooks = filterCandidateBooks(candidateBooks, deferredQuery);
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
  }, []);

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
        <SummaryPill label="参与决策" value={Math.min(candidateBooks.length, 8)} />
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

            {visibleBooks.length > 0 ? (
              <div className="candidate-bookshelf-grid">
                {visibleBooks.map((book) => (
                  <article key={book.bookId} className="shelf-card candidate-bookshelf-card">
                    <button
                      type="button"
                      className="shelf-card-main shelf-card-main--button"
                      onClick={() => handleOpenCandidateBook(book, onOpenBookDetail)}
                    >
                      <span className="cover-frame">
                        {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={32} />}
                      </span>
                      <span className="shelf-card-copy">
                        <strong>{book.title}</strong>
                        <small>{book.author || book.category || "本地候选"}</small>
                        <span className="shelf-card-meta">{getCandidateSourceLabel(book)}</span>
                      </span>
                    </button>
                    <button
                      className="text-button candidate-remove-button"
                      type="button"
                      disabled={removingIds.has(book.bookId)}
                      onClick={() => void handleRemoveCandidate(book)}
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      {removingIds.has(book.bookId) ? "移除中" : "移除"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <section className="empty-inline" aria-label="候选筛选无结果">
                <Search aria-hidden="true" size={24} />
                <h3>没有匹配的候选书</h3>
                <p>换一个关键词，或清空搜索继续浏览。</p>
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

function getCandidateSourceLabel(book: LocalCandidateBook): string {
  if (book.localType === "album") {
    return "有声书 · 轻管理候选";
  }

  if (book.localType === "mp") {
    return "文章收藏 · 轻管理候选";
  }

  return "发现页保存 · 本机候选";
}

function handleOpenCandidateBook(
  book: LocalCandidateBook,
  onOpenBookDetail: (book: SearchResult) => void
) {
  if (book.localType !== "candidate") {
    return;
  }

  onOpenBookDetail(book);
}
