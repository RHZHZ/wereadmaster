import { startTransition, useDeferredValue, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Compass,
  Loader2,
  RefreshCw,
  Search,
  Sparkles
} from "lucide-react";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import { RecommendationList } from "../components/RecommendationList";
import { SearchResults } from "../components/SearchResults";
import { useToast } from "../components/ToastProvider";
import {
  appendRecentSearchKeyword,
  chooseSearchScope
} from "../lib/business-rules";
import {
  getCommandErrorMessage,
  getRecommendations,
  getSimilarBooks,
  listReadingItemStates,
  searchBooks,
  upsertReadingItemState,
  type BookshelfResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import type {
  CredentialStatus,
  Recommendation,
  RecommendationResult,
  ReadingStatsMode,
  SearchBooksResult,
  SearchResult,
  SearchScope,
  SimilarBooksResult
} from "../lib/types";
import {
  buildCandidateMap,
  isSavedCandidateState
} from "./candidate-books";

type DiscoveryPageProps = {
  credentialStatus?: CredentialStatus;
  bookshelf?: BookshelfResponse;
  readingStatsCache: Partial<Record<ReadingStatsMode, ReadingStatsResponse>>;
  seedBook?: SearchResult;
  initialQuery?: { keyword: string; nonce: number };
  onOpenSettings: () => void;
  onOpenBookDetail: (book: SearchResult) => void;
  onOpenCandidateShelf: () => void;
  onClearSeedBook?: () => void;
  onClearInitialQuery?: () => void;
};

type ShelfSeedAction = "search" | "similar";

type ShelfSeedSection = {
  title: string;
  description: string;
  action: ShelfSeedAction;
  items: SearchResult[];
};

const scopeOptions: Array<{ scope: SearchScope; label: string; description: string }> = [
  { scope: 0, label: "综合", description: "自动分组" },
  { scope: 10, label: "电子书", description: "找书优先" },
  { scope: 14, label: "听书", description: "有声内容" },
  { scope: 6, label: "作者", description: "作家名" },
  { scope: 12, label: "全文", description: "正文命中" },
  { scope: 16, label: "网文", description: "网络小说" },
  { scope: 13, label: "书单", description: "主题清单" },
  { scope: 2, label: "公众号", description: "公众号" },
  { scope: 4, label: "文章", description: "文章内容" }
];

const primaryScopeCount = 5;
const RECENT_SEARCHES_KEY = "wxreadmaster.discoveryRecentSearches";
const themeSuggestions = ["AI", "心理学", "时间管理", "科幻", "历史", "听书"];

export function DiscoveryPage({
  credentialStatus,
  bookshelf,
  readingStatsCache,
  seedBook,
  initialQuery,
  onOpenSettings,
  onOpenBookDetail,
  onOpenCandidateShelf,
  onClearSeedBook,
  onClearInitialQuery
}: DiscoveryPageProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState<SearchScope>(0);
  const [searchResult, setSearchResult] = useState<SearchBooksResult>();
  const [recommendations, setRecommendations] = useState<RecommendationResult>();
  const [similarBooks, setSimilarBooks] = useState<SimilarBooksResult>();
  const [similarSeed, setSimilarSeed] = useState<SearchResult>();
  const [showAllScopes, setShowAllScopes] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchPaging, setIsSearchPaging] = useState(false);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [isRecommendationPaging, setIsRecommendationPaging] = useState(false);
  const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
  const [isSimilarPaging, setIsSimilarPaging] = useState(false);
  const [candidateMap, setCandidateMap] = useState<Map<string, SearchResult>>(() => new Map());
  const [savingCandidateIds, setSavingCandidateIds] = useState<Set<string>>(() => new Set());
  const [recentSearches, setRecentSearches] = useState<string[]>(getInitialRecentSearches);
  const [error, setError] = useState<string>();
  const [similarNotice, setSimilarNotice] = useState<string>();
  const { showToast } = useToast();
  const hasCredential = credentialStatus?.hasCredential === true;
  const hasSearchInput = deferredQuery.trim().length > 0;
  const visibleScopeOptions = showAllScopes ? scopeOptions : scopeOptions.slice(0, primaryScopeCount);
  const currentScopeIsHidden = !visibleScopeOptions.some((option) => option.scope === scope);
  const shelfSeedSections = buildShelfSeedSections(bookshelf, readingStatsCache);
  const shelfItemIds = new Set((bookshelf?.snapshot.entries ?? []).map((entry) => entry.id));
  const candidateIds = new Set(candidateMap.keys());
  const candidateBooks = [...candidateMap.values()].slice(0, 6);
  const compactSeedBooks = shelfSeedSections.flatMap((section) => section.items.slice(0, 2)).slice(0, 4);
  const compactThemeSuggestions = themeSuggestions.slice(0, 4);
  const compactRecentSearches = recentSearches.slice(0, 4);
  const isSimilarMode = Boolean(similarSeed);
  const hasSearchActivity = Boolean(searchResult) || isSearching || hasSearchInput;

  useEffect(() => {
    let isMounted = true;

    async function loadCandidateStates() {
      try {
        const states = await listReadingItemStates();
        if (isMounted) {
          setCandidateMap(buildCandidateMap(states.filter(isSavedCandidateState)));
        }
      } catch (candidateError) {
        if (isMounted) {
          setError(getCommandErrorMessage(candidateError));
        }
      }
    }

    void loadCandidateStates();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const normalized = initialQuery?.keyword.trim();
    if (!normalized) {
      return;
    }

    setQuery(normalized);
    setScope(chooseSearchScope(normalized));
    setSearchResult(undefined);
    setSimilarSeed(undefined);
    setSimilarBooks(undefined);
    setSimilarNotice(undefined);
    onClearInitialQuery?.();
  }, [initialQuery?.nonce, onClearInitialQuery]);

  useEffect(() => {
    if (!hasCredential || recommendations || isLoadingRecommendations) {
      return;
    }

    void loadRecommendations();
  }, [hasCredential, recommendations, isLoadingRecommendations]);

  useEffect(() => {
    if (!seedBook || seedBook.bookId === similarSeed?.bookId) {
      return;
    }

    setSimilarSeed(seedBook);
    if (hasCredential) {
      void loadSimilar(seedBook);
    }
  }, [hasCredential, seedBook, similarSeed?.bookId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
  }, [recentSearches]);

  async function handleSearchSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    await performSearch(query.trim(), scope);
  }

  async function performSearch(keyword: string, searchScope: SearchScope): Promise<boolean> {
    const normalizedKeyword = keyword.trim();

    if (!hasCredential) {
      setError("请先在设置中保存微信读书 API Key，再使用发现搜索。");
      onOpenSettings();
      return false;
    }

    if (!normalizedKeyword) {
      setError("请输入搜索关键词。");
      return false;
    }

    setIsSearching(true);
    setSearchResult(undefined);
    setError(undefined);

    try {
      const response = await searchBooks({ keyword: normalizedKeyword, scope: searchScope, count: 20 });
      setSearchResult(response.result);
      setRecentSearches((current) => appendRecentSearchKeyword(current, normalizedKeyword));
      return true;
    } catch (searchError) {
      setError(getCommandErrorMessage(searchError));
      return false;
    } finally {
      setIsSearching(false);
    }
  }

  async function handleLoadMoreSearch() {
    const keyword = query.trim();
    const maxIdx = searchResult?.nextMaxIdx;
    if (!keyword || maxIdx === undefined) {
      return;
    }

    setIsSearchPaging(true);
    setError(undefined);

    try {
      const response = await searchBooks({ keyword, scope, maxIdx, count: 20 });
      setSearchResult((current) => mergeSearchResults(current, response.result));
    } catch (searchError) {
      setError(getCommandErrorMessage(searchError));
    } finally {
      setIsSearchPaging(false);
    }
  }

  async function loadRecommendations(maxIdx?: number) {
    if (!hasCredential) {
      return;
    }

    const isPaging = maxIdx !== undefined;
    if (isPaging) {
      setIsRecommendationPaging(true);
    } else {
      setIsLoadingRecommendations(true);
    }
    setError(undefined);

    try {
      const response = await getRecommendations({ count: 6, maxIdx });
      setRecommendations((current) =>
        isPaging && current ? mergeRecommendationResults(current, response.result) : response.result
      );
    } catch (recommendError) {
      setError(getCommandErrorMessage(recommendError));
    } finally {
      setIsLoadingRecommendations(false);
      setIsRecommendationPaging(false);
    }
  }

  async function loadSimilar(book: SearchResult, maxIdx?: number) {
    if (!hasCredential) {
      setError("请先在设置中保存微信读书 API Key，再获取相似推荐。");
      onOpenSettings();
      return;
    }

    const isPaging = maxIdx !== undefined;
    setSimilarSeed(book);
    if (isPaging) {
      setIsSimilarPaging(true);
    } else {
      setIsLoadingSimilar(true);
      setSimilarBooks(undefined);
      setSearchResult(undefined);
      setSimilarNotice(undefined);
    }
    setError(undefined);

    try {
      const response = await getSimilarBooks({
        bookId: book.bookId,
        count: 12,
        maxIdx,
        sessionId: isPaging ? similarBooks?.sessionId : undefined
      });
      setSimilarBooks((current) =>
        isPaging && current ? mergeSimilarResults(current, response.result) : response.result
      );
      setSimilarNotice(undefined);
    } catch (similarError) {
      const fallbackKeyword = book.title.trim();
      if (fallbackKeyword && !isPaging) {
        const fallbackScope = chooseSearchScope(fallbackKeyword);
        setSimilarBooks(undefined);
        setSimilarNotice("相似推荐接口暂时不可用，已改用书名搜索兜底。");
        startTransition(() => {
          setQuery(fallbackKeyword);
          setScope(fallbackScope);
        });
        await performSearch(fallbackKeyword, fallbackScope);
      } else {
        setSimilarNotice(getCommandErrorMessage(similarError));
      }
    } finally {
      setIsLoadingSimilar(false);
      setIsSimilarPaging(false);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setSearchResult(undefined);
    }
  }

  function handleScopeChange(nextScope: SearchScope) {
    startTransition(() => {
      setScope(nextScope);
    });
  }

  function handleAutoScope() {
    const nextScope = chooseSearchScope(query);
    setScope(nextScope);
  }

  function handleSuggestion(keyword: string) {
    startTransition(() => {
      setQuery(keyword);
      setScope(chooseSearchScope(keyword));
    });
  }

  function handleShelfSeedClick(book: SearchResult, action: ShelfSeedAction) {
    if (action === "search") {
      startTransition(() => {
        setQuery(book.title);
        setScope(chooseSearchScope(book.title));
      });
      setSimilarSeed(undefined);
      setSimilarBooks(undefined);
      void performSearch(book.title, chooseSearchScope(book.title));
      return;
    }

    void loadSimilar(book);
  }

  async function handleSaveCandidate(book: SearchResult) {
    if (candidateIds.has(book.bookId) || shelfItemIds.has(book.bookId)) {
      return;
    }

    setSavingCandidateIds((current) => new Set(current).add(book.bookId));
    setError(undefined);

    try {
      await upsertReadingItemState({
        itemId: book.bookId,
        itemType: "candidate",
        status: "toRead",
        title: book.title,
        author: book.author,
        cover: book.cover,
        category: book.category,
        note: "发现页保存的本地候选"
      });
      setCandidateMap((current) => new Map(current).set(book.bookId, mapBookToCandidate(book)));
      showToast({ message: `已保存《${book.title}》到本地候选`, tone: "success" });
    } catch (candidateError) {
      const message = getCommandErrorMessage(candidateError);
      setError(message);
      showToast({ message, tone: "error" });
    } finally {
      setSavingCandidateIds((current) => {
        const next = new Set(current);
        next.delete(book.bookId);
        return next;
      });
    }
  }

  function handleReturnToDiscovery() {
    setSimilarSeed(undefined);
    setSimilarBooks(undefined);
    setSimilarNotice(undefined);
    onClearSeedBook?.();
  }

  return (
    <section className="discovery-page" aria-label={isSimilarMode ? "相似探索" : "发现"}>
      {!isSimilarMode ? (
        <section className={`discovery-hero ${hasSearchActivity ? "discovery-hero--compact" : ""}`}>
          <div className="discovery-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="discovery-hero-copy">
            <h3 aria-label={hasSearchActivity ? "发现下一本书" : "在自己的阅读宇宙里找下一本书"}>
              {hasSearchActivity ? (
                <span aria-hidden="true">发现下一本书</span>
              ) : (
                <>
                  <span aria-hidden="true">在自己的</span>
                  <span aria-hidden="true">阅读宇宙里</span>
                  <span aria-hidden="true">找下一本书</span>
                </>
              )}
            </h3>
            <p>
              {hasSearchActivity
                ? "先看搜索结果，再用书架种子、主题词和推荐做补充。"
                : "从关键词、个性化推荐或相似书出发，把想读、待读和可深挖的书放在同一个本地工作台里。"}
            </p>
          </div>

          <section className="discovery-search-panel" aria-label="搜索">
            <form className="discovery-search-form" onSubmit={(event) => void handleSearchSubmit(event)}>
              <label>
                <Search aria-hidden="true" size={18} />
                <input
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  placeholder="输入书名、作者、主题，或试试“听书/网文/全文”"
                />
              </label>
              <button type="button" className="text-button" onClick={handleAutoScope}>
                智能范围
              </button>
              <button className="secondary-action" type="submit" disabled={!hasCredential || isSearching}>
                {isSearching ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <Search aria-hidden="true" size={18} />}
                {isSearching ? "搜索中" : "搜索"}
              </button>
            </form>

            <div className="scope-tabs" role="tablist" aria-label="搜索范围">
              {visibleScopeOptions.map((option) => (
                <button
                  key={option.scope}
                  type="button"
                  role="tab"
                  aria-selected={scope === option.scope}
                  className={scope === option.scope ? "is-active" : ""}
                  onClick={() => handleScopeChange(option.scope)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </button>
              ))}
              <button
                type="button"
                className={currentScopeIsHidden ? "is-active scope-more-button" : "scope-more-button"}
                onClick={() => setShowAllScopes((current) => !current)}
                aria-expanded={showAllScopes}
              >
                <strong>{showAllScopes ? "收起" : "更多"}</strong>
                <small>{currentScopeIsHidden ? "已选择" : "范围"}</small>
              </button>
            </div>
          </section>

          <div className="discovery-hero-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void loadRecommendations()}
              disabled={!hasCredential || isLoadingRecommendations}
            >
              {isLoadingRecommendations ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              刷新推荐
            </button>
          </div>
        </section>
      ) : null}

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="发现页只调用本地 Tauri 命令；保存凭据后才能搜索和获取推荐。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error ? (
        <div className="status-message status-message--error">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {isSimilarMode && similarSeed ? (
        <section className="discovery-similar-view" aria-label="相似探索">
          <section className="discovery-card discovery-similar-hero">
            <button className="text-button discovery-back-button" type="button" onClick={handleReturnToDiscovery}>
              <ArrowLeft aria-hidden="true" size={18} />
              返回发现
            </button>
            <div className="discovery-similar-copy">
              <p className="section-kicker">相似探索</p>
              <h3>围绕《{similarSeed.title}》继续找</h3>
              <p>优先尝试微信读书相似推荐；接口不可用时自动改用书名搜索兜底，不让发现流卡在错误状态。</p>
            </div>
            <article className="similar-seed-card" aria-label="种子书">
              <div className="similar-seed-cover">
                {similarSeed.cover ? <img src={similarSeed.cover} alt="" /> : <Compass aria-hidden="true" size={28} />}
              </div>
              <div>
                <p className="section-kicker">种子书</p>
                <h4>{similarSeed.title}</h4>
                <p>{similarSeed.author || similarSeed.category || "微信读书条目"}</p>
              </div>
            </article>
          </section>

          {similarNotice ? <p className="recommendation-notice discovery-similar-notice">{similarNotice}</p> : null}

          {similarBooks || isLoadingSimilar ? (
            <RecommendationList
              kicker="相似推荐"
              title="相似书结果"
              description="这里专门承载“从一本书继续扩展”的阅读路径，不再挤在发现页右栏。"
              books={similarBooks?.books ?? []}
              isLoading={isLoadingSimilar}
              isLoadingMore={isSimilarPaging}
              hasMore={similarBooks?.hasMore === true}
              emptyTitle="暂无相似书"
              emptyDescription="微信读书相似接口没有返回可展示内容，可以返回发现页改用主题搜索。"
              onOpenBook={onOpenBookDetail}
              onFindSimilar={(book) => void loadSimilar(book)}
              candidateIds={candidateIds}
              savingCandidateIds={savingCandidateIds}
              shelfItemIds={shelfItemIds}
              onSaveCandidate={(book) => void handleSaveCandidate(book)}
              onLoadMore={() => void loadSimilar(similarSeed, similarBooks?.nextMaxIdx)}
            />
          ) : null}

          {!isLoadingSimilar && searchResult ? (
            <SearchResults
              result={searchResult}
              isLoading={isSearching && hasSearchInput}
              isLoadingMore={isSearchPaging}
              onOpenBook={onOpenBookDetail}
              onFindSimilar={(book) => void loadSimilar(book)}
              candidateIds={candidateIds}
              savingCandidateIds={savingCandidateIds}
              shelfItemIds={shelfItemIds}
              onSaveCandidate={(book) => void handleSaveCandidate(book)}
              onLoadMore={() => void handleLoadMoreSearch()}
              onUseSuggestion={handleSuggestion}
              kicker="搜索兜底"
              heading={`${searchResult.results.length} 条搜索兜底结果`}
            />
          ) : null}

          {!isLoadingSimilar && !searchResult && !similarBooks ? (
            <section className="discovery-empty discovery-empty--compact">
              <Compass aria-hidden="true" size={28} />
              <h3>正在等待相似结果</h3>
              <p>如果微信读书接口不可用，会自动切换到书名搜索兜底。</p>
            </section>
          ) : null}
        </section>
      ) : (
        <div className={`discovery-layout ${hasSearchActivity ? "discovery-layout--searching" : ""}`}>
          <div className="discovery-main-column">
          {hasSearchActivity ? (
            <SearchResults
              result={searchResult}
              isLoading={isSearching && hasSearchInput}
              isLoadingMore={isSearchPaging}
              onOpenBook={onOpenBookDetail}
              onFindSimilar={(book) => void loadSimilar(book)}
              candidateIds={candidateIds}
              savingCandidateIds={savingCandidateIds}
              shelfItemIds={shelfItemIds}
              onSaveCandidate={(book) => void handleSaveCandidate(book)}
              onLoadMore={() => void handleLoadMoreSearch()}
              onUseSuggestion={handleSuggestion}
            />
          ) : null}

            {hasSearchActivity ? (
              <section className="discovery-card discovery-search-assist" aria-label="搜索辅助入口">
              {candidateBooks.length > 0 ? (
                <CandidateDecisionBlock
                  candidateBooks={candidateBooks}
                  onOpenBook={onOpenBookDetail}
                  onOpenCandidateShelf={onOpenCandidateShelf}
                />
              ) : null}

              {compactSeedBooks.length > 0 ? (
                <div className="discovery-assist-block">
                  <p className="section-kicker">书架种子</p>
                  <h3>从已读内容继续扩展</h3>
                  <div className="starter-tags">
                    {compactSeedBooks.map((seed) => (
                      <button key={`compact-seed-${seed.bookId}-${seed.title}`} type="button" onClick={() => void loadSimilar(seed)}>
                        {seed.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="discovery-assist-block">
                <p className="section-kicker">换个方向</p>
                <h3>主题和最近搜索</h3>
                <div className="discovery-assist-tag-groups">
                  <div className="starter-tags" aria-label="主题 chips">
                    {compactThemeSuggestions.map((keyword) => (
                      <button key={`theme-${keyword}`} type="button" onClick={() => handleSuggestion(keyword)}>
                        {keyword}
                      </button>
                    ))}
                  </div>
                  {compactRecentSearches.length > 0 ? (
                    <div className="starter-tags" aria-label="最近搜索关键词">
                      {compactRecentSearches.map((keyword) => (
                        <button key={`recent-${keyword}`} type="button" onClick={() => handleSuggestion(keyword)}>
                          {keyword}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            ) : null}

            {!hasSearchActivity ? (
              <section className="discovery-card discovery-shelf-seeds" aria-label="从我的书架出发">
            <div className="discovery-card-heading">
              <div>
                <p className="section-kicker">从我的书架出发</p>
                <h3>先从自己已经读过的内容继续扩展</h3>
                <p>最近阅读、最长投入和分类入口都来自本地书架缓存，不会触发后台自动请求。</p>
              </div>
            </div>

            {shelfSeedSections.length > 0 ? (
              <div className="shelf-seed-sections">
                {shelfSeedSections.map((section) => (
                  <section key={section.title} className="shelf-seed-section">
                    <div className="shelf-seed-section-head">
                      <strong>{section.title}</strong>
                      <small>{section.description}</small>
                    </div>
                    <div className="shelf-seed-grid">
                      {section.items.map((seed) => (
                        <button
                          key={`${section.title}-${seed.bookId}-${seed.title}`}
                          type="button"
                          className="shelf-seed-card"
                          onClick={() => handleShelfSeedClick(seed, section.action)}
                        >
                          <strong>{seed.title}</strong>
                          <small>{seed.author || seed.category || "书架条目"}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <section className="discovery-empty discovery-empty--compact">
                <Compass aria-hidden="true" size={28} />
                <h3>先同步书架，再沿着自己的阅读轨迹继续扩展</h3>
                <p>发现页会优先消费本地书架线索，帮你把下一批候选书沉淀下来。</p>
              </section>
            )}
              </section>
            ) : null}

            {!hasSearchActivity ? (
              <RecommendationList
                kicker="为你推荐"
                title="个性化推荐"
                description="根据微信读书返回的推荐理由，快速筛出值得继续看的书。"
                books={recommendations?.books ?? []}
                isLoading={isLoadingRecommendations}
                isLoadingMore={isRecommendationPaging}
                hasMore={recommendations?.hasMore === true}
                emptyTitle="还没有推荐缓存"
                emptyDescription="点击刷新推荐后展示微信读书返回的个性化书籍。"
                onOpenBook={onOpenBookDetail}
                onFindSimilar={(book) => void loadSimilar(book)}
                candidateIds={candidateIds}
                savingCandidateIds={savingCandidateIds}
                shelfItemIds={shelfItemIds}
                onSaveCandidate={(book) => void handleSaveCandidate(book)}
                onLoadMore={() => void loadRecommendations(recommendations?.nextMaxIdx)}
                maxVisible={6}
                layout="rail"
              />
            ) : null}

            {!hasSearchActivity ? (
              <section className="discovery-card discovery-search-helpers" aria-label="发现辅助入口">
                {candidateBooks.length > 0 ? (
                  <CandidateDecisionBlock
                    candidateBooks={candidateBooks}
                    onOpenBook={onOpenBookDetail}
                    onOpenCandidateShelf={onOpenCandidateShelf}
                  />
                ) : null}

                {compactSeedBooks.length > 0 ? (
                  <div className="discovery-assist-block">
                    <p className="section-kicker">书架种子</p>
                    <h3>从已读内容继续扩展</h3>
                    <div className="starter-tags">
                      {compactSeedBooks.map((seed) => (
                        <button key={`default-seed-${seed.bookId}-${seed.title}`} type="button" onClick={() => void loadSimilar(seed)}>
                          {seed.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="discovery-assist-block">
                  <p className="section-kicker">换个方向</p>
                  <h3>主题和最近搜索</h3>
                  <div className="discovery-assist-tag-groups">
                    <div className="starter-tags" aria-label="主题 chips">
                      {themeSuggestions.map((keyword) => (
                        <button key={keyword} type="button" onClick={() => handleSuggestion(keyword)}>
                          {keyword}
                        </button>
                      ))}
                    </div>
                    {recentSearches.length > 0 ? (
                      <div className="starter-tags" aria-label="最近搜索关键词">
                        {recentSearches.slice(0, 6).map((keyword) => (
                          <button key={keyword} type="button" onClick={() => handleSuggestion(keyword)}>
                            {keyword}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="discovery-helper-empty">还没有本地搜索关键词记录。</p>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      )}

      {searchResult || recommendations || similarBooks ? (
        <section className="stats-footnote discovery-footnote">
          <strong>使用说明</strong>
          <p>
            搜索翻页使用最后一条 searchIdx；相似书翻页使用 idx 和 sessionId。不可用书籍仍会展示，
            但进入详情时可能受微信读书接口限制。
          </p>
        </section>
      ) : (
        <section className="discovery-onboarding">
          <Compass aria-hidden="true" size={24} />
          <div>
            <h3>发现页只做你的个人阅读扩展</h3>
            <p>它不会读取好友关系，也不会把搜索记录上传到自建服务器，只服务你的本地候选沉淀。</p>
          </div>
          <Sparkles aria-hidden="true" size={24} />
        </section>
      )}
    </section>
  );
}

function getInitialRecentSearches(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string").slice(0, 6);
  } catch {
    return [];
  }
}

function mapBookToCandidate(book: SearchResult): SearchResult {
  return {
    bookId: book.bookId,
    title: book.title,
    author: book.author,
    cover: book.cover,
    intro: book.intro,
    category: book.category,
    publisher: book.publisher,
    ratingPercent: book.ratingPercent,
    ratingCount: book.ratingCount,
    ratingTitle: book.ratingTitle,
    readingCount: book.readingCount,
    soldout: book.soldout
  };
}

function CandidateDecisionBlock({
  candidateBooks,
  onOpenBook,
  onOpenCandidateShelf
}: {
  candidateBooks: SearchResult[];
  onOpenBook: (book: SearchResult) => void;
  onOpenCandidateShelf: () => void;
}) {
  return (
    <div className="discovery-assist-block discovery-assist-candidates" aria-label="本地候选">
      <p className="section-kicker">本地候选</p>
      <h3>已保存的下一批书</h3>
      <div className="discovery-assist-list">
        {candidateBooks.slice(0, 4).map((book) => (
          <button key={book.bookId} type="button" onClick={() => onOpenBook(book)}>
            <strong>{book.title}</strong>
            <small>{book.author || book.category || "本地候选"}</small>
          </button>
        ))}
      </div>

      <div className="discovery-candidate-jump">
        <p>发现页负责扩充候选，候选书架负责做取舍决策。</p>
        <button className="secondary-action" type="button" onClick={onOpenCandidateShelf}>
          去候选书架决策
        </button>
      </div>
    </div>
  );
}

function buildShelfSeedSections(
  bookshelf?: BookshelfResponse,
  readingStatsCache: Partial<Record<ReadingStatsMode, ReadingStatsResponse>> = {}
): ShelfSeedSection[] {
  const entries = bookshelf?.snapshot.entries ?? [];
  const books = entries.filter((entry) => entry.type === "book");
  const recent = books
    .slice()
    .sort((left, right) => (right.lastReadAt ?? 0) - (left.lastReadAt ?? 0))
    .slice(0, 2);
  const monthlyStats = readingStatsCache.monthly?.stats ?? readingStatsCache.overall?.stats;
  const longest = (monthlyStats?.longestItems ?? [])
    .map((item) => ({
      bookId: item.id,
      title: item.title,
      author: item.author,
      cover: item.cover,
      category: item.tags?.[0]
    }))
    .slice(0, 2);
  const categoryMap = new Map<string, string>();
  books.forEach((entry) => {
    if (!entry.category || categoryMap.has(entry.category)) {
      return;
    }

    categoryMap.set(entry.category, entry.title);
  });
  const categoryEntries = [...categoryMap.entries()].slice(0, 2).map(([category, title], index) => ({
    bookId: `category-${index}-${category}`,
    title: category,
    author: title,
    category
  }));

  const sections = [
    {
      title: "最近阅读",
      description: "从最近打开的书继续扩展",
      action: "similar" as const,
      items: recent.map(mapShelfEntryToSearchResult)
    },
    {
      title: "最长阅读",
      description: "来自本地统计缓存里的重点内容",
      action: "similar" as const,
      items: longest
    },
    {
      title: "分类入口",
      description: "先按主题打开搜索，再决定是否找相似",
      action: "search" as const,
      items: categoryEntries
    }
  ];

  return sections.filter((section) => section.items.length > 0);
}

function mapShelfEntryToSearchResult(entry: BookshelfResponse["snapshot"]["entries"][number]): SearchResult {
  return {
    bookId: entry.id,
    title: entry.title,
    author: entry.author,
    cover: entry.cover,
    category: entry.category
  };
}

function mergeSearchResults(
  current: SearchBooksResult | undefined,
  next: SearchBooksResult
): SearchBooksResult {
  if (!current) {
    return next;
  }

  return {
    ...next,
    groups: mergeSearchGroups(current.groups, next.groups),
    results: mergeBooks(current.results, next.results)
  };
}

function mergeSearchGroups(
  current: SearchBooksResult["groups"],
  next: SearchBooksResult["groups"]
): SearchBooksResult["groups"] {
  const merged = [...current];

  next.forEach((nextGroup) => {
    const index = merged.findIndex(
      (group) => group.scope === nextGroup.scope && group.title === nextGroup.title
    );

    if (index === -1) {
      merged.push(nextGroup);
      return;
    }

    merged[index] = {
      ...nextGroup,
      books: mergeBooks(merged[index].books, nextGroup.books)
    };
  });

  return merged;
}

function mergeRecommendationResults(
  current: RecommendationResult,
  next: RecommendationResult
): RecommendationResult {
  return {
    ...next,
    books: mergeBooks(current.books, next.books) as Recommendation[]
  };
}

function mergeSimilarResults(
  current: SimilarBooksResult,
  next: SimilarBooksResult
): SimilarBooksResult {
  return {
    ...next,
    sessionId: next.sessionId ?? current.sessionId,
    books: mergeBooks(current.books, next.books) as Recommendation[]
  };
}

function mergeBooks<T extends SearchResult>(current: T[], next: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  [...current, ...next].forEach((book) => {
    const key = `${book.bookId}-${book.searchIdx ?? ""}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(book);
  });

  return merged;
}
