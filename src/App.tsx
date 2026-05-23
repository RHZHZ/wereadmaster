import { startTransition, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Bookmark,
  Compass,
  ChevronDown,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Library,
  NotebookPen,
  Settings,
  ShieldCheck,
  Waypoints,
  X,
} from "lucide-react";
import { AppTitleBar } from "./components/AppTitleBar";
import { DashboardPage } from "./pages/DashboardPage";
import { BookshelfPage } from "./pages/BookshelfPage";
import { CandidateBookshelfPage } from "./pages/CandidateBookshelfPage";
import { BookDecisionPage } from "./pages/BookDecisionPage";
import { BookDetailPage } from "./pages/BookDetailPage";
import { NotesPage } from "./pages/NotesPage";
import { BookNotesPage } from "./pages/BookNotesPage";
import { BookAiSummaryPage } from "./pages/BookAiSummaryPage";
import { ReadingRoutePage } from "./pages/ReadingRoutePage";
import { StatisticsPage } from "./pages/StatisticsPage";
import { ReadingHubPage } from "./pages/ReadingHubPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { BookDecisionSession } from "./pages/book-decision-input-model";
import {
  getBookDetail,
  getBookshelf,
  getCommandErrorMessage,
  getCredentialStatus,
  openBookInWeread,
  withSyncTiming,
  syncShelf,
  type BookDetailResponse,
  type BookshelfResponse,
  type NotebookOverviewResponse,
  type ReadingStatsResponse,
} from "./lib/reading-api";
import {
  readUserPreferences,
  writeUserPreferences,
  type UserPreferences,
} from "./lib/preferences";
import type {
  BookNotes,
  CredentialStatus,
  NotebookBook,
  ReadingStatsMode,
  SearchResult,
  ShelfEntry,
  AIAssetVersionDetail,
  PreparedAssetUpdate,
} from "./lib/types";

type ReadingHubTab = "books" | "guides" | "report";
type ShelfTab = "wechat" | "candidate";

type ViewId =
  | "dashboard"
  | "shelf"
  | "candidateShelf"
  | "bookDecision"
  | "bookDetail"
  | "notes"
  | "bookNotes"
  | "bookAiSummary"
  | "readingRoute"
  | "stats"
  | "readingReview"
  | "discovery";

type NavigationId = ViewId | "settings";

type NavigationItem = {
  id: NavigationId;
  label: string;
  description: string;
  icon: LucideIcon;
};

type ReadingReviewSubItem = {
  id: ReadingHubTab;
  label: string;
  description: string;
  icon: LucideIcon;
};

type ShelfSubItem = {
  id: ShelfTab;
  viewId: Extract<ViewId, "shelf" | "candidateShelf">;
  label: string;
  description: string;
  icon: LucideIcon;
};

type SidebarMenuId = "shelf" | "readingReview";

type SidebarMenuState = {
  shelf: boolean;
  readingReview: boolean;
};

const navigationItems: NavigationItem[] = [
  { id: "dashboard", label: "总览", description: "阅读状态", icon: BookOpen },
  { id: "shelf", label: "书架", description: "书籍和听书", icon: Library },
  { id: "notes", label: "笔记", description: "划线和想法", icon: Bookmark },
  { id: "stats", label: "统计", description: "时间和偏好", icon: BarChart3 },
  {
    id: "readingReview",
    label: "复盘",
    description: "AI 阅读报告",
    icon: NotebookPen,
  },
  { id: "discovery", label: "发现", description: "搜索和推荐", icon: Compass },
  { id: "settings", label: "设置", description: "本地数据", icon: Settings },
];

const shelfSubItems: ShelfSubItem[] = [
  {
    id: "wechat",
    viewId: "shelf",
    label: "微信书架",
    description: "同步资产",
    icon: Library,
  },
  {
    id: "candidate",
    viewId: "candidateShelf",
    label: "候选书架",
    description: "本地候选",
    icon: Compass,
  },
];

const readingReviewSubItems: ReadingReviewSubItem[] = [
  { id: "books", label: "书籍复盘", description: "单本复盘", icon: BookOpen },
  { id: "guides", label: "阅读指南", description: "路线资产", icon: Waypoints },
  { id: "report", label: "阅读报告", description: "周期画像", icon: BarChart3 },
];

const SIDEBAR_COLLAPSED_KEY = "wxreadmaster.sidebarCollapsed";

type PreparedAssetBook = {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  category?: string;
};

function extractPreparedRouteCandidateBookIds(detail: AIAssetVersionDetail): string[] | undefined {
  if (detail.feature !== "reading-route") {
    return undefined;
  }

  const currentBookId = detail.readingRoute?.books[0]?.bookId ?? detail.scopeId.match(/^book:([^:]+)/)?.[1];
  const candidateIds = (detail.readingRoute?.books ?? [])
    .map((book) => book.bookId)
    .filter((bookId) => bookId && bookId !== currentBookId);

  return candidateIds.length > 0 ? Array.from(new Set(candidateIds)) : undefined;
}

function getInitialSystemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getInitialPreferences(): UserPreferences {
  return readUserPreferences();
}

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

export function createCollapsedSidebarMenuState(): SidebarMenuState {
  return {
    shelf: false,
    readingReview: false,
  };
}

export function openSidebarMenuState(menu: SidebarMenuId): SidebarMenuState {
  return {
    shelf: menu === "shelf",
    readingReview: menu === "readingReview",
  };
}

export function toggleSidebarMenuState(
  current: SidebarMenuState,
  menu: SidebarMenuId,
): SidebarMenuState {
  const nextOpen = !current[menu];

  if (!nextOpen) {
    return createCollapsedSidebarMenuState();
  }

  return openSidebarMenuState(menu);
}

export function App() {
  const [preferences, setPreferences] = useState(getInitialPreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    getInitialSystemPrefersDark,
  );
  const [activeView, setActiveView] = useState<ViewId>(
    preferences.defaultStartPage,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    getInitialSidebarCollapsed,
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>();
  const [bookshelf, setBookshelf] = useState<BookshelfResponse>();
  const [detailEntry, setDetailEntry] = useState<ShelfEntry>();
  const [detailBackView, setDetailBackView] = useState<
    "dashboard" | "shelf" | "candidateShelf" | "bookDecision" | "discovery"
  >("shelf");
  const [discoverySeedBook, setDiscoverySeedBook] = useState<SearchResult>();
  const [discoveryInitialQuery, setDiscoveryInitialQuery] = useState<{
    keyword: string;
    nonce: number;
  }>();
  const [bookDetailCache, setBookDetailCache] = useState<
    Record<string, BookDetailResponse>
  >({});
  const [notesOverview, setNotesOverview] =
    useState<NotebookOverviewResponse>();
  const [bookNotesCache, setBookNotesCache] = useState<
    Record<string, BookNotes>
  >({});
  const [readingStatsCache, setReadingStatsCache] = useState<
    Partial<Record<ReadingStatsMode, ReadingStatsResponse>>
  >({});
  const [bookDecisionSession, setBookDecisionSession] =
    useState<BookDecisionSession>();
  const [selectedNotebookBook, setSelectedNotebookBook] =
    useState<NotebookBook>();
  const [bookNotesBackView, setBookNotesBackView] = useState<
    "bookDetail" | "notes"
  >("notes");
  const [bookAiBackView, setBookAiBackView] = useState<
    "bookDetail" | "bookNotes" | "readingReview"
  >("bookNotes");
  const [preparedAssetUpdateIntent, setPreparedAssetUpdateIntent] =
    useState<PreparedAssetUpdate>();
  const [readingHubTab, setReadingHubTab] = useState<ReadingHubTab>("books");
  const [sidebarMenuState, setSidebarMenuState] = useState(
    createCollapsedSidebarMenuState,
  );
  const [bookDetail, setBookDetail] = useState<BookDetailResponse>();
  const [bookReloadKey, setBookReloadKey] = useState(0);
  const [isBookLoading, setIsBookLoading] = useState(false);
  const [isOpeningBook, setIsOpeningBook] = useState(false);
  const [bookError, setBookError] = useState<string>();
  const [bookLinkMessage, setBookLinkMessage] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const activeDetailEntry = detailEntry;
  const effectiveTheme =
    preferences.themeMode === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : preferences.themeMode;
  const activeItem =
    activeView === "bookDetail"
      ? {
          label: "书籍详情",
          description: activeDetailEntry?.title ?? "阅读进度",
          icon: BookOpen,
        }
      : activeView === "bookNotes" ||
          activeView === "bookAiSummary" ||
          activeView === "readingRoute"
        ? {
            label:
              activeView === "bookAiSummary"
                ? "AI 复盘"
                : activeView === "readingRoute"
                  ? "本书阅读指南"
                  : "单本笔记",
            description: selectedNotebookBook?.title ?? "划线和想法",
            icon: Bookmark,
          }
        : activeView === "readingReview"
          ? (readingReviewSubItems.find((item) => item.id === readingHubTab) ??
            readingReviewSubItems[0])
          : activeView === "candidateShelf"
            ? (shelfSubItems.find((item) => item.viewId === "candidateShelf") ??
              navigationItems[1])
            : activeView === "bookDecision"
              ? {
                  label: "选书决策",
                  description: "候选取舍",
                  icon: Compass,
                }
            : (navigationItems.find((item) => item.id === activeView) ??
              navigationItems[0]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialState() {
      setIsLoading(true);
      setCommandError(undefined);

      const [credentialResult, bookshelfResult] = await Promise.allSettled([
        withSyncTiming("getCredentialStatus", () => getCredentialStatus()),
        withSyncTiming("getBookshelf", () => getBookshelf()),
      ]);

      if (!isMounted) {
        return;
      }

      if (credentialResult.status === "fulfilled") {
        setCredentialStatus(credentialResult.value);
      } else {
        setCommandError(getCommandErrorMessage(credentialResult.reason));
      }

      if (bookshelfResult.status === "fulfilled") {
        startTransition(() => {
          setBookshelf(bookshelfResult.value);
        });
      } else {
        setCommandError(getCommandErrorMessage(bookshelfResult.reason));
      }

      setIsLoading(false);
    }

    void loadInitialState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_KEY,
      String(isSidebarCollapsed),
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemPrefersDark(query.matches);

    handleChange();
    query.addEventListener("change", handleChange);

    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, []);

  function handlePreferencesChange(nextPreferences: UserPreferences) {
    const normalized = writeUserPreferences(
      window.localStorage,
      nextPreferences,
    );
    setPreferences(normalized);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadBookDetail() {
      if (activeView !== "bookDetail" || activeDetailEntry?.type !== "book") {
        return;
      }

      setIsBookLoading(true);
      setBookError(undefined);
      setBookLinkMessage(undefined);

      const cached = bookDetailCache[activeDetailEntry.id];
      if (cached && bookReloadKey === 0) {
        setBookDetail(cached);
        setIsBookLoading(false);
        return;
      }

      setBookDetail(undefined);

      try {
        const response = await getBookDetail(activeDetailEntry.id);
        if (isMounted) {
          setBookDetail(response);
          setBookDetailCache((current) => ({
            ...current,
            [activeDetailEntry.id]: response,
          }));
          setBookReloadKey(0);
        }
      } catch (error) {
        if (isMounted) {
          setBookError(getCommandErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsBookLoading(false);
        }
      }
    }

    void loadBookDetail();

    return () => {
      isMounted = false;
    };
  }, [
    activeView,
    activeDetailEntry?.id,
    activeDetailEntry?.type,
    bookReloadKey,
    bookDetailCache,
  ]);

  function handleNavigate(nextView: ViewId) {
    if (nextView !== "bookAiSummary" && nextView !== "readingRoute") {
      setPreparedAssetUpdateIntent(undefined);
    }

    setIsMobileSidebarOpen(false);
    setSidebarMenuState(createCollapsedSidebarMenuState());
    startTransition(() => {
      setActiveView(nextView);
    });
  }

  function handleOpenSettings() {
    setIsMobileSidebarOpen(false);
    setSidebarMenuState(createCollapsedSidebarMenuState());
    setIsSettingsOpen(true);
  }

  function handleOpenReadingReviewTab(tab: ReadingHubTab) {
    setIsMobileSidebarOpen(false);
    setSidebarMenuState(openSidebarMenuState("readingReview"));
    startTransition(() => {
      setReadingHubTab(tab);
      setActiveView("readingReview");
    });
  }

  function handleOpenShelfTab(tab: ShelfTab) {
    const item =
      shelfSubItems.find((subItem) => subItem.id === tab) ?? shelfSubItems[0];
    setIsMobileSidebarOpen(false);
    setSidebarMenuState(openSidebarMenuState("shelf"));
    startTransition(() => {
      setActiveView(item.viewId);
    });
  }

  async function handleSyncShelf() {
    if (credentialStatus?.hasCredential !== true) {
      setCommandError("请先在设置中保存微信读书 API Key，再同步书架。");
      handleOpenSettings();
      return;
    }

    setIsSyncing(true);
    setCommandError(undefined);

    try {
      const response = await withSyncTiming("syncShelf", () => syncShelf());
      startTransition(() => {
        setBookshelf(response);
      });
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleOpenBookDetail(entry: ShelfEntry) {
    setDetailEntry(entry);
    setDetailBackView("shelf");
    if (entry.type !== "book") {
      return;
    }

    startTransition(() => {
      setActiveView("bookDetail");
    });
  }

  function handleOpenReadingRouteForShelfEntry(entry: ShelfEntry) {
    if (entry.type !== "book") {
      return;
    }

    setDetailEntry(entry);
    setDetailBackView("dashboard");
    startTransition(() => {
      setActiveView("readingRoute");
    });
  }

  function handleOpenDiscoveredBook(book: SearchResult) {
    setDetailEntry({
      id: book.bookId,
      type: "book",
      title: book.title,
      author: book.author,
      cover: book.cover,
      category: book.category,
      isTop: false,
      isSecret: false,
      raw: book,
    });
    setDetailBackView("discovery");
    startTransition(() => {
      setActiveView("bookDetail");
    });
  }

  function handleOpenCandidateShelfBook(book: SearchResult) {
    setDetailEntry({
      id: book.bookId,
      type: "book",
      title: book.title,
      author: book.author,
      cover: book.cover,
      category: book.category,
      isTop: false,
      isSecret: false,
      raw: book,
    });
    setDetailBackView("candidateShelf");
    startTransition(() => {
      setActiveView("bookDetail");
    });
  }

  function handleBookDecisionGenerated(session: BookDecisionSession) {
    setBookDecisionSession(session);
    setSidebarMenuState(openSidebarMenuState("shelf"));
    startTransition(() => {
      setActiveView("bookDecision");
    });
  }

  function handleFindSimilarFromDetail() {
    if (!bookDetail?.detail.bookId) {
      return;
    }

    setDiscoverySeedBook({
      bookId: bookDetail.detail.bookId,
      title: bookDetail.detail.title,
      author: bookDetail.detail.author,
      cover: bookDetail.detail.cover,
      intro: bookDetail.detail.intro,
      category: bookDetail.detail.category,
      publisher: bookDetail.detail.publisher,
      ratingPercent: bookDetail.detail.ratingPercent,
      ratingCount: bookDetail.detail.ratingCount,
    });
    startTransition(() => {
      setActiveView("discovery");
    });
  }

  function handleSearchShelfEntryInDiscovery(entry: ShelfEntry) {
    setDiscoverySeedBook(undefined);
    setDiscoveryInitialQuery({ keyword: entry.title, nonce: Date.now() });
    startTransition(() => {
      setActiveView("discovery");
    });
  }

  function handleOpenBookNotes(book: NotebookBook) {
    setSelectedNotebookBook(book);
    setBookNotesBackView("notes");
    startTransition(() => {
      setActiveView("bookNotes");
    });
  }

  function handleOpenBookNotesFromDetail() {
    const detail = bookDetail?.detail;
    const bookId = detail?.bookId ?? activeDetailEntry?.id;
    if (!bookId) {
      return;
    }

    setSelectedNotebookBook({
      bookId,
      title: detail?.title ?? activeDetailEntry?.title ?? "未命名书籍",
      author: detail?.author ?? activeDetailEntry?.author,
      cover: detail?.cover ?? activeDetailEntry?.cover,
      reviewCount: 0,
      noteCount: 0,
      bookmarkCount: 0,
      totalNoteCount: 0,
      readingProgress: bookDetail?.progress.progressPercent,
    });
    setBookNotesBackView("bookDetail");
    startTransition(() => {
      setActiveView("bookNotes");
    });
  }

  function handleOpenBookAiSummary(bookId: string, notes: BookNotes) {
    setPreparedAssetUpdateIntent(undefined);
    setBookNotesCache((current) => ({
      ...current,
      [bookId]: notes,
    }));
    setSelectedNotebookBook(notes.book ?? selectedNotebookBook);
    setBookAiBackView("bookNotes");
    startTransition(() => {
      setActiveView("bookAiSummary");
    });
  }

  function handleOpenBookAiSummaryFromDetail() {
    setPreparedAssetUpdateIntent(undefined);
    const detail = bookDetail?.detail;
    const bookId = detail?.bookId ?? activeDetailEntry?.id;
    if (!bookId) {
      return;
    }

    setSelectedNotebookBook({
      bookId,
      title: detail?.title ?? activeDetailEntry?.title ?? "未命名书籍",
      author: detail?.author ?? activeDetailEntry?.author,
      cover: detail?.cover ?? activeDetailEntry?.cover,
      reviewCount: 0,
      noteCount: 1,
      bookmarkCount: 0,
      totalNoteCount: 1,
      readingProgress: bookDetail?.progress.progressPercent,
    });
    setBookAiBackView("bookDetail");
    startTransition(() => {
      setActiveView("bookAiSummary");
    });
  }

  function handleOpenReadingRouteFromDetail() {
    setPreparedAssetUpdateIntent(undefined);
    if (!bookDetail?.detail.bookId && !activeDetailEntry?.id) {
      return;
    }

    startTransition(() => {
      setActiveView("readingRoute");
    });
  }

  function handleOpenBookAiSummaryFromHub(book: NotebookBook) {
    setPreparedAssetUpdateIntent(undefined);
    setSelectedNotebookBook(book);
    setBookAiBackView("readingReview");
    startTransition(() => {
      setActiveView("bookAiSummary");
    });
  }

  function handlePrepareAssetUpdate(detail: AIAssetVersionDetail, book: PreparedAssetBook) {
    setPreparedAssetUpdateIntent({
      feature: detail.feature,
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      candidateBookIds: extractPreparedRouteCandidateBookIds(detail),
      versionTitle: detail.title,
      promptVersion: detail.promptVersion,
      generatedAt: detail.generatedAt,
      scopeId: detail.scopeId,
      inputHash: detail.inputHash,
    });

    setSelectedNotebookBook({
      bookId: book.bookId,
      title: book.title,
      author: book.author,
      cover: book.cover,
      reviewCount: 0,
      noteCount: detail.feature === "book-review" ? 1 : 0,
      bookmarkCount: 0,
      totalNoteCount: detail.feature === "book-review" ? 1 : 0,
      readingProgress: detail.progress,
    });

    setDetailEntry({
      id: book.bookId,
      type: "book",
      title: book.title,
      author: book.author,
      cover: book.cover,
      category: book.category,
      isTop: false,
      isSecret: false,
    });
    setBookAiBackView("readingReview");

    startTransition(() => {
      setActiveView(detail.feature === "book-review" ? "bookAiSummary" : "readingRoute");
    });
  }

  function handleCredentialChange(status: CredentialStatus) {
    setCredentialStatus(status);
    if (!status.hasCredential) {
      setBookDetailCache({});
      setNotesOverview(undefined);
      setBookNotesCache({});
      setReadingStatsCache({});
      setSelectedNotebookBook(undefined);
    }
  }

  function handleLocalCacheCleared() {
    setBookshelf(undefined);
    setDetailEntry(undefined);
    setBookDetail(undefined);
    setBookDetailCache({});
    setNotesOverview(undefined);
    setBookNotesCache({});
    setReadingStatsCache({});
    setSelectedNotebookBook(undefined);
  }

  function handleBookNotesChange(bookId: string, notes: BookNotes) {
    setBookNotesCache((current) => ({
      ...current,
      [bookId]: notes,
    }));
  }

  function handleReadingStatsChange(
    mode: ReadingStatsMode,
    response: ReadingStatsResponse,
  ) {
    setReadingStatsCache((current) => ({
      ...current,
      [mode]: response,
    }));
  }

  async function handleOpenBookInWeread(chapterUid?: number) {
    const bookId = bookDetail?.detail.bookId ?? activeDetailEntry?.id;
    if (!bookId) {
      return;
    }

    setIsOpeningBook(true);
    setBookLinkMessage(undefined);

    try {
      const result = await openBookInWeread(bookId, chapterUid);
      if (!result.opened) {
        setBookLinkMessage(
          result.message ||
            "无法打开微信读书，请确认本机已安装微信读书客户端。",
        );
      }
    } catch (error) {
      setBookLinkMessage(getCommandErrorMessage(error));
    } finally {
      setIsOpeningBook(false);
    }
  }

  return (
    <div
      className={`app-frame ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${
        isMobileSidebarOpen ? "mobile-sidebar-open" : ""
      }`}
      data-theme={preferences.themeMode}
      data-effective-theme={effectiveTheme}
      data-font-scale={preferences.fontScale}
      data-density={preferences.density}
    >
      <AppTitleBar />
      <button
        className="sidebar-scrim"
        type="button"
        aria-label="关闭主导航"
        onClick={() => setIsMobileSidebarOpen(false)}
      />
      <aside className="sidebar" id="app-sidebar" aria-label="主导航">
        <div className="brand-row">
          <div className="brand">
            <div className="brand-mark">阅</div>
            <div className="brand-copy">
              <p className="brand-kicker">阅读资产</p>
              <h1>个人阅读管理</h1>
            </div>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={isSidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={18} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={18} />
            )}
          </button>
          <button
            className="mobile-sidebar-close"
            type="button"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label="关闭主导航"
            title="关闭主导航"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isShelfContext =
              activeView === "shelf" ||
              activeView === "candidateShelf" ||
              activeView === "bookDecision" ||
              (activeView === "bookDetail" &&
                (detailBackView === "candidateShelf" ||
                  detailBackView === "bookDecision"));
            const showShelfSublist =
              item.id === "shelf" && sidebarMenuState.shelf;
            const isReadingReviewContext =
              activeView === "readingReview" ||
              (activeView === "bookAiSummary" &&
                bookAiBackView === "readingReview");
            const showReadingReviewSublist =
              item.id === "readingReview" &&
              sidebarMenuState.readingReview;
            const isActive =
              item.id === activeView ||
              (item.id === "shelf" && isShelfContext) ||
              (item.id === "notes" &&
                (activeView === "bookNotes" ||
                  (activeView === "bookAiSummary" &&
                    bookAiBackView === "bookNotes"))) ||
              (item.id === "readingReview" && isReadingReviewContext);

            return (
              <div
                key={item.id}
                className={`nav-group ${item.id === "readingReview" || item.id === "shelf" ? "has-children" : ""}`}
              >
                <button
                  type="button"
                  className={`nav-item ${isActive ? "is-active" : ""} ${
                    item.id === "readingReview" || item.id === "shelf"
                      ? "has-disclosure"
                      : ""
                  }`}
                  onClick={() => {
                    if (item.id === "shelf") {
                      setSidebarMenuState((current) =>
                        toggleSidebarMenuState(current, "shelf"),
                      );
                      return;
                    }

                    if (item.id === "readingReview") {
                      setSidebarMenuState((current) =>
                        toggleSidebarMenuState(current, "readingReview"),
                      );
                      return;
                    }

                    if (item.id === "settings") {
                      handleOpenSettings();
                      return;
                    }

                    handleNavigate(item.id);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  aria-expanded={
                    item.id === "readingReview"
                      ? showReadingReviewSublist
                      : item.id === "shelf"
                        ? showShelfSublist
                        : undefined
                  }
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  {item.id === "readingReview" || item.id === "shelf" ? (
                    <ChevronDown
                      aria-hidden="true"
                      className="nav-disclosure"
                      size={16}
                    />
                  ) : null}
                </button>

                {showShelfSublist ? (
                  <div className="nav-sublist" aria-label="书架子菜单">
                    {shelfSubItems.map((subItem) => {
                      const SubIcon = subItem.icon;
                      const isSubActive =
                        activeView === subItem.viewId ||
                        (activeView === "bookDetail" &&
                          detailBackView === subItem.viewId) ||
                        (subItem.viewId === "candidateShelf" &&
                          activeView === "bookDecision");

                      return (
                        <button
                          key={subItem.id}
                          type="button"
                          className={`nav-subitem ${isSubActive ? "is-active" : ""}`}
                          onClick={() => handleOpenShelfTab(subItem.id)}
                          aria-current={isSubActive ? "page" : undefined}
                          aria-label={subItem.label}
                          title={subItem.label}
                        >
                          <SubIcon
                            aria-hidden="true"
                            size={17}
                            strokeWidth={1.8}
                          />
                          <span>
                            <strong>{subItem.label}</strong>
                            <small>{subItem.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {showReadingReviewSublist ? (
                  <div className="nav-sublist" aria-label="复盘子菜单">
                    {readingReviewSubItems.map((subItem) => {
                      const SubIcon = subItem.icon;
                      const isSubActive =
                        isReadingReviewContext &&
                        (activeView === "bookAiSummary"
                          ? subItem.id === "books"
                          : readingHubTab === subItem.id);

                      return (
                        <button
                          key={subItem.id}
                          type="button"
                          className={`nav-subitem ${isSubActive ? "is-active" : ""}`}
                          onClick={() => handleOpenReadingReviewTab(subItem.id)}
                          aria-current={isSubActive ? "page" : undefined}
                          aria-label={subItem.label}
                          title={subItem.label}
                        >
                          <SubIcon
                            aria-hidden="true"
                            size={17}
                            strokeWidth={1.8}
                          />
                          <span>
                            <strong>{subItem.label}</strong>
                            <small>{subItem.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="privacy-note">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>API Key 和阅读数据只保存在本机。</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="mobile-sidebar-trigger"
            type="button"
            aria-label="打开主导航"
            aria-controls="app-sidebar"
            aria-expanded={isMobileSidebarOpen}
            onClick={() => setIsMobileSidebarOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <div className="topbar-title">
            <p className="section-kicker">{activeItem.description}</p>
            <h2>{activeItem.label}</h2>
          </div>
        </header>

        {activeView === "dashboard" ? (
          <DashboardPage
            credentialStatus={credentialStatus}
            bookshelf={bookshelf}
            isLoading={isLoading}
            isSyncing={isSyncing}
            error={commandError}
            onSync={handleSyncShelf}
            onOpenBookshelf={() => handleNavigate("shelf")}
            onOpenNotes={() => handleNavigate("notes")}
            onOpenReadingReview={() => handleOpenReadingReviewTab("report")}
            onOpenDiscovery={() => handleNavigate("discovery")}
            onOpenShelfEntry={handleOpenBookDetail}
            onOpenBookNotes={handleOpenBookNotes}
            onOpenCandidateBook={handleOpenDiscoveredBook}
            onOpenSettings={handleOpenSettings}
            onOpenReadingRoute={handleOpenReadingRouteForShelfEntry}
            bookDecisionSession={bookDecisionSession}
            onOpenBookDecision={() => handleNavigate("bookDecision")}
            notesOverview={notesOverview}
            readingStatsCache={readingStatsCache}
            onReadingStatsCacheChange={handleReadingStatsChange}
          />
        ) : null}
        {activeView === "shelf" ? (
          <BookshelfPage
            credentialStatus={credentialStatus}
            bookshelf={bookshelf}
            isLoading={isLoading}
            isSyncing={isSyncing}
            error={commandError}
            onSync={handleSyncShelf}
            onOpenSettings={handleOpenSettings}
            onOpenDetail={handleOpenBookDetail}
            onSearchInDiscovery={handleSearchShelfEntryInDiscovery}
          />
        ) : null}
        {activeView === "candidateShelf" ? (
          <CandidateBookshelfPage
            credentialStatus={credentialStatus}
            bookshelf={bookshelf}
            readingStatsCache={readingStatsCache}
            onOpenSettings={handleOpenSettings}
            onOpenDiscovery={() => handleNavigate("discovery")}
            onOpenBookDetail={handleOpenCandidateShelfBook}
            onBookDecisionGenerated={handleBookDecisionGenerated}
          />
        ) : null}
        {activeView === "bookDecision" ? (
          <BookDecisionPage
            bookshelf={bookshelf}
            readingStatsCache={readingStatsCache}
            session={bookDecisionSession}
            onSessionChange={handleBookDecisionGenerated}
            onBack={() => handleNavigate("candidateShelf")}
          />
        ) : null}
        {activeView === "bookDetail" ? (
          <BookDetailPage
            shelfEntry={activeDetailEntry}
            detailResponse={bookDetail}
            isLoading={isBookLoading}
            isOpening={isOpeningBook}
            error={bookError}
            linkMessage={bookLinkMessage}
            backLabel={
              detailBackView === "discovery"
                ? "返回发现"
                : detailBackView === "candidateShelf"
                  ? "返回候选书架"
                  : detailBackView === "bookDecision"
                    ? "返回选书决策"
                    : detailBackView === "dashboard"
                      ? "返回总览"
                  : "返回书架"
            }
            onBack={() => handleNavigate(detailBackView)}
            onRetry={() => {
              setBookReloadKey((current) => current + 1);
            }}
            onOpenBook={() => void handleOpenBookInWeread()}
            onOpenChapter={(chapterUid) =>
              void handleOpenBookInWeread(chapterUid)
            }
            onOpenNotes={handleOpenBookNotesFromDetail}
            onOpenAiSummary={handleOpenBookAiSummaryFromDetail}
            onFindSimilar={handleFindSimilarFromDetail}
            onOpenReadingRoute={handleOpenReadingRouteFromDetail}
          />
        ) : null}
        {activeView === "notes" ? (
          <NotesPage
            credentialStatus={credentialStatus}
            overview={notesOverview}
            onOverviewChange={setNotesOverview}
            onOpenSettings={handleOpenSettings}
            onOpenBookNotes={handleOpenBookNotes}
          />
        ) : null}
        {activeView === "bookNotes" ? (
          <BookNotesPage
            book={selectedNotebookBook}
            bookId={selectedNotebookBook?.bookId}
            cachedNotes={
              selectedNotebookBook?.bookId
                ? bookNotesCache[selectedNotebookBook.bookId]
                : undefined
            }
            onNotesChange={handleBookNotesChange}
            onOpenAiSummary={handleOpenBookAiSummary}
            onBack={() => handleNavigate(bookNotesBackView)}
            backLabel={
              bookNotesBackView === "bookDetail" ? "返回书籍详情" : undefined
            }
            defaultViewMode={preferences.defaultNotesView}
          />
        ) : null}
        {activeView === "bookAiSummary" ? (
          <BookAiSummaryPage
            book={selectedNotebookBook}
            bookId={selectedNotebookBook?.bookId}
            notes={
              selectedNotebookBook?.bookId
                ? bookNotesCache[selectedNotebookBook.bookId]
                : undefined
            }
            onOpenSettings={handleOpenSettings}
            onBack={() => handleNavigate(bookAiBackView)}
            preparedUpdate={
              preparedAssetUpdateIntent?.feature === "book-review" ? preparedAssetUpdateIntent : undefined
            }
            backLabel={
              bookAiBackView === "readingReview"
                ? "返回复盘中心"
                : bookAiBackView === "bookDetail"
                  ? "返回书籍详情"
                  : "返回单本笔记"
            }
          />
        ) : null}
        {activeView === "readingRoute" ? (
          <ReadingRoutePage
            shelfEntry={activeDetailEntry}
            detail={bookDetail?.detail}
            progress={bookDetail?.progress}
            preparedUpdate={
              preparedAssetUpdateIntent?.feature === "reading-route" ? preparedAssetUpdateIntent : undefined
            }
            onBack={() => handleNavigate("bookDetail")}
            onOpenSettings={handleOpenSettings}
            onOpenDiscovery={() => handleNavigate("discovery")}
          />
        ) : null}
        {activeView === "stats" ? (
          <StatisticsPage
            credentialStatus={credentialStatus}
            cache={readingStatsCache}
            onCacheChange={handleReadingStatsChange}
            onOpenSettings={handleOpenSettings}
            onOpenReview={() => {
              setReadingHubTab("report");
              handleNavigate("readingReview");
            }}
            defaultMode={preferences.defaultStatsPeriod}
          />
        ) : null}
        {activeView === "readingReview" ? (
          <ReadingHubPage
            credentialStatus={credentialStatus}
            cache={readingStatsCache}
            onCacheChange={handleReadingStatsChange}
            onOpenSettings={handleOpenSettings}
            activeTab={readingHubTab}
            onOpenBookSummary={handleOpenBookAiSummaryFromHub}
            onPrepareAssetUpdate={handlePrepareAssetUpdate}
            onOpenNotes={() => handleNavigate("notes")}
            notesOverview={notesOverview}
            onNotesOverviewChange={setNotesOverview}
          />
        ) : null}
        {activeView === "discovery" ? (
          <DiscoveryPage
            credentialStatus={credentialStatus}
            bookshelf={bookshelf}
            readingStatsCache={readingStatsCache}
            seedBook={discoverySeedBook}
            initialQuery={discoveryInitialQuery}
            onOpenSettings={handleOpenSettings}
            onOpenBookDetail={handleOpenDiscoveredBook}
            onOpenCandidateShelf={() => handleNavigate("candidateShelf")}
            onClearSeedBook={() => setDiscoverySeedBook(undefined)}
            onClearInitialQuery={() => setDiscoveryInitialQuery(undefined)}
          />
        ) : null}
      </main>
      <SettingsPage
        open={isSettingsOpen}
        credentialStatus={credentialStatus}
        onCredentialChange={handleCredentialChange}
        onLocalCacheCleared={handleLocalCacheCleared}
        preferences={preferences}
        onPreferencesChange={handlePreferencesChange}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
