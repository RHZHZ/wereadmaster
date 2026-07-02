import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Compass,
  Database,
  KeyRound,
  Library,
  RefreshCw,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import heroReadingDashboard from "../assets/hero-reading-dashboard.png";
import { PersonaIllustration } from "../components/PersonaIllustration";
import { buildReadingPersona, calculateTotalNotes, resolveReadingPersona } from "../lib/business-rules";
import { formatUnixDate } from "../lib/formatters";
import { getPersonaVisual } from "../lib/persona-visuals";
import {
  buildDailyWorkbenchActions,
  type DailyWorkbenchAction
} from "./dashboard-workbench-actions";
import {
  buildDailyReadingCard,
  type DailyReadingCard
} from "./dashboard-daily-card";
import {
  buildDashboardLocalProgress,
  type DashboardLocalProgress
} from "./dashboard-local-progress";
import {
  getCommandErrorInfo,
  getCommandErrorMessage,
  getAiSettingsState,
  getLatestReadingStatsReview,
  getRecommendations,
  getReadingStats,
  listReadingItemStates,
  type BookshelfResponse,
  type CommandErrorInfo,
  type NotebookOverviewResponse,
  type ReadingStatsResponse
} from "../lib/reading-api";
import type {
  AiSettingsState,
  BookDecisionResponse,
  CredentialStatus,
  NotebookBook,
  ReadingPersona,
  ReadingItemState,
  ReadingStats,
  ReadingStatsAiReviewResponse,
  ReadingStatsMode,
  SearchResult,
  ShelfEntry
} from "../lib/types";
import { hasReadingStatsData } from "../features/reading-stats/reading-stats-view-helpers";
import {
  getLatestReadingStatsResponse,
  type ReadingStatsCache
} from "./reading-stats-period";

type DashboardPageProps = {
  credentialStatus?: CredentialStatus;
  bookshelf?: BookshelfResponse;
  isLoading: boolean;
  isSyncing: boolean;
  error?: CommandErrorInfo;
  onSync: () => void;
  onOpenBookshelf: () => void;
  onOpenNotes: () => void;
  onOpenStats: () => void;
  onOpenReadingReview: () => void;
  onOpenDiscovery: () => void;
  onOpenShelfEntry: (entry: ShelfEntry) => void;
  onOpenBookNotes: (book: NotebookBook) => void;
  onOpenCandidateBook: (book: SearchResult) => void;
  onOpenSettings: () => void;
  onOpenReadingRoute: (entry: ShelfEntry) => void;
  bookDecisionSession?: {
    response: BookDecisionResponse;
    candidateBooks: SearchResult[];
  };
  onOpenBookDecision: () => void;
  notesOverview?: NotebookOverviewResponse;
  readingStatsCache: ReadingStatsCache;
  onReadingStatsCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
};

type RecentBookEntry = ShelfEntry & { type: "book"; lastReadAt: number };
type DashboardQueueItem = {
  id: string;
  subjectKey: string;
  title: string;
  meta: string;
  cover?: string;
  icon: React.ReactNode;
  actionLabel: string;
  onClick: () => void;
};
type TodayAction = {
  title: string;
  description: string;
  tone: "green" | "blue" | "gold" | "muted";
  icon: React.ReactNode;
  onClick: () => void;
};
type WeightedTodayAction = TodayAction & {
  weight: number;
  subjectKey?: string;
  actionKey: string;
};

export function DashboardPage({
  credentialStatus,
  bookshelf,
  isLoading,
  isSyncing,
  error,
  onSync,
  onOpenBookshelf,
  onOpenNotes,
  onOpenStats,
  onOpenReadingReview,
  onOpenDiscovery,
  onOpenShelfEntry,
  onOpenBookNotes,
  onOpenCandidateBook,
  onOpenSettings,
  onOpenReadingRoute,
  bookDecisionSession,
  onOpenBookDecision,
  notesOverview,
  readingStatsCache,
  onReadingStatsCacheChange
}: DashboardPageProps) {
  const [readingStates, setReadingStates] = useState<ReadingItemState[]>([]);
  const [isLoadingReadingStates, setIsLoadingReadingStates] = useState(false);
  const [readingStateError, setReadingStateError] = useState<string>();
  const [statsError, setStatsError] = useState<CommandErrorInfo>();
  const [aiSettingsState, setAiSettingsState] = useState<AiSettingsState>();
  const [reviewSuggestion, setReviewSuggestion] = useState<ReadingStatsAiReviewResponse>();
  const [reviewSuggestionError, setReviewSuggestionError] = useState<string>();
  const [recommendedBooks, setRecommendedBooks] = useState<SearchResult[]>([]);
  const [recommendationSource, setRecommendationSource] = useState<"remote" | "candidate">("candidate");
  const hasCredential = credentialStatus?.hasCredential === true;
  const summary = bookshelf?.snapshot.summary;
  const syncState = bookshelf?.syncState;
  const shelfEntries = useMemo(() => bookshelf?.snapshot.entries ?? [], [bookshelf?.snapshot.entries]);
  const hasShelfData = (summary?.totalVisibleEntries ?? 0) > 0;
  const lastSyncText = formatSyncDate(syncState?.lastSuccessAt);
  const notesBooks = useMemo(() => notesOverview?.books ?? [], [notesOverview?.books]);
  const monthlyStats = getLatestReadingStatsResponse(readingStatsCache, "monthly")?.stats;

  const shelfEntryMap = useMemo(() => new Map(shelfEntries.map((entry) => [entry.id, entry])), [shelfEntries]);
  const notesBookMap = useMemo(() => new Map(notesBooks.map((book) => [book.bookId, book])), [notesBooks]);
  const recentEntries = useMemo(() => getRecentEntries(shelfEntries), [shelfEntries]);
  const continueItems = useMemo(() => buildContinueItems(recentEntries, onOpenShelfEntry), [recentEntries, onOpenShelfEntry]);
  const reviewItems = useMemo(
    () =>
      buildReviewItems({
        readingStates,
        notesBooks,
        shelfEntryMap,
        notesBookMap,
        onOpenShelfEntry,
        onOpenBookNotes,
        onOpenReadingReview
      }),
    [readingStates, notesBooks, shelfEntryMap, notesBookMap, onOpenShelfEntry, onOpenBookNotes, onOpenReadingReview]
  );
  const candidateItems = useMemo(() => buildCandidateItems(readingStates, onOpenCandidateBook), [readingStates, onOpenCandidateBook]);
  const reviewActions = useMemo(() => reviewSuggestion?.review.nextActions.filter(Boolean).slice(0, 3) ?? [], [reviewSuggestion]);
  const hasMonthlyStatsData = hasReadingStatsData(monthlyStats);
  const localPersona = useMemo(() => buildReadingPersona(monthlyStats), [monthlyStats]);
  const overviewPersona = useMemo(
    () => resolveReadingPersona(localPersona, reviewSuggestion?.review.readingPersona),
    [localPersona, reviewSuggestion?.review.readingPersona]
  );
  const overviewPersonaDimensions = useMemo(
    () => overviewPersona.dimensions.slice(0, 4),
    [overviewPersona.dimensions]
  );
  const overviewPersonaSnapshot = useMemo(
    () => buildDashboardPersonaSnapshot(overviewPersona, monthlyStats),
    [overviewPersona, monthlyStats]
  );
  const overviewPersonaVisual = useMemo(
    () => overviewPersona.status === "insufficient" ? undefined : getPersonaVisual(overviewPersona),
    [overviewPersona]
  );
  const candidateRecommendations = useMemo(() => buildCandidateRecommendations(candidateItems), [candidateItems]);
  const dashboardRecommendations = recommendedBooks.length > 0 ? recommendedBooks : candidateRecommendations;
  const todayActions = useMemo(
    () =>
      buildTodayActions({
        hasCredential,
        hasShelfData,
        hasAiCredential: aiSettingsState?.credential.hasCredential,
        recentEntries,
        reviewItem: reviewItems[0],
        reviewItems,
        candidateItem: candidateItems[0],
        candidateItems,
        bookDecisionResponse: bookDecisionSession?.response,
        reviewActions,
        summary,
        shelfEntries,
        onOpenBookshelf,
        onOpenNotes,
        onOpenReadingReview,
        onOpenDiscovery,
        onOpenSettings,
        onOpenShelfEntry,
        onOpenReadingRoute,
        onOpenBookDecision
      }),
    [
      hasCredential,
      hasShelfData,
      aiSettingsState?.credential.hasCredential,
      recentEntries,
      reviewItems,
      candidateItems,
      bookDecisionSession?.response,
      reviewActions,
      summary,
      shelfEntries,
      onOpenBookshelf,
      onOpenNotes,
      onOpenReadingReview,
      onOpenDiscovery,
      onOpenSettings,
      onOpenShelfEntry,
      onOpenReadingRoute,
      onOpenBookDecision
    ]
  );
  const workbenchActions = useMemo(() => buildDailyWorkbenchActions(todayActions), [todayActions]);
  const topDecision = bookDecisionSession?.response.decision.topCandidates[0];
  const dailyReadingCard = useMemo(
    () =>
      buildDailyReadingCard({
        reviewActions,
        topDecisionTitle: topDecision?.title,
        topDecisionReason:
          topDecision?.prerequisiteAction || bookDecisionSession?.response.decision.nextActions[0],
        reviewItemTitle: reviewItems[0]?.title,
        reviewItemMeta: reviewItems[0]?.meta,
        recentBookTitle: recentEntries[0]?.title,
        recentBookMeta: recentEntries[0] ? formatRecentMeta(recentEntries[0]) : undefined,
        candidateTitle: candidateItems[0]?.title,
        candidateMeta: candidateItems[0]?.meta,
        personaSnapshot: hasMonthlyStatsData ? overviewPersonaSnapshot : undefined,
        hasCredential,
        hasShelfData,
        hasNotesData: notesBooks.length > 0
      }),
    [
      reviewActions,
      topDecision,
      bookDecisionSession?.response.decision.nextActions,
      reviewItems,
      recentEntries,
      candidateItems,
      hasMonthlyStatsData,
      overviewPersonaSnapshot,
      hasCredential,
      hasShelfData,
      notesBooks.length
    ]
  );
  const localProgress = useMemo(
    () =>
      buildDashboardLocalProgress({
        readingStates,
        reviewQueueCount: reviewItems.length,
        candidateQueueCount: candidateItems.length,
        notesBookCount: notesBooks.length
      }),
    [readingStates, reviewItems.length, candidateItems.length, notesBooks.length]
  );

  function handleDailyReadingCardClick() {
    if (dailyReadingCard.tone === "stats") {
      onOpenReadingReview();
      return;
    }

    if (dailyReadingCard.tone === "decision") {
      onOpenBookDecision();
      return;
    }

    if (dailyReadingCard.tone === "review") {
      reviewItems[0]?.onClick();
      return;
    }

    if (dailyReadingCard.tone === "book") {
      const latestBook = recentEntries[0];
      if (latestBook) {
        onOpenShelfEntry(latestBook);
      } else {
        onOpenBookshelf();
      }
      return;
    }

    if (dailyReadingCard.tone === "candidate") {
      candidateItems[0]?.onClick();
      return;
    }

    if (dailyReadingCard.tone === "persona") {
      onOpenStats();
      return;
    }

    if (!hasCredential) {
      onOpenSettings();
      return;
    }

    if (!hasShelfData) {
      onOpenBookshelf();
      return;
    }

    if (notesBooks.length === 0) {
      onOpenNotes();
      return;
    }

    onOpenBookshelf();
  }

  useEffect(() => {
    let isMounted = true;

    async function loadAiSettingsState() {
      if (!hasCredential) {
        setAiSettingsState(undefined);
        return;
      }

      try {
        const nextState = await getAiSettingsState();
        if (isMounted) {
          setAiSettingsState(nextState);
        }
      } catch {
        if (isMounted) {
          setAiSettingsState(undefined);
        }
      }
    }

    void loadAiSettingsState();

    return () => {
      isMounted = false;
    };
  }, [hasCredential]);

  useEffect(() => {
    let isMounted = true;

    async function loadReviewSuggestion() {
      if (!hasCredential || !monthlyStats || (monthlyStats.totalReadTimeSeconds ?? 0) <= 0) {
        setReviewSuggestion(undefined);
        setReviewSuggestionError(undefined);
        return;
      }

      try {
        const response = await getLatestReadingStatsReview({
          mode: "monthly",
          baseTime: monthlyStats.baseTime
        });
        if (!isMounted) {
          return;
        }

        setReviewSuggestion(response);
        setReviewSuggestionError(undefined);
      } catch (loadError) {
        if (isMounted) {
          setReviewSuggestion(undefined);
          setReviewSuggestionError(getCommandErrorMessage(loadError));
        }
      }
    }

    void loadReviewSuggestion();

    return () => {
      isMounted = false;
    };
  }, [hasCredential, monthlyStats?.baseTime, monthlyStats?.totalReadTimeSeconds]);

  useEffect(() => {
    let isMounted = true;

    async function loadReadingStates() {
      setIsLoadingReadingStates(true);
      setReadingStateError(undefined);

      try {
        const states = await listReadingItemStates();
        if (isMounted) {
          setReadingStates(states);
        }
      } catch (loadError) {
        if (isMounted) {
          setReadingStateError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingReadingStates(false);
        }
      }
    }

    void loadReadingStates();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadMonthlyStats() {
      if (!hasCredential || monthlyStats) {
        return;
      }

      try {
        const response = await getReadingStats("monthly");
        if (isMounted) {
          onReadingStatsCacheChange("monthly", response);
          setStatsError(undefined);
        }
      } catch (loadError) {
        if (isMounted) {
          setStatsError(getCommandErrorInfo(loadError));
        }
      }
    }

    void loadMonthlyStats();

    return () => {
      isMounted = false;
    };
  }, [hasCredential, monthlyStats, onReadingStatsCacheChange]);

  useEffect(() => {
    let isMounted = true;

    async function loadRecommendations() {
      if (!hasCredential) {
        setRecommendedBooks([]);
        setRecommendationSource("candidate");
        return;
      }

      try {
        const response = await getRecommendations({ count: 6 });
        if (!isMounted) {
          return;
        }

        if (response.result.books.length > 0) {
          setRecommendedBooks(response.result.books);
          setRecommendationSource("remote");
        } else {
          setRecommendedBooks([]);
          setRecommendationSource("candidate");
        }
      } catch {
        if (isMounted) {
          setRecommendedBooks([]);
          setRecommendationSource("candidate");
        }
      }
    }

    void loadRecommendations();

    return () => {
      isMounted = false;
    };
  }, [hasCredential]);

  return (
    <section className="dashboard-grid" aria-label="阅读总览">
      <article className="hero-panel">
        <img src={heroReadingDashboard} alt="" />
        <div className="hero-copy">
          <p className="section-kicker">阅读工作台</p>
          <h3>把微信读书里的阅读记录，整理成你的本机阅读工作台。</h3>
          <p>
            {hasCredential
              ? "这里会优先读取本机缓存，帮助你继续阅读、复盘和整理输出。"
              : "先在设置里保存 API Key，再把自己的书架、笔记和统计同步到本机。"}
          </p>
          <div className="dashboard-quick-actions" aria-label="总览快捷入口">
            <button className="hero-action hero-action--primary" type="button" onClick={onOpenBookshelf}>
              <Library aria-hidden="true" size={18} />
              查看书架
            </button>
            <button className="hero-action" type="button" onClick={onOpenNotes}>
              <BookMarked aria-hidden="true" size={18} />
              查看笔记
            </button>
            <button className="hero-action" type="button" onClick={onOpenReadingReview}>
              <BarChart3 aria-hidden="true" size={18} />
              阅读复盘
            </button>
            <button className="hero-action" type="button" onClick={onOpenDiscovery}>
              <Compass aria-hidden="true" size={18} />
              发现书籍
            </button>
          </div>
        </div>
      </article>

      <section className="metric-grid" aria-label="核心指标">
        <MetricCard
          label="书架条目"
          value={isLoading ? "读取中" : String(summary?.totalVisibleEntries ?? 0)}
          detail="含电子书、有声书和文章收藏"
        />
        <MetricCard
          label="公开 / 私密"
          value={`${summary?.publicCount ?? 0} / ${summary?.secretCount ?? 0}`}
          detail="私密条目只在本机展示"
        />
        <MetricCard
          label="最近同步"
          value={lastSyncText.value}
          detail={lastSyncText.detail}
        />
      </section>

      <article className={`dashboard-status-strip ${hasCredential ? "is-connected" : "is-warning"}`}>
        {hasCredential ? <CheckCircle2 aria-hidden="true" size={18} /> : <KeyRound aria-hidden="true" size={18} />}
        <div>
          <strong>{hasCredential ? "已连接本地阅读工作台" : "先连接微信读书，建立阅读数据基础"}</strong>
          <span>
            {hasCredential
              ? "仅通过本机服务读取，API Key 保存在本机安全存储中。"
              : "API Key 会保存到本机安全存储，页面不会显示密钥。"}
          </span>
        </div>
        <button className="text-button" type="button" onClick={onOpenSettings}>
          打开设置
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </article>

      <DailyWorkbenchPanel
        primaryAction={workbenchActions.primaryAction}
        secondaryActions={workbenchActions.secondaryActions}
      />

      <article className="today-actions-panel" aria-label="今日可做">
        <div className="activity-heading">
          <div>
            <p className="section-kicker">今日可做</p>
            <h3>辅助动作</h3>
          </div>
          <span>{todayActions.length} 项</span>
        </div>
        <div className="today-action-list">
          {todayActions.map((item) => (
            <button
              className="today-action-card"
              type="button"
              key={item.title}
              onClick={item.onClick}
              title={`${item.title}：${item.description}`}
            >
              <span className={`today-action-icon is-${item.tone}`}>{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <ArrowRight aria-hidden="true" size={16} />
            </button>
          ))}
        </div>
      </article>

      <DailyReadingCardPanel card={dailyReadingCard} onClick={handleDailyReadingCardClick} />

      <DashboardLocalProgressPanel progress={localProgress} />

      <section className="dashboard-insight-grid" aria-label="近期阅读摘要">
        <article
          className={`dashboard-profile-card is-persona${overviewPersona.status === "provisional" ? " is-provisional" : ""}${
            overviewPersona.accentTone ? ` is-${overviewPersona.accentTone}` : ""
          }`}
        >
          <div className="dashboard-mini-heading">
            <p className="section-kicker">阅读人格</p>
            <button className="text-button" type="button" onClick={onOpenReadingReview}>
              复盘
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
          {hasMonthlyStatsData ? (
            <>
              {overviewPersona.status === "insufficient" ? (
                <>
                  <div className="dashboard-profile-hero">
                    <div className="dashboard-profile-code-block is-empty" aria-hidden="true">
                      <span className="dashboard-profile-code">--</span>
                    </div>
                    <div className="dashboard-profile-identity">
                      <strong className="dashboard-profile-title">样本积累中</strong>
                      <p className="dashboard-profile-subtitle">继续积累本月阅读样本</p>
                    </div>
                  </div>
                  <p className="dashboard-profile-summary">{overviewPersonaSnapshot}</p>
                </>
              ) : (
                <>
                  <div className="dashboard-profile-hero">
                    {overviewPersonaVisual ? (
                      <div className="dashboard-profile-visual-card" aria-label={overviewPersonaVisual.ariaLabel}>
                        <PersonaIllustration visual={overviewPersonaVisual} />
                        <span className="dashboard-profile-code-pill">{overviewPersona.code ?? "阅读"}</span>
                      </div>
                    ) : (
                      <div className="dashboard-profile-code-block" aria-label={`${overviewPersona.code ?? "阅读"} 人格代码`}>
                        <span className="dashboard-profile-code">{overviewPersona.code ?? "--"}</span>
                      </div>
                    )}
                    <div className="dashboard-profile-identity">
                      <strong className="dashboard-profile-title">{overviewPersona.label}</strong>
                      {overviewPersonaDimensions.length > 0 ? (
                        <div className="dashboard-profile-dimensions is-compact" aria-label="阅读人格维度">
                          {overviewPersonaDimensions.map((dimension) => (
                            <span
                              key={`${dimension.axis}-${dimension.key}`}
                              className="dashboard-profile-dimension"
                              title={dimension.basis}
                            >
                              <b>{dimension.key}</b>
                              <span>{dimension.label}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <p className="dashboard-profile-summary">{overviewPersonaSnapshot}</p>
                </>
              )}
              <div className="dashboard-profile-footer">
                <div className="dashboard-profile-chip-row" aria-label="阅读人格状态">
                  <span className="dashboard-profile-badge">基于本地</span>
                  <span className="dashboard-profile-badge">
                    {formatDashboardPersonaBadge(overviewPersona)}
                  </span>
                </div>
                <p className="dashboard-profile-footnote">
                  阅读风格隐喻，不代表真实心理人格。
                </p>
              </div>
            </>
          ) : (
            <p>
              {statsError
                ? formatDashboardErrorText(statsError)
                : "同步统计后，这里会生成最近一个月的阅读人格。"}
            </p>
          )}
        </article>

        <article className="dashboard-next-review-card" aria-label="下周期建议">
          <div className="dashboard-mini-heading">
            <p className="section-kicker">下周期建议</p>
            <span>{reviewActions.length > 0 ? "缓存" : "待生成"}</span>
            <button className="text-button" type="button" onClick={onOpenReadingReview}>
              查看完整复盘
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
          {reviewActions.length > 0 ? (
            <ul className="dashboard-next-action-list">
              {reviewActions.map((action: string) => (
                <li key={action}>
                  <Sparkles aria-hidden="true" size={15} />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{reviewSuggestionError ? "复盘缓存暂不可用" : "生成月度复盘后，这里会显示 2-3 条下一步建议。"}</p>
          )}
        </article>

        <article className="dashboard-recommend-card">
          <div className="dashboard-mini-heading">
            <p className="section-kicker">推荐书籍</p>
            <span>{recommendationSource === "remote" ? "推荐" : "候选"}</span>
            <button className="text-button" type="button" onClick={onOpenDiscovery}>
              发现
              <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
          {dashboardRecommendations.length > 0 ? (
            <div className="dashboard-recommend-covers">
              {dashboardRecommendations.map((book) => (
                <button key={book.bookId} type="button" onClick={() => onOpenCandidateBook(book)} aria-label={`打开《${book.title}》详情`}>
                  {book.cover ? <img src={book.cover} alt="" /> : <BookOpen aria-hidden="true" size={22} />}
                </button>
              ))}
            </div>
          ) : (
            <p>还没有候选书或推荐缓存。</p>
          )}
        </article>
      </section>

      <article className="dashboard-queue-panel" aria-label="本地阅读队列">
        <div className="activity-heading">
          <div>
            <p className="section-kicker">本地队列</p>
            <h3>继续读、待复盘和候选书</h3>
            <p>只读取本机缓存和本地整理状态，不写回微信读书。</p>
          </div>
          <span>{continueItems.length + reviewItems.length + candidateItems.length} 项</span>
        </div>

        {readingStateError ? (
          <StatusMessage
            tone="error"
            icon={<AlertCircle aria-hidden="true" size={18} />}
            text={readingStateError}
          />
        ) : null}

        <div className="dashboard-queue-grid">
          <DashboardQueueColumn title="继续读" count={continueItems.length} items={continueItems} emptyText={isLoading ? "正在读取书架缓存。" : "暂无最近阅读的电子书。"} emptyActionLabel="查看书架" onEmptyAction={onOpenBookshelf} />
          <DashboardQueueColumn
            title="待复盘"
            count={reviewItems.length}
            items={reviewItems}
            emptyText={
              isLoadingReadingStates
                ? "正在读取本地整理状态。"
                : "暂无本地待复盘书籍，可在详情页标记或先同步笔记。"
            }
            emptyActionLabel="查看笔记"
            onEmptyAction={onOpenNotes}
          />
          <DashboardQueueColumn
            title="本地候选"
            count={candidateItems.length}
            items={candidateItems}
            emptyText={
              isLoadingReadingStates
                ? "正在读取本地候选。"
                : "暂无候选书，可在发现页搜索后保存。"
            }
            emptyActionLabel="去发现"
            onEmptyAction={onOpenDiscovery}
          />
        </div>
      </article>

      <article className="activity-panel">
        <div className="activity-heading">
          <div>
            <p className="section-kicker">继续阅读</p>
            <h3>{hasShelfData ? "最近打开的内容" : "还没有书架数据"}</h3>
          </div>
          <button className="sync-button" type="button" onClick={onSync} disabled={!hasCredential || isSyncing}>
            <RefreshCw aria-hidden="true" size={18} className={isSyncing ? "spin" : ""} />
            <span>{isSyncing ? "同步中" : "同步书架"}</span>
          </button>
        </div>

        {error ? (
          <StatusMessage tone="error" icon={<AlertCircle aria-hidden="true" size={18} />} text={formatDashboardErrorText(error)} />
        ) : null}

        {!hasCredential ? (
          <StatusMessage
            tone="warning"
            icon={<KeyRound aria-hidden="true" size={18} />}
            text="先保存 API Key，再把微信读书里的书架、笔记和统计同步到本机。"
          />
        ) : null}

        {hasCredential && !hasShelfData && !error ? (
          <StatusMessage
            tone="neutral"
            icon={<Database aria-hidden="true" size={18} />}
            text="当前还没有本地书架缓存。点击同步后会写入书架数据和同步状态。"
          />
        ) : null}

        {hasShelfData ? (
          <>
            <div className="shelf-breakdown" aria-label="书架分类">
              <span>电子书 {summary?.bookCount ?? 0}</span>
              <span>有声书 {summary?.albumCount ?? 0}</span>
              <span>文章收藏 {summary?.mpCount ?? 0}</span>
            </div>
            <div className="dashboard-recent-list" aria-label="最近阅读内容">
              {recentEntries.length > 0 ? (
                recentEntries.map((entry) => (
                  <button
                    key={entry.id}
                    className="dashboard-recent-item"
                    type="button"
                    onClick={() => onOpenShelfEntry(entry)}
                  >
                    <span className="dashboard-recent-cover">
                      {entry.cover ? <img src={entry.cover} alt="" /> : <BookOpen aria-hidden="true" size={20} />}
                    </span>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{formatRecentMeta(entry)}</small>
                    </span>
                    <ArrowRight aria-hidden="true" size={16} />
                  </button>
                ))
              ) : (
                <StatusMessage
                  tone="neutral"
                  icon={<BookOpen aria-hidden="true" size={18} />}
                  text="本地书架里还没有可继续推进的电子书，可以先从书架打开一本书建立阅读节奏。"
                />
              )}
            </div>
          </>
        ) : null}

        <button className="secondary-action" type="button" onClick={onOpenBookshelf}>
          <Library aria-hidden="true" size={18} />
          查看书架
        </button>
      </article>
    </section>
  );
}

function buildContinueItems(
  entries: RecentBookEntry[],
  onOpenShelfEntry: (entry: ShelfEntry) => void
): DashboardQueueItem[] {
  return entries.slice(0, 3).map((entry) => ({
    id: entry.id,
    subjectKey: subjectKey("book", entry.id),
    title: entry.title,
    meta: formatRecentMeta(entry),
    cover: entry.cover,
    icon: <BookOpen aria-hidden="true" size={18} />,
    actionLabel: "打开",
    onClick: () => onOpenShelfEntry(entry)
  }));
}

function buildReviewItems({
  readingStates,
  notesBooks,
  shelfEntryMap,
  notesBookMap,
  onOpenShelfEntry,
  onOpenBookNotes,
  onOpenReadingReview
}: {
  readingStates: ReadingItemState[];
  notesBooks: NotebookBook[];
  shelfEntryMap: Map<string, ShelfEntry>;
  notesBookMap: Map<string, NotebookBook>;
  onOpenShelfEntry: (entry: ShelfEntry) => void;
  onOpenBookNotes: (book: NotebookBook) => void;
  onOpenReadingReview: () => void;
}): DashboardQueueItem[] {
  const localReviewStates = readingStates
    .filter((state) => state.itemType === "book" && state.status === "reviewing")
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  const localReviewIds = new Set(localReviewStates.map((state) => state.itemId));
  const organizedBookIds = new Set(
    readingStates
      .filter((state) => state.itemType === "book" && state.status === "organized")
      .map((state) => state.itemId)
  );
  const excludedReviewBookIds = new Set([...localReviewIds, ...organizedBookIds]);
  const localItems = localReviewStates.map((state) => {
    const notesBook = notesBookMap.get(state.itemId);
    const shelfEntry = shelfEntryMap.get(state.itemId);
    const title = state.title || notesBook?.title || shelfEntry?.title || "未命名书籍";
    const cover = state.cover || notesBook?.cover || shelfEntry?.cover;
    const author = state.author || notesBook?.author || shelfEntry?.author;
    const meta = notesBook
      ? `${notesBook.reviewCount} 条想法 · ${calculateTotalNotes(notesBook)} 条笔记`
      : [author, state.note || "本地标记待复盘"].filter(Boolean).join(" · ");

    return {
      id: `review-state-${state.itemId}`,
      subjectKey: subjectKey(state.itemType, state.itemId),
      title,
      meta,
      cover,
      icon: <Sparkles aria-hidden="true" size={18} />,
      actionLabel: notesBook ? "看笔记" : shelfEntry ? "详情" : "复盘",
      onClick: () => {
        if (notesBook) {
          onOpenBookNotes(notesBook);
          return;
        }

        if (shelfEntry) {
          onOpenShelfEntry(shelfEntry);
          return;
        }

        onOpenReadingReview();
      }
    };
  });
  const notesItems = getNotebookReviewCandidates(notesBooks, excludedReviewBookIds).map((book) => ({
    id: `review-notes-${book.bookId}`,
    subjectKey: subjectKey("book", book.bookId),
    title: book.title,
    meta: `${book.reviewCount} 条想法 · ${calculateTotalNotes(book)} 条笔记`,
    cover: book.cover,
    icon: <BookMarked aria-hidden="true" size={18} />,
    actionLabel: "看笔记",
    onClick: () => onOpenBookNotes(book)
  }));

  return [...localItems, ...notesItems].slice(0, 3);
}

function getNotebookReviewCandidates(books: NotebookBook[], excludedBookIds: Set<string>): NotebookBook[] {
  return [...books]
    .filter((book) => calculateTotalNotes(book) > 0 && !excludedBookIds.has(book.bookId))
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
    .slice(0, 2);
}

function buildCandidateItems(
  readingStates: ReadingItemState[],
  onOpenCandidateBook: (book: SearchResult) => void
): DashboardQueueItem[] {
  return readingStates
    .filter((state) => state.itemType === "candidate" && state.status === "toRead")
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
    .slice(0, 3)
    .map((state) => {
      const book = mapCandidateStateToSearchResult(state);
      return {
        id: `candidate-${state.itemId}`,
        subjectKey: subjectKey("candidate", state.itemId),
        title: book.title,
        meta: [book.author, book.category, "发现页保存"].filter(Boolean).join(" · "),
        cover: book.cover,
        icon: <Compass aria-hidden="true" size={18} />,
        actionLabel: "详情",
        onClick: () => onOpenCandidateBook(book)
      };
    });
}

function buildCandidateRecommendations(items: DashboardQueueItem[]): SearchResult[] {
  return items.slice(0, 6).map((item) => ({
    bookId: item.id.replace(/^candidate-/, ""),
    title: item.title,
    cover: item.cover
  }));
}

function mapCandidateStateToSearchResult(state: ReadingItemState): SearchResult {
  return {
    bookId: state.itemId,
    title: state.title || "未命名候选书",
    author: state.author,
    cover: state.cover,
    category: state.category
  };
}

function getRecentEntries(entries: ShelfEntry[]): RecentBookEntry[] {
  return entries
    .filter(isBookEntry)
    .sort((left, right) => (right.lastReadAt ?? 0) - (left.lastReadAt ?? 0))
    .slice(0, 3);
}

function buildTodayActions({
  hasCredential,
  hasShelfData,
  hasAiCredential,
  recentEntries,
  reviewItem,
  reviewItems = reviewItem ? [reviewItem] : [],
  candidateItem,
  candidateItems = candidateItem ? [candidateItem] : [],
  bookDecisionResponse,
  reviewActions = [],
  summary,
  shelfEntries = [],
  onOpenBookshelf,
  onOpenNotes,
  onOpenReadingReview,
  onOpenDiscovery,
  onOpenSettings,
  onOpenShelfEntry,
  onOpenReadingRoute,
  onOpenBookDecision
}: {
  hasCredential: boolean;
  hasShelfData: boolean;
  hasAiCredential?: boolean;
  recentEntries: RecentBookEntry[];
  reviewItem?: DashboardQueueItem;
  reviewItems?: DashboardQueueItem[];
  candidateItem?: DashboardQueueItem;
  candidateItems?: DashboardQueueItem[];
  bookDecisionResponse?: BookDecisionResponse;
  reviewActions?: string[];
  summary?: BookshelfResponse["snapshot"]["summary"];
  shelfEntries?: ShelfEntry[];
  onOpenBookshelf: () => void;
  onOpenNotes: () => void;
  onOpenReadingReview: () => void;
  onOpenDiscovery: () => void;
  onOpenSettings: () => void;
  onOpenShelfEntry: (entry: ShelfEntry) => void;
  onOpenReadingRoute: (entry: ShelfEntry) => void;
  onOpenBookDecision: () => void;
}): TodayAction[] {
  if (!hasCredential) {
    return [
      {
        title: "先连接微信读书",
        description: "保存 API Key 后，才能把书架、笔记和统计同步到本机。",
        tone: "gold",
        icon: <KeyRound aria-hidden="true" size={18} />,
        onClick: onOpenSettings
      }
    ];
  }

  if (!hasShelfData) {
    return [
      {
        title: "同步书架缓存",
        description: "先同步微信读书数据，再整理复盘、候选和导出内容。",
        tone: "green",
        icon: <RefreshCw aria-hidden="true" size={18} />,
        onClick: onOpenBookshelf
      }
    ];
  }

  const latestBook = recentEntries[0];
  const weightedActions: WeightedTodayAction[] = [];

  if (latestBook) {
    weightedActions.push({
      title: `继续看《${latestBook.title}》`,
      description: `${formatRecentMeta(latestBook)} · 继续推进这本书的阅读现场`,
      tone: "green",
      icon: <BookOpen aria-hidden="true" size={18} />,
      onClick: () => onOpenShelfEntry(latestBook),
      weight: 100,
      subjectKey: subjectKey("book", latestBook.id),
      actionKey: "continue-reading"
    });
  } else {
    const firstBook = shelfEntries.find((entry): entry is ShelfEntry & { type: "book" } => entry.type === "book");
    if (firstBook) {
      weightedActions.push({
        title: `打开《${firstBook.title}》阅读指南`,
        description: "没有最近阅读记录，先用本书指南明确下一步阅读和整理方式。",
        tone: "green",
        icon: <BookMarked aria-hidden="true" size={18} />,
        onClick: () => onOpenReadingRoute(firstBook),
        weight: 96,
        subjectKey: subjectKey("book", firstBook.id),
        actionKey: "reading-route"
      });
    } else {
      weightedActions.push({
        title: "从书架选一本书",
        description: `${summary?.bookCount ?? 0} 本电子书可作为下一步入口。`,
        tone: "green",
        icon: <Library aria-hidden="true" size={18} />,
        onClick: onOpenBookshelf,
        weight: 95,
        actionKey: "open-bookshelf"
      });
    }
  }

  for (const item of reviewItems) {
    weightedActions.push({
      title: `复盘《${item.title}》`,
      description: `${item.meta} · 把本书笔记整理成结构化复盘`,
      tone: "gold",
      icon: <Sparkles aria-hidden="true" size={18} />,
      onClick: item.onClick,
      weight: 90,
      subjectKey: item.subjectKey,
      actionKey: `review-${item.id}`
    });
  }

  if (reviewItems.length === 0) {
    weightedActions.push({
      title: "去笔记中心同步笔记",
      description: "先同步有划线和想法的书，再挑出适合整理成复盘的内容。",
      tone: "blue",
      icon: <BookMarked aria-hidden="true" size={18} />,
      onClick: onOpenNotes,
      weight: 84,
      actionKey: "sync-notes"
    });
  }

  const topDecision = bookDecisionResponse?.decision.topCandidates[0];
  if (topDecision) {
    weightedActions.push({
      title: `执行选书决策：${topDecision.title}`,
      description: topDecision.prerequisiteAction || bookDecisionResponse.decision.nextActions[0] || "回到选书决策结果，确认下一本书。",
      tone: "blue",
      icon: <Compass aria-hidden="true" size={18} />,
      onClick: onOpenBookDecision,
      weight: 88,
      subjectKey: subjectKey("candidate", topDecision.bookId),
      actionKey: "book-decision"
    });
  }

  for (const item of candidateItems) {
    weightedActions.push({
      title: `查看候选《${item.title}》`,
      description: `${item.meta} · 需要时再进入候选书架做下一本取舍`,
      tone: "blue",
      icon: <Compass aria-hidden="true" size={18} />,
      onClick: item.onClick,
      weight: 80,
      subjectKey: item.subjectKey,
      actionKey: `candidate-${item.id}`
    });
  }

  if (candidateItems.length === 0) {
    weightedActions.push({
      title: "去发现页保存候选",
      description: "先保存候选书，再用候选书架生成选书决策。",
      tone: "muted",
      icon: <Compass aria-hidden="true" size={18} />,
      onClick: onOpenDiscovery,
      weight: 76,
      actionKey: "save-candidate"
    });
  }

  if (reviewItems.length > 0) {
    if (hasAiCredential === false) {
      weightedActions.push({
        title: "配置 AI Provider",
        description: "生成复盘、指南、统计解读或选书决策前，先在本机保存 Provider 和 Key。",
        tone: "gold",
        icon: <KeyRound aria-hidden="true" size={18} />,
        onClick: onOpenSettings,
        weight: 86,
        actionKey: "configure-ai"
      });
    } else {
      weightedActions.push({
        title: "查看书籍复盘",
        description: "查看已生成的阅读报告，或处理有笔记但还没整理的书。",
        tone: "gold",
        icon: <Sparkles aria-hidden="true" size={18} />,
        onClick: onOpenReadingReview,
        weight: 70,
        actionKey: "reading-review"
      });
    }
  }

  const nextStatsAction = reviewActions[0];
  if (nextStatsAction) {
    weightedActions.push({
      title: "执行统计建议",
      description: `${nextStatsAction} · 来自已生成的周期阅读复盘`,
      tone: "gold",
      icon: <BarChart3 aria-hidden="true" size={18} />,
      onClick: onOpenReadingReview,
      weight: 82,
      actionKey: "stats-next-action"
    });
  }

  return selectTodayActions(weightedActions);
}

function selectTodayActions(actions: WeightedTodayAction[]): TodayAction[] {
  const selectedSubjects = new Set<string>();
  const selectedKeys = new Set<string>();

  return [...actions]
    .sort((left, right) => right.weight - left.weight)
    .filter((action) => {
      if (selectedKeys.has(action.actionKey)) {
        return false;
      }

      if (action.subjectKey && selectedSubjects.has(action.subjectKey)) {
        return false;
      }

      selectedKeys.add(action.actionKey);
      if (action.subjectKey) {
        selectedSubjects.add(action.subjectKey);
      }

      return true;
    })
    .slice(0, 5)
    .map(({ weight: _weight, subjectKey: _subjectKey, actionKey: _actionKey, ...action }) => action);
}

function subjectKey(type: ReadingItemState["itemType"] | ShelfEntry["type"], id: string): string {
  return type === "book" ? `book:${id}` : `${type}:${id}`;
}

function isBookEntry(entry: ShelfEntry): entry is RecentBookEntry {
  return entry.type === "book" && typeof entry.lastReadAt === "number" && entry.lastReadAt > 0;
}

function formatRecentMeta(entry: RecentBookEntry): string {
  const parts = [
    entry.author,
    entry.category,
    formatUnixDate(entry.lastReadAt)
  ].filter(Boolean);

  return parts.join(" · ") || "电子书";
}

function formatDashboardPersonaBadge(persona: ReadingPersona): string {
  if (persona.status === "insufficient") {
    return "待稳定";
  }

  return persona.status === "provisional" ? "本月倾向" : "本月";
}

function buildDashboardPersonaSnapshot(persona: ReadingPersona, stats?: ReadingStats): string {
  if (persona.status === "insufficient") {
    return "先继续积累本月阅读样本，再生成稳定的人格判断。";
  }

  const topCategory = stats?.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];
  const topCategoryTitle = topCategory?.title?.trim();
  const energyKey = persona.dimensions.find((item) => item.axis === "energy")?.key;
  const lifestyleKey = persona.dimensions.find((item) => item.axis === "lifestyle")?.key;

  if (topCategoryTitle && energyKey === "I" && lifestyleKey === "J") {
    return `本月更偏向围绕${topCategoryTitle}主线稳定深读。`;
  }

  if (topCategoryTitle && energyKey === "I") {
    return `本月更偏向围绕${topCategoryTitle}主线持续推进。`;
  }

  if (topCategoryTitle && lifestyleKey === "J") {
    return `本月更偏向围绕${topCategoryTitle}主线稳定推进。`;
  }

  if (topCategoryTitle) {
    return `本月更偏向围绕${topCategoryTitle}主线展开阅读。`;
  }

  return persona.status === "provisional"
    ? "这段时间已经出现较清晰的阅读倾向。"
    : "本月已经形成较稳定的阅读气质。";
}

function categoryValue(category: NonNullable<ReadingStats["categories"]>[number]): number {
  return category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0;
}

function DailyReadingCardPanel({ card, onClick }: { card: DailyReadingCard; onClick: () => void }) {
  return (
    <article className={`daily-reading-card is-${card.tone}`} aria-label="今日卡片">
      <div className="daily-reading-card-copy">
        <p className="section-kicker">今日卡片</p>
        <h3>{card.title}</h3>
        <p>{card.body}</p>
      </div>
      <footer>
        <span>{card.sourceLabel}</span>
        <button type="button" onClick={onClick}>
          {card.actionLabel}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </article>
  );
}

function DashboardLocalProgressPanel({ progress }: { progress: DashboardLocalProgress }) {
  return (
    <article className="dashboard-local-progress-card" aria-label="本地进展">
      <div className="dashboard-local-progress-heading">
        <div>
          <p className="section-kicker">本地进展</p>
          <h3>{progress.title}</h3>
          <p>{progress.subtitle}</p>
        </div>
        <span>{progress.badge}</span>
      </div>

      <div className="dashboard-local-progress-grid" aria-label="本地进展指标">
        {progress.metrics.map((metric) => (
          <div className={`dashboard-local-progress-metric is-${metric.tone}`} key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>

      <div className={`dashboard-local-progress-highlight is-${progress.highlight.tone}`}>
        <CheckCircle2 aria-hidden="true" size={18} />
        <div>
          <strong>{progress.highlight.title}</strong>
          <p>{progress.highlight.body}</p>
        </div>
      </div>
    </article>
  );
}

function DailyWorkbenchPanel({
  primaryAction,
  secondaryActions
}: {
  primaryAction?: DailyWorkbenchAction;
  secondaryActions: DailyWorkbenchAction[];
}) {
  return (
    <article className="daily-workbench-panel" aria-label="今日阅读工作台">
      <div className="daily-workbench-heading">
        <div>
          <p className="section-kicker">今日阅读工作台</p>
          <h3>今日最值得做</h3>
        </div>
        <span>{primaryAction ? formatWorkbenchEffortLabel(primaryAction.effort) : "待确认"}</span>
      </div>

      {primaryAction ? (
        <button
          className={`daily-workbench-primary is-${primaryAction.tone}`}
          type="button"
          onClick={primaryAction.onClick}
          title={`${primaryAction.title}：${primaryAction.reason}；${primaryAction.outcome}`}
        >
          <span className="daily-workbench-verb">{primaryAction.verb}</span>
          <strong>{primaryAction.title}</strong>
          <span className="daily-workbench-detail">
            <b>为什么现在做</b>
            <small>{primaryAction.reason}</small>
          </span>
          <span className="daily-workbench-detail">
            <b>完成后得到</b>
            <small>{primaryAction.outcome}</small>
          </span>
          <ArrowRight aria-hidden="true" size={18} />
        </button>
      ) : (
        <div className="daily-workbench-empty">
          <strong>暂时没有可处理动作</strong>
          <span>同步书架或打开笔记后，这里会显示今天最值得做的一件事。</span>
        </div>
      )}

      {secondaryActions.length > 0 ? (
        <div className="daily-workbench-secondary" aria-label="备选动作">
          {secondaryActions.map((action) => (
            <button
              className="daily-workbench-secondary-item"
              type="button"
              key={action.title}
              onClick={action.onClick}
              title={`${action.title}：${action.reason}`}
            >
              <span>{formatWorkbenchEffortLabel(action.effort)}</span>
              <strong>{action.title}</strong>
              <small>{action.outcome}</small>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatWorkbenchEffortLabel(effort: DailyWorkbenchAction["effort"]): string {
  if (effort === "deep") {
    return "深度 30 分钟";
  }

  if (effort === "setup") {
    return "准备 5 分钟";
  }

  return "轻量 5 分钟";
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div>
        <span>{label}</span>
        <p>{detail}</p>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

function DashboardQueueColumn({
  title,
  count,
  items,
  emptyText,
  emptyActionLabel,
  onEmptyAction
}: {
  title: string;
  count: number;
  items: DashboardQueueItem[];
  emptyText: string;
  emptyActionLabel: string;
  onEmptyAction: () => void;
}) {
  return (
    <section className="dashboard-queue-column" aria-label={title}>
      <div className="dashboard-queue-column-head">
        <strong>{title}</strong>
        <span>{count}</span>
      </div>
      {items.length > 0 ? (
        <div className="dashboard-queue-list">
          {items.map((item) => (
            <button key={item.id} className="dashboard-queue-item" type="button" onClick={item.onClick}>
              <span className="dashboard-queue-cover">
                {item.cover ? <img src={item.cover} alt="" /> : item.icon}
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
              <b>{item.actionLabel}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="dashboard-queue-empty">
          <span>{emptyText}</span>
          <button className="text-button" type="button" onClick={onEmptyAction}>
            {emptyActionLabel}
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </div>
      )}
    </section>
  );
}

function StatusMessage({
  tone,
  icon,
  text
}: {
  tone: "neutral" | "warning" | "error";
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className={`status-message status-message--${tone}`}>
      {icon}
      <span>{text}</span>
    </div>
  );
}

function formatDashboardErrorText(error: CommandErrorInfo): string {
  const message = getCommandErrorMessage(error);
  return error.code === "upgrade_required"
    ? withSkillUpgradePrefix(message)
    : message;
}

function withSkillUpgradePrefix(message: string): string {
  return message.startsWith("微信读书 Skill 需要升级")
    ? message
    : `微信读书 Skill 需要升级：${message}`;
}

function formatSyncDate(value?: string): { value: string; detail: string } {
  if (!value) {
    return { value: "未同步", detail: "等待首次成功同步" };
  }

  const timestamp = Number(value);
  const formatted = formatUnixDate(timestamp);
  const shortDate = formatted?.slice(5);

  return {
    value: shortDate || "已同步",
    detail: formatted ? `${formatted.slice(0, 4)} · 本地同步` : "来自本地同步状态"
  };
}
