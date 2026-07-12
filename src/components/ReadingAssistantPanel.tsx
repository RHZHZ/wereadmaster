import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Database,
  History,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import {
  askReadingAssistantStream,
  cancelReadingAssistantStream,
  clearReadingAssistantHistory,
  getAiSettingsState,
  getCommandErrorMessage,
  getReadingAssistantPreferences,
  getReadingAssistantThread,
  listReadingItemStates,
  listReadingAssistantThreads,
  listenReadingAssistantStream,
  saveReadingAssistantPreferences,
  searchBooks,
  upsertReadingItemState
} from "../lib/reading-api";
import {
  buildAiRecommendationCandidateNote,
  buildAiRecommendedCandidateId,
  buildConfirmedAiRecommendationCandidateNote,
  buildRecommendedBookSearchKeyword,
  dedupeRecommendedBookSearchResults,
  findExistingCandidateState,
  findExistingReadingItemStateById,
  recommendedBookKey,
} from "../lib/reading-assistant-recommendations";
import {
  parseReadingAssistantMarkdownLite,
  type ReadingAssistantMarkdownBlock,
  type ReadingAssistantMarkdownInline
} from "../lib/reading-assistant-markdown-lite";
import type {
  AiResponseFormatPolicy,
  AiSettingsState,
  AssistantContextScope,
  ReadingAssistantActionOutput,
  ReadingAssistantAnswer,
  ReadingAssistantContextOption,
  ReadingAssistantMessage,
  ReadingAssistantPreferences,
  ReadingAssistantRecommendedBook,
  ReadingAssistantWereadSearchResult,
  ReadingAssistantThreadSummary,
  ReadingAssistantUsedContext,
  SearchResult
} from "../lib/types";

type ReadingAssistantPanelProps = {
  open: boolean;
  scope: AssistantContextScope;
  entityId?: string;
  initialDraft?: string;
  initialDraftNonce?: number;
  onCandidateAdded?: () => void;
  onOpenCandidateShelf?: () => void;
  onOpenBookReview?: (bookId: string, title?: string, author?: string) => void;
  onOpenBookDetail?: (bookId: string) => void;
  canOpenBookDetail?: (bookId: string) => boolean;
  onOpenAiSettings?: () => void;
  onClose: () => void;
};

type ReadingAssistantLauncherProps = {
  onOpen: () => void;
};

type ReadingAssistantPanelView = "chat" | "history" | "settings";
type ReadingAssistantHistoryScopeFilter = "all" | AssistantContextScope;

type ReadingAssistantCurrentEntityFilter = {
  scope: AssistantContextScope;
  entityId: string;
};

type LocalAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "answered" | "failed";
  suggestions: string[];
  usedContext: ReadingAssistantUsedContext[];
  recommendedBooks: ReadingAssistantRecommendedBook[];
  action?: ReadingAssistantActionOutput;
};

type ReadingAssistantBookReviewActionPayload = Extract<
  ReadingAssistantActionOutput,
  { type: "bookReview" }
>["payload"];

type ReadingAssistantBookReviewActionProps = {
  action: ReadingAssistantBookReviewActionPayload;
  onOpenBookReview?: (bookId: string, title?: string, author?: string) => void;
};

type ReadingAssistantCategoryBooksActionPayload = Extract<
  ReadingAssistantActionOutput,
  { type: "categoryBooks" }
>["payload"];

type ReadingAssistantCategoryBooksActionProps = {
  action: ReadingAssistantCategoryBooksActionPayload;
  onOpenBookDetail?: (bookId: string) => void;
  canOpenBookDetail?: (bookId: string) => boolean;
};

type EditingUserMessageState = {
  messageId: string;
  originalContent: string;
  draftContent: string;
};

type RecommendedBookCandidateState =
  | "available"
  | "adding"
  | "added"
  | "exists"
  | "inLibrary"
  | "failed";
type RecommendedBookSearchStatus = "idle" | "searching" | "found" | "notFound" | "failed";

type RecommendedBookSearchState = {
  status: RecommendedBookSearchStatus;
  results: SearchResult[];
  errorMessage?: string;
};

export type ReadingAssistantRecommendedBookCardProps = {
  book: ReadingAssistantRecommendedBook;
  candidateState?: RecommendedBookCandidateState;
  searchState?: RecommendedBookSearchState;
  onSearchBook?: (book: ReadingAssistantRecommendedBook) => void;
  onAddBook?: (book: ReadingAssistantRecommendedBook) => void;
  onOpenCandidateShelf?: () => void;
  onAddSearchResultCandidate?: (
    book: ReadingAssistantRecommendedBook,
    result: SearchResult
  ) => void;
};

const DEFAULT_PREFERENCES: ReadingAssistantPreferences = {
  usePersonalizedContext: true,
  useReadingMemory: true,
  allowRawBookNotes: false,
  saveConversationHistory: true
};

const CONTEXT_LABELS: Record<ReadingAssistantContextOption, string> = {
  currentBook: "当前书",
  bookNotesSummary: "复盘摘要",
  rawBookNotes: "原始笔记",
  readingStats: "阅读统计",
  readingPersona: "阅读画像",
  candidateBooks: "候选书",
  bookExclusionList: "排除书目",
  aiAssetSummary: "阅读记忆",
  conversationHistory: "最近对话",
  readingMemory: "阅读记忆"
};

const SCOPE_TITLES: Record<AssistantContextScope, string> = {
  global: "阅读助手",
  bookDetail: "问问这本书",
  bookNotes: "问问笔记",
  readingStats: "问问统计",
  candidateShelf: "问问候选书",
  aiAsset: "追问 AI 资产",
  localReaderSelection: "选区问答"
};

const HISTORY_SCOPE_FILTERS: Array<{
  value: ReadingAssistantHistoryScopeFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "global", label: "全局" },
  { value: "bookDetail", label: "书籍" },
  { value: "bookNotes", label: "笔记" },
  { value: "readingStats", label: "统计" },
  { value: "candidateShelf", label: "候选" },
  { value: "aiAsset", label: "AI 资产" },
  { value: "localReaderSelection", label: "本地选区" }
];

const PROVIDER_PRESET_LABELS: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  dashscope: "DashScope",
  moonshot: "Moonshot",
  custom: "自定义"
};

const RESPONSE_FORMAT_POLICY_LABELS: Record<AiResponseFormatPolicy, string> = {
  auto: "自动",
  jsonSchemaFirst: "严格结构化",
  jsonObjectFirst: "JSON 模式",
  noResponseFormatFirst: "宽松模式"
};

const COMPACT_RESPONSE_FORMAT_POLICY_LABELS: Record<AiResponseFormatPolicy, string> = {
  auto: "自动",
  jsonSchemaFirst: "Schema",
  jsonObjectFirst: "JSON",
  noResponseFormatFirst: "宽松"
};

export function ReadingAssistantLauncher({ onOpen }: ReadingAssistantLauncherProps) {
  return (
    <button
      className="reading-assistant-launcher"
      type="button"
      onClick={onOpen}
      aria-label="打开 AI 阅读助手"
      title="AI 阅读助手"
    >
      <Bot aria-hidden="true" size={20} />
    </button>
  );
}

export function ReadingAssistantBookReviewAction({
  action,
  onOpenBookReview
}: ReadingAssistantBookReviewActionProps) {
  return (
    <div className="reading-assistant-book-review-action">
      <span className="reading-assistant-search-results-title">{action.message}</span>
      <div className="reading-assistant-book-review-target">
        <strong>{action.title}</strong>
        {action.author ? <small>{action.author}</small> : null}
      </div>
      {onOpenBookReview ? (
        <button
          className="text-button reading-assistant-book-review-button"
          type="button"
          onClick={() => onOpenBookReview(action.bookId, action.title, action.author)}
        >
          <Sparkles aria-hidden="true" size={14} />
          {action.ctaLabel || "生成 AI 复盘"}
        </button>
      ) : null}
    </div>
  );
}

export function ReadingAssistantCategoryBooksAction({
  action,
  onOpenBookDetail,
  canOpenBookDetail
}: ReadingAssistantCategoryBooksActionProps) {
  return (
    <div className="reading-assistant-category-books-action">
      <span className="reading-assistant-search-results-title">
        {action.categoryLabel} · 本地可列 {action.listedCount} 本
        {action.totalStatCount !== undefined ? ` / 统计 ${action.totalStatCount} 本` : ""}
      </span>
      {action.matchedCategoryTitles.length > 0 ? (
        <div className="reading-assistant-category-books-tags">
          {action.matchedCategoryTitles.map((title) => (
            <small key={title}>{title}</small>
          ))}
        </div>
      ) : null}
      {action.books.length > 0 ? (
        <div className="reading-assistant-category-books-list">
          {action.books.map((book) => {
            const bookId = book.bookId;
            const bookKey = bookId ?? `${book.title}-${book.author ?? ""}-${book.category ?? ""}`;
            const canOpen = Boolean(
              onOpenBookDetail &&
                bookId &&
                (canOpenBookDetail ? canOpenBookDetail(bookId) : true)
            );
            const content = (
              <>
                <BookOpen aria-hidden="true" size={16} />
                <span>
                  <strong>{book.title}</strong>
                  <small>
                    {[
                      book.author,
                      book.category,
                      book.isFinished ? "已读完" : undefined,
                      book.progressPercent !== undefined ? `${book.progressPercent}%` : undefined,
                      book.readingTimeText,
                      book.source
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </>
            );

            return canOpen ? (
              <button
                className="reading-assistant-category-book is-clickable"
                key={bookKey}
                type="button"
                onClick={() => {
                  if (bookId) {
                    onOpenBookDetail?.(bookId);
                  }
                }}
              >
                {content}
              </button>
            ) : (
              <div className="reading-assistant-category-book" key={bookKey}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="reading-assistant-search-status">
          当前没有可列出的本地明细，统计总数不会被展开成伪书名。
        </p>
      )}
      {action.totalStatReadingTimeText ? (
        <small className="reading-assistant-stats-footnote">
          统计阅读时长 {action.totalStatReadingTimeText}
        </small>
      ) : null}
    </div>
  );
}

export function ReadingAssistantRecommendedBookCard({
  book,
  candidateState = "available",
  searchState = { status: "idle", results: [] },
  onSearchBook,
  onAddBook,
  onOpenCandidateShelf,
  onAddSearchResultCandidate
}: ReadingAssistantRecommendedBookCardProps) {
  const isDone =
    candidateState === "added" ||
    candidateState === "exists" ||
    candidateState === "inLibrary";
  const isAdding = candidateState === "adding";
  const isSearching = searchState.status === "searching";
  const sections = [
    { label: "为什么推荐", content: book.reason },
    { label: "适合你", content: book.fit },
    { label: "取舍", content: book.risk }
  ].filter((section) => section.content.trim());

  return (
    <div className="reading-assistant-recommendation-item">
      <div className="reading-assistant-recommendation-heading">
        <span>
          <strong>{book.title}</strong>
          {book.author ? <small>{book.author}</small> : null}
        </span>
      </div>

      {sections.length > 0 ? (
        <dl className="reading-assistant-recommendation-body">
          {sections.map((section) => (
            <div className="reading-assistant-recommendation-section" key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.content}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="reading-assistant-recommendation-footer">
        <div className="reading-assistant-recommendation-actions">
          <button
            className="text-button"
            type="button"
            disabled={isSearching || isDone}
            onClick={() => onSearchBook?.(book)}
          >
            {isSearching ? (
              <Loader2 aria-hidden="true" className="spin" size={14} />
            ) : (
              <Search aria-hidden="true" size={14} />
            )}
            {recommendedBookSearchActionLabel(searchState.status)}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={isAdding || isDone}
            onClick={() => onAddBook?.(book)}
          >
            {isAdding ? (
              <Loader2 aria-hidden="true" className="spin" size={14} />
            ) : isDone ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Plus aria-hidden="true" size={14} />
            )}
            {recommendedBookActionLabel(candidateState)}
          </button>
          {(candidateState === "added" || candidateState === "exists") && onOpenCandidateShelf ? (
            <button className="text-button" type="button" onClick={onOpenCandidateShelf}>
              <BookOpen aria-hidden="true" size={14} />
              查看候选
            </button>
          ) : null}
        </div>
      </div>

      <ReadingAssistantRecommendedBookSearchResults
        book={book}
        searchState={searchState}
        disableActions={isAdding || isDone}
        onAddSearchResultCandidate={onAddSearchResultCandidate}
      />
    </div>
  );
}

function ReadingAssistantRecommendedBookSearchResults({
  book,
  searchState,
  disableActions,
  onAddSearchResultCandidate
}: {
  book: ReadingAssistantRecommendedBook;
  searchState: RecommendedBookSearchState;
  disableActions: boolean;
  onAddSearchResultCandidate?: (
    book: ReadingAssistantRecommendedBook,
    result: SearchResult
  ) => void;
}) {
  if (searchState.status === "idle" || searchState.status === "searching") {
    return null;
  }

  if (searchState.status === "notFound") {
    return (
      <p className="reading-assistant-search-status">
        没有找到明确匹配项，可以先保存为本地候选。
      </p>
    );
  }

  if (searchState.status === "failed") {
    return (
      <p className="reading-assistant-search-status is-error">
        {searchState.errorMessage || "搜索失败，可重试或先保存为本地候选。"}
      </p>
    );
  }

  return (
    <div className="reading-assistant-search-results">
      <span className="reading-assistant-search-results-title">选择微信读书匹配项</span>
      {searchState.results.map((result) => (
        <div className="reading-assistant-search-result" key={result.bookId}>
          {result.cover ? (
            <img src={result.cover} alt="" loading="lazy" />
          ) : (
            <span className="reading-assistant-search-result-cover" aria-hidden="true" />
          )}
          <span>
            <strong>{result.title}</strong>
            <small>{[result.author, result.category].filter(Boolean).join(" · ")}</small>
          </span>
          <button
            className="text-button"
            type="button"
            disabled={disableActions}
            onClick={() => onAddSearchResultCandidate?.(book, result)}
          >
            <Check aria-hidden="true" size={14} />
            确认加入
          </button>
        </div>
      ))}
    </div>
  );
}

export function ReadingAssistantPanel({
  open,
  scope,
  entityId,
  initialDraft,
  initialDraftNonce,
  onCandidateAdded,
  onOpenCandidateShelf,
  onOpenBookReview,
  onOpenBookDetail,
  canOpenBookDetail,
  onOpenAiSettings,
  onClose
}: ReadingAssistantPanelProps) {
  const [threadId, setThreadId] = useState<string>();
  const [messages, setMessages] = useState<LocalAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [preferences, setPreferences] =
    useState<ReadingAssistantPreferences>(DEFAULT_PREFERENCES);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const [threads, setThreads] = useState<ReadingAssistantThreadSummary[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsState>();
  const [isLoadingAiSettings, setIsLoadingAiSettings] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyScopeFilter, setHistoryScopeFilter] =
    useState<ReadingAssistantHistoryScopeFilter>("all");
  const [historyCurrentOnly, setHistoryCurrentOnly] = useState(false);
  const [panelView, setPanelView] = useState<ReadingAssistantPanelView>("chat");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string>();
  const [activeStreamId, setActiveStreamId] = useState<string>();
  const [editingUserMessage, setEditingUserMessage] = useState<EditingUserMessageState>();
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [candidateBookStates, setCandidateBookStates] = useState<
    Record<string, RecommendedBookCandidateState>
  >({});
  const [recommendedBookSearchStates, setRecommendedBookSearchStates] = useState<
    Record<string, RecommendedBookSearchState>
  >({});
  const [actionSearchResultStates, setActionSearchResultStates] = useState<
    Record<string, RecommendedBookCandidateState>
  >({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLSpanElement>(null);
  const composerModelRef = useRef<HTMLDivElement>(null);
  const canceledStreamIdsRef = useRef<Set<string>>(new Set());

  const enabledContext = useMemo(
    () => buildEnabledContext(scope, preferences),
    [preferences, scope]
  );
  const promptSuggestions = useMemo(() => suggestionsForScope(scope), [scope]);
  const hasCurrentEntityHistoryFilter = Boolean(entityId && scope !== "global");
  const isCurrentEntityHistoryFilterActive =
    historyCurrentOnly && hasCurrentEntityHistoryFilter;
  const filteredThreads = useMemo(
    () =>
      filterReadingAssistantThreads(
        threads,
        historySearchQuery,
        historyScopeFilter,
        isCurrentEntityHistoryFilterActive && entityId ? { scope, entityId } : undefined
      ),
    [
      entityId,
      historyScopeFilter,
      historySearchQuery,
      isCurrentEntityHistoryFilterActive,
      scope,
      threads
    ]
  );
  const editableUserMessageId = useMemo(
    () => findEditableUserMessageId(messages, isSubmitting),
    [isSubmitting, messages]
  );

  useEffect(() => {
    const draft = initialDraft?.trim();
    if (!open || !draft) {
      return;
    }

    setPanelView("chat");
    setEditingUserMessage(undefined);
    setIsModelMenuOpen(false);
    setInput(draft);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draft.length, draft.length);
    });
  }, [initialDraft, initialDraftNonce, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isCurrent = true;
    setIsLoadingPreferences(true);
    setIsLoadingThreads(true);
    setIsLoadingAiSettings(true);
    getReadingAssistantPreferences()
      .then((nextPreferences) => {
        if (isCurrent) {
          setPreferences(nextPreferences);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setErrorMessage(getCommandErrorMessage(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingPreferences(false);
        }
      });
    listReadingAssistantThreads()
      .then((nextThreads) => {
        if (isCurrent) {
          setThreads(nextThreads);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setErrorMessage(getCommandErrorMessage(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingThreads(false);
        }
      });
    getAiSettingsState()
      .then((nextSettings) => {
        if (isCurrent) {
          setAiSettings(nextSettings);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setErrorMessage(getCommandErrorMessage(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingAiSettings(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [open]);

  useEffect(() => {
    setThreadId(undefined);
    setMessages([]);
    setCandidateBookStates({});
    setRecommendedBookSearchStates({});
    setErrorMessage(undefined);
    setHistorySearchQuery("");
    setHistoryScopeFilter("all");
    setHistoryCurrentOnly(false);
    setEditingUserMessage(undefined);
    setIsModelMenuOpen(false);
    setPanelView("chat");
  }, [entityId, scope]);

  useEffect(() => {
    if (!open) {
      setEditingUserMessage(undefined);
      setIsModelMenuOpen(false);
      setPanelView("chat");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }

      if (isModelMenuOpen) {
        setIsModelMenuOpen(false);
        return;
      }

      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isModelMenuOpen, onClose, open]);

  useEffect(() => {
    if (!open || !isModelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target && composerModelRef.current?.contains(target as Node)) {
        return;
      }

      setIsModelMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isModelMenuOpen, open]);

  useEffect(() => {
    if (panelView !== "chat") {
      setIsModelMenuOpen(false);
    }
  }, [panelView]);

  useEffect(() => {
    if (!open || panelView !== "chat") {
      return;
    }

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
  }, [isSubmitting, messages, open, panelView, threadId]);

  async function updatePreference(nextPreferences: ReadingAssistantPreferences) {
    setPreferences(nextPreferences);
    try {
      const saved = await saveReadingAssistantPreferences(nextPreferences);
      setPreferences(saved);
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    }
  }

  async function refreshThreads() {
    setIsLoadingThreads(true);
    try {
      const nextThreads = await listReadingAssistantThreads();
      setThreads(nextThreads);
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    } finally {
      setIsLoadingThreads(false);
    }
  }

  async function refreshAiSettings() {
    setIsLoadingAiSettings(true);
    try {
      const nextSettings = await getAiSettingsState();
      setAiSettings(nextSettings);
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    } finally {
      setIsLoadingAiSettings(false);
    }
  }

  function handleOpenModelSettings() {
    setIsModelMenuOpen(false);
    if (onOpenAiSettings) {
      onOpenAiSettings();
      return;
    }

    setPanelView("settings");
    void refreshAiSettings();
  }

  async function handleLoadThread(nextThreadId: string) {
    setIsLoadingThreads(true);
    setErrorMessage(undefined);
    try {
      const detail = await getReadingAssistantThread(nextThreadId);
      if (!detail) {
        await refreshThreads();
        return;
      }

      setThreadId(detail.id);
      setMessages(detail.messages.map(localMessageFromThreadMessage));
      setEditingUserMessage(undefined);
      setIsModelMenuOpen(false);
      setPanelView("chat");
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    } finally {
      setIsLoadingThreads(false);
    }
  }

  async function handleClearHistory() {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm("清空 AI 阅读助手的本地对话历史？");
    if (!confirmed) {
      return;
    }

    setIsLoadingThreads(true);
    setErrorMessage(undefined);
    try {
      await clearReadingAssistantHistory();
      setThreadId(undefined);
      setMessages([]);
      setThreads([]);
      setEditingUserMessage(undefined);
      setIsModelMenuOpen(false);
      setPanelView("chat");
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    } finally {
      setIsLoadingThreads(false);
    }
  }

  async function submitReadingAssistantMessage(
    message: string,
    options: { replaceFromMessageId?: string } = {}
  ) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || isSubmitting) {
      return;
    }

    const userMessage: LocalAssistantMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: normalizedMessage,
      status: "answered",
      suggestions: [],
      usedContext: [],
      recommendedBooks: []
    };
    const streamId = `reading-assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const assistantMessageId = `local-assistant-stream-${streamId}`;
    const assistantPendingMessage: LocalAssistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      status: "pending",
      suggestions: [],
      usedContext: [],
      recommendedBooks: []
    };
    setMessages((current) => {
      if (!options.replaceFromMessageId) {
        return [...current, userMessage, assistantPendingMessage];
      }

      const targetIndex = current.findIndex((item) => item.id === options.replaceFromMessageId);
      if (targetIndex < 0) {
        return [...current, userMessage, assistantPendingMessage];
      }

      return [...current.slice(0, targetIndex), userMessage, assistantPendingMessage];
    });
    setErrorMessage(undefined);
    setIsSubmitting(true);
    setStreamingMessageId(assistantMessageId);
    setActiveStreamId(streamId);

    let unlisten: (() => void) | undefined;
    const requestThreadId = threadId;
    const replaceFromMessageId = preferences.saveConversationHistory
      ? options.replaceFromMessageId
      : undefined;
    try {
      unlisten = await listenReadingAssistantStream((event) => {
        if (event.streamId !== streamId) {
          return;
        }

        setMessages((current) =>
          current.map((item) =>
            item.id === assistantMessageId
              ? {
                  ...item,
                  content: event.content
                }
              : item
          )
        );
      });

      const answer = await askReadingAssistantStream(streamId, {
        threadId: requestThreadId,
        scope,
        entityId,
        message: normalizedMessage,
        enabledContext,
        replaceFromMessageId
      });
      if (canceledStreamIdsRef.current.has(streamId)) {
        canceledStreamIdsRef.current.delete(streamId);
        return;
      }

      setThreadId(answer.threadId);
      setMessages((current) =>
        current.map((item) => {
          if (item.id === userMessage.id) {
            return { ...item, id: answer.userMessageId };
          }

          if (item.id === assistantMessageId) {
            return assistantMessageFromAnswer(answer);
          }

          return item;
        })
      );
      if (preferences.saveConversationHistory) {
        void refreshThreads();
      }
    } catch (error) {
      if (canceledStreamIdsRef.current.has(streamId)) {
        canceledStreamIdsRef.current.delete(streamId);
        return;
      }

      const messageText = getCommandErrorMessage(error);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                content: messageText,
                status: "failed",
                suggestions: [],
                usedContext: [],
                recommendedBooks: []
              }
            : item
        )
      );
    } finally {
      unlisten?.();
      setIsSubmitting(false);
      setStreamingMessageId(undefined);
      setActiveStreamId(undefined);
    }
  }

  async function handleSubmit() {
    const message = input.trim();
    if (!message || isSubmitting) {
      return;
    }

    setInput("");
    setEditingUserMessage(undefined);
    setIsModelMenuOpen(false);
    await submitReadingAssistantMessage(message);
  }

  function handleStartEditingUserMessage(message: LocalAssistantMessage) {
    if (message.id !== editableUserMessageId || isSubmitting) {
      return;
    }

    setEditingUserMessage({
      messageId: message.id,
      originalContent: message.content,
      draftContent: message.content
    });
  }

  function handleCancelEditingUserMessage() {
    setEditingUserMessage(undefined);
  }

  async function handleSaveEditedUserMessage() {
    const editing = editingUserMessage;
    const draftContent = editing?.draftContent.trim() ?? "";
    if (!editing || !draftContent || isSubmitting) {
      return;
    }

    setEditingUserMessage(undefined);
    await submitReadingAssistantMessage(draftContent, {
      replaceFromMessageId: editing.messageId
    });
  }

  async function handleCancelSubmit() {
    if (!activeStreamId) {
      return;
    }

    const streamId = activeStreamId;
    canceledStreamIdsRef.current.add(streamId);
    setMessages((current) => current.filter((message) => message.id !== streamingMessageId));
    setIsSubmitting(false);
    setStreamingMessageId(undefined);
    setActiveStreamId(undefined);
    try {
      await cancelReadingAssistantStream(streamId);
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
    }
  }

  function handleUseSuggestion(suggestion: string) {
    setInput(suggestion);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(suggestion.length, suggestion.length);
    });
  }

  async function handleAddRecommendedBook(book: ReadingAssistantRecommendedBook) {
    const bookKey = recommendedBookKey(book);
    setCandidateBookStates((current) => ({ ...current, [bookKey]: "adding" }));
    setErrorMessage(undefined);

    try {
      const states = await listReadingItemStates();
      if (findExistingCandidateState(states, book)) {
        setCandidateBookStates((current) => ({ ...current, [bookKey]: "exists" }));
        return;
      }

      const confirmed =
        typeof window === "undefined" ||
        window.confirm(
          `加入本地候选书架？\n\n《${book.title}》会保存到本地候选书架，用于后续选书决策和阅读路线。\n这不会写入微信读书，也不代表已确认微信读书可用。`
        );
      if (!confirmed) {
        setCandidateBookStates((current) => ({ ...current, [bookKey]: "available" }));
        return;
      }

      await upsertReadingItemState({
        itemId: buildAiRecommendedCandidateId(book),
        itemType: "candidate",
        status: "toRead",
        title: book.title,
        author: book.author || undefined,
        note: buildAiRecommendationCandidateNote(book)
      });
      onCandidateAdded?.();
      setCandidateBookStates((current) => ({ ...current, [bookKey]: "added" }));
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
      setCandidateBookStates((current) => ({ ...current, [bookKey]: "failed" }));
    }
  }

  async function handleSearchRecommendedBook(book: ReadingAssistantRecommendedBook) {
    const bookKey = recommendedBookKey(book);
    const keyword = buildRecommendedBookSearchKeyword(book);
    if (!keyword) {
      setRecommendedBookSearchStates((current) => ({
        ...current,
        [bookKey]: {
          status: "failed",
          results: [],
          errorMessage: "缺少可搜索的书名。"
        }
      }));
      return;
    }

    setRecommendedBookSearchStates((current) => ({
      ...current,
      [bookKey]: { status: "searching", results: [] }
    }));
    setErrorMessage(undefined);

    try {
      const response = await searchBooks({ keyword, scope: 0, count: 5 });
      const results = dedupeRecommendedBookSearchResults(response.result.results, 5);
      setRecommendedBookSearchStates((current) => ({
        ...current,
        [bookKey]: {
          status: results.length > 0 ? "found" : "notFound",
          results
        }
      }));
    } catch (error) {
      setRecommendedBookSearchStates((current) => ({
        ...current,
        [bookKey]: {
          status: "failed",
          results: [],
          errorMessage: getCommandErrorMessage(error)
        }
      }));
    }
  }

  async function handleAddSearchResultCandidate(
    book: ReadingAssistantRecommendedBook,
    result: SearchResult
  ) {
    const bookKey = recommendedBookKey(book);
    setCandidateBookStates((current) => ({ ...current, [bookKey]: "adding" }));
    setErrorMessage(undefined);

    try {
      const states = await listReadingItemStates();
      const existingState = findExistingReadingItemStateById(states, result.bookId);
      if (existingState) {
        const nextState =
          existingState.itemType === "candidate" && existingState.status === "toRead"
            ? "exists"
            : "inLibrary";
        setCandidateBookStates((current) => ({ ...current, [bookKey]: nextState }));
        return;
      }

      const confirmed =
        typeof window === "undefined" ||
        window.confirm(
          `使用微信读书搜索结果加入候选？\n\n《${result.title}》会保存到本地候选书架，用于后续选书决策和阅读路线。\n这不会写入微信读书远端书架。`
        );
      if (!confirmed) {
        setCandidateBookStates((current) => ({ ...current, [bookKey]: "available" }));
        return;
      }

      await upsertReadingItemState({
        itemId: result.bookId,
        itemType: "candidate",
        status: "toRead",
        title: result.title,
        author: result.author,
        cover: result.cover,
        category: result.category,
        note: buildConfirmedAiRecommendationCandidateNote(book)
      });
      onCandidateAdded?.();
      setCandidateBookStates((current) => ({ ...current, [bookKey]: "added" }));
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
      setCandidateBookStates((current) => ({ ...current, [bookKey]: "failed" }));
    }
  }

  async function handleAddWereadSearchResultCandidate(result: ReadingAssistantWereadSearchResult) {
    const resultKey = wereadSearchResultKey(result);
    if (!result.canAddToCandidate) {
      setActionSearchResultStates((current) => ({
        ...current,
        [resultKey]: result.localStatus === "inCandidate" ? "exists" : "inLibrary"
      }));
      return;
    }

    setActionSearchResultStates((current) => ({ ...current, [resultKey]: "adding" }));
    setErrorMessage(undefined);

    try {
      const confirmed =
        typeof window === "undefined" ||
        window.confirm(
          `加入本地候选书架？\n\n《${result.title}》会保存到本地候选书架，用于后续选书决策和阅读路线。\n这不会写入微信读书远端书架。`
        );
      if (!confirmed) {
        setActionSearchResultStates((current) => ({ ...current, [resultKey]: "available" }));
        return;
      }

      await upsertReadingItemState({
        itemId: result.bookId,
        itemType: "candidate",
        status: "toRead",
        title: result.title,
        author: result.author,
        cover: result.cover,
        category: result.category,
        note: "来自 AI 阅读助手微信读书搜索确认。"
      });
      onCandidateAdded?.();
      setActionSearchResultStates((current) => ({ ...current, [resultKey]: "added" }));
    } catch (error) {
      setErrorMessage(getCommandErrorMessage(error));
      setActionSearchResultStates((current) => ({ ...current, [resultKey]: "failed" }));
    }
  }

  function renderHeader() {
    const isChatView = panelView === "chat";
    const title =
      panelView === "history"
        ? "最近对话"
        : panelView === "settings"
          ? "助手设置"
          : SCOPE_TITLES[scope];

    return (
      <header className="reading-assistant-header">
        <div className="reading-assistant-header-title">
          {isChatView ? (
            <>
              <p className="section-kicker">AI 阅读助手</p>
              <h2>{title}</h2>
            </>
          ) : (
            <>
              <button
                className="reading-assistant-back-button"
                type="button"
                onClick={() => setPanelView("chat")}
              >
                <ArrowLeft aria-hidden="true" size={16} />
                返回
              </button>
              <h2>{title}</h2>
            </>
          )}
        </div>
        <div className="reading-assistant-header-actions">
          {isChatView ? (
            <>
              <button
                className="reading-assistant-icon-button"
                type="button"
                onClick={() => setPanelView("history")}
                aria-label="查看最近对话"
                title="最近对话"
              >
                {isLoadingThreads ? (
                  <Loader2 aria-hidden="true" className="spin" size={17} />
                ) : (
                  <History aria-hidden="true" size={17} />
                )}
              </button>
              <button
                className="reading-assistant-icon-button"
                type="button"
                onClick={() => setPanelView("settings")}
                aria-label="打开助手设置"
                title="设置"
              >
                <Settings aria-hidden="true" size={17} />
              </button>
            </>
          ) : null}
          <button
            className="reading-assistant-icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭 AI 阅读助手"
            title="关闭"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
    );
  }

  function renderContextRow() {
    const visibleContext = enabledContext.filter((context) => context !== "conversationHistory");

    if (enabledContext.length > 0 && visibleContext.length === 0) {
      return null;
    }

    return (
      <div className="reading-assistant-context-row" aria-label="本次上下文">
        {visibleContext.length > 0 ? (
          visibleContext.map((context) => (
            <span className="reading-assistant-chip" key={context}>
              <Database aria-hidden="true" size={13} />
              {CONTEXT_LABELS[context]}
            </span>
          ))
        ) : (
          <span className="reading-assistant-chip">
            <ShieldCheck aria-hidden="true" size={13} />
            无个性化上下文
          </span>
        )}
      </div>
    );
  }

  function renderError() {
    return errorMessage ? <p className="reading-assistant-error">{errorMessage}</p> : null;
  }

  function renderComposerModelControl() {
    const providerLabel = aiSettings
      ? aiProviderDisplayLabel(aiSettings)
      : isLoadingAiSettings
        ? "模型"
        : "模型";
    const modelLabel = aiSettings?.provider.model?.trim() || "未设置模型";
    const policy = aiSettings?.provider.responseFormatPolicy ?? "auto";
    const policyLabel = RESPONSE_FORMAT_POLICY_LABELS[policy] ?? RESPONSE_FORMAT_POLICY_LABELS.auto;
    const compactPolicyLabel =
      COMPACT_RESPONSE_FORMAT_POLICY_LABELS[policy] ?? COMPACT_RESPONSE_FORMAT_POLICY_LABELS.auto;
    const hasCredential = aiSettings?.credential.hasCredential ?? false;
    const credentialLabel = aiSettings && !hasCredential ? " · 未配置密钥" : "";
    const metaLabel = aiSettings
      ? `${modelLabel} · ${hasCredential ? compactPolicyLabel : "未配置密钥"}`
      : isLoadingAiSettings
        ? "正在读取模型"
        : "状态暂不可用";
    const title = `${providerLabel} · ${modelLabel} · ${policyLabel}${credentialLabel}`;

    return (
      <div className="reading-assistant-composer-model" ref={composerModelRef}>
        <button
          className="reading-assistant-model-chip"
          type="button"
          onClick={() => setIsModelMenuOpen((current) => !current)}
          aria-haspopup="menu"
          aria-expanded={isModelMenuOpen}
          title={title}
        >
          <span>{providerLabel}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
        <span className="reading-assistant-model-meta" title={title}>
          {metaLabel}
        </span>
        {isModelMenuOpen ? (
          <div className="reading-assistant-model-menu" role="menu" aria-label="当前模型">
            <div className="reading-assistant-model-menu-status">
              <span>当前模型</span>
              <strong>{providerLabel}</strong>
              <small>{modelLabel}</small>
              <small>
                {policyLabel}
                {credentialLabel}
              </small>
            </div>
            <div className="reading-assistant-model-menu-actions">
              <button
                type="button"
                role="menuitem"
                onClick={handleOpenModelSettings}
                disabled={isSubmitting}
              >
                <Settings aria-hidden="true" size={14} />
                模型设置
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void refreshAiSettings()}
                disabled={isSubmitting || isLoadingAiSettings}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={isLoadingAiSettings ? "spin" : ""}
                  size={14}
                />
                刷新状态
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderRecommendedBooks(message: LocalAssistantMessage) {
    if (message.role !== "assistant" || message.recommendedBooks.length === 0) {
      return null;
    }

    return (
      <div className="reading-assistant-recommendation-list">
        {message.recommendedBooks.map((book) => {
          const bookKey = recommendedBookKey(book);
          return (
            <ReadingAssistantRecommendedBookCard
              book={book}
              candidateState={candidateBookStates[bookKey] ?? "available"}
              searchState={recommendedBookSearchStates[bookKey]}
              onSearchBook={(targetBook) => void handleSearchRecommendedBook(targetBook)}
              onAddBook={(targetBook) => void handleAddRecommendedBook(targetBook)}
              onOpenCandidateShelf={onOpenCandidateShelf}
              onAddSearchResultCandidate={(targetBook, result) =>
                void handleAddSearchResultCandidate(targetBook, result)
              }
              key={bookKey}
            />
          );
        })}
      </div>
    );
  }

  function renderAssistantAction(message: LocalAssistantMessage) {
    if (message.role !== "assistant" || !message.action) {
      return null;
    }

    if (message.action.type === "bookReview") {
      return (
        <ReadingAssistantBookReviewAction
          action={message.action.payload}
          onOpenBookReview={onOpenBookReview}
        />
      );
    }

    if (message.action.type === "statsAggregate") {
      const action = message.action.payload;
      return (
        <div className="reading-assistant-stats-action">
          <span className="reading-assistant-search-results-title">{action.rangeLabel}</span>
          <div className="reading-assistant-stats-grid">
            <span>
              <strong>{action.totalReadingTimeText}</strong>
              <small>累计阅读</small>
            </span>
            <span>
              <strong>{action.readDays ?? 0}</strong>
              <small>活跃天数</small>
            </span>
            <span>
              <strong>{action.finishedBookCount}</strong>
              <small>已读完</small>
            </span>
            <span>
              <strong>{action.candidateBookCount}</strong>
              <small>本地候选</small>
            </span>
          </div>
          {action.topCategories.length > 0 ? (
            <div className="reading-assistant-stats-categories">
              <span>分类 Top</span>
              {action.topCategories.map((category) => (
                <small key={category.title}>
                  {category.title} · {category.readingTimeText}
                  {category.readingCount ? ` · ${category.readingCount} 本` : ""}
                </small>
              ))}
            </div>
          ) : null}
          {action.updatedAt ? (
            <small className="reading-assistant-stats-footnote">更新时间 {action.updatedAt}</small>
          ) : null}
        </div>
      );
    }

    if (message.action.type === "categoryBooks") {
      return (
        <ReadingAssistantCategoryBooksAction
          action={message.action.payload}
          onOpenBookDetail={onOpenBookDetail}
          canOpenBookDetail={canOpenBookDetail}
        />
      );
    }

    if (message.action.type !== "wereadSearch") {
      return null;
    }

    const action = message.action.payload;
    return (
      <div className="reading-assistant-search-results">
        <span className="reading-assistant-search-results-title">{action.message}</span>
        {action.results.length === 0 ? (
          <p className="reading-assistant-search-status">
            可以换一个关键词，或使用《书名》重新搜索。
          </p>
        ) : (
          action.results.map((result) => {
            const resultKey = wereadSearchResultKey(result);
            const baseState =
              result.localStatus === "inCandidate"
                ? "exists"
                : result.localStatus === "inLibrary"
                  ? "inLibrary"
                  : "available";
            const state = actionSearchResultStates[resultKey] ?? baseState;
            const isAdding = state === "adding";
            const isDone = state === "added" || state === "exists" || state === "inLibrary";
            return (
              <div className="reading-assistant-search-result" key={result.bookId}>
                {result.cover ? (
                  <img src={result.cover} alt="" loading="lazy" />
                ) : (
                  <span className="reading-assistant-search-result-cover" aria-hidden="true" />
                )}
                <span>
                  <strong>{result.title}</strong>
                  <small>{[result.author, result.category].filter(Boolean).join(" · ")}</small>
                </span>
                <button
                  className="text-button"
                  type="button"
                  disabled={isAdding || isDone || !result.canAddToCandidate}
                  onClick={() => void handleAddWereadSearchResultCandidate(result)}
                >
                  {isAdding ? (
                    <Loader2 aria-hidden="true" className="spin" size={14} />
                  ) : isDone || !result.canAddToCandidate ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <Plus aria-hidden="true" size={14} />
                  )}
                  {state === "inLibrary"
                    ? result.localLabel
                    : state === "available" && !result.canAddToCandidate
                      ? result.localLabel
                      : recommendedBookActionLabel(state)}
                </button>
                {(state === "added" || state === "exists") && onOpenCandidateShelf ? (
                  <button className="text-button" type="button" onClick={onOpenCandidateShelf}>
                    <BookOpen aria-hidden="true" size={14} />
                    查看候选
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    );
  }

  function renderMessageSuggestions(message: LocalAssistantMessage) {
    const suggestions = normalizeMessageSuggestions(message.suggestions);
    if (message.role !== "assistant" || message.status !== "answered" || suggestions.length === 0) {
      return null;
    }

    return (
      <div className="reading-assistant-follow-up-suggestions" aria-label="可继续追问">
        {suggestions.map((suggestion) => (
          <button
            className="text-button"
            type="button"
            key={`${message.id}-${suggestion}`}
            onClick={() => handleUseSuggestion(suggestion)}
          >
            <MessageSquare aria-hidden="true" size={13} />
            {suggestion}
          </button>
        ))}
      </div>
    );
  }

  function renderUserMessage(message: LocalAssistantMessage) {
    const editing =
      editingUserMessage?.messageId === message.id ? editingUserMessage : undefined;

    if (editing) {
      return (
        <div className="reading-assistant-message-edit">
          <textarea
            autoFocus
            value={editing.draftContent}
            onChange={(event) => {
              const draftContent = event.currentTarget.value;
              setEditingUserMessage((current) =>
                current?.messageId === message.id
                  ? { ...current, draftContent }
                  : current
              );
            }}
            rows={3}
          />
          <div className="reading-assistant-message-edit-actions">
            <button
              className="text-button"
              type="button"
              onClick={handleCancelEditingUserMessage}
              disabled={isSubmitting}
            >
              <X aria-hidden="true" size={14} />
              取消
            </button>
            <button
              className="text-button reading-assistant-message-edit-save"
              type="button"
              onClick={() => void handleSaveEditedUserMessage()}
              disabled={!editing.draftContent.trim() || isSubmitting}
            >
              <Check aria-hidden="true" size={14} />
              保存并重新生成
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <p>{message.content}</p>
        {message.id === editableUserMessageId ? (
          <div className="reading-assistant-message-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => handleStartEditingUserMessage(message)}
              disabled={isSubmitting}
              aria-label="编辑这条消息"
              title="编辑这条消息"
            >
              <Pencil aria-hidden="true" size={13} />
              编辑
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function renderChatView() {
    return (
      <div className="reading-assistant-chat-view">
        {renderContextRow()}

        <div className="reading-assistant-messages">
          {messages.length === 0 ? (
            <div className="reading-assistant-empty">
              <MessageSquare aria-hidden="true" size={22} />
              <span>想问点什么？</span>
            </div>
          ) : (
            messages.map((message) => (
              <article
                className={`reading-assistant-message is-${message.role} ${
                  message.status === "failed" ? "is-failed" : ""
                } ${
                  message.status === "pending" ? "is-pending" : ""
                } ${
                  editingUserMessage?.messageId === message.id ? "is-editing" : ""
                }`}
                key={message.id}
              >
                {message.role === "assistant" && message.status !== "failed" ? (
                  message.content ? (
                    <ReadingAssistantMarkdownLite content={message.content} />
                  ) : (
                    <Loader2 aria-hidden="true" className="spin" size={16} />
                  )
                ) : message.role === "user" ? (
                  renderUserMessage(message)
                ) : (
                  <p>{message.content}</p>
                )}
                {renderRecommendedBooks(message)}
                {renderAssistantAction(message)}
                {message.usedContext.length > 0 ? (
                  <div className="reading-assistant-used-context">
                    {message.usedContext.map((context, index) => (
                      <span key={`${message.id}-${context.contextType}-${index}`}>
                        {context.label} · {context.itemCount}
                      </span>
                    ))}
                  </div>
                ) : null}
                {renderMessageSuggestions(message)}
              </article>
            ))
          )}
          {isSubmitting && !streamingMessageId ? (
            <div className="reading-assistant-message is-assistant">
              <Loader2 aria-hidden="true" className="spin" size={16} />
            </div>
          ) : null}
          <span className="reading-assistant-messages-end" ref={messagesEndRef} aria-hidden="true" />
        </div>

        {renderError()}

        {messages.length === 0 ? (
          <div className="reading-assistant-suggestions">
            {promptSuggestions.map((suggestion) => (
              <button
                className="text-button"
                type="button"
                key={suggestion}
                onClick={() => handleUseSuggestion(suggestion)}
              >
                <Sparkles aria-hidden="true" size={13} />
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="reading-assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }

              event.preventDefault();
              void handleSubmit();
            }}
            placeholder={isLoadingPreferences ? "正在读取偏好" : "问一个阅读问题"}
            rows={3}
          />
          <div className="reading-assistant-composer-footer">
            {renderComposerModelControl()}
            <button
              className="reading-assistant-send-button"
              type={isSubmitting ? "button" : "submit"}
              disabled={isSubmitting ? !activeStreamId : !input.trim()}
              onClick={isSubmitting ? () => void handleCancelSubmit() : undefined}
              aria-label={isSubmitting ? "取消生成" : "发送"}
              title={isSubmitting ? "取消生成" : "发送"}
            >
              {isSubmitting ? (
                <X aria-hidden="true" size={16} />
              ) : (
                <Send aria-hidden="true" size={16} />
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  function renderHistoryView() {
    return (
      <div className="reading-assistant-subview reading-assistant-history-view">
        <div className="reading-assistant-subview-toolbar">
          <span className="reading-assistant-subview-meta">
            {filteredThreads.length} / {threads.length} 个会话
          </span>
          <button
            className="text-button reading-assistant-danger-action"
            type="button"
            onClick={() => void handleClearHistory()}
            disabled={threads.length === 0 || isLoadingThreads}
          >
            <Trash2 aria-hidden="true" size={14} />
            清空
          </button>
        </div>

        {renderError()}

        <label className="reading-assistant-history-search">
          <Search aria-hidden="true" size={15} />
          <input
            type="search"
            value={historySearchQuery}
            onChange={(event) => setHistorySearchQuery(event.currentTarget.value)}
            placeholder="搜索标题或场景"
          />
        </label>

        <div className="reading-assistant-history-filters" aria-label="按场景筛选">
          {hasCurrentEntityHistoryFilter ? (
            <button
              className={isCurrentEntityHistoryFilterActive ? "is-active" : ""}
              type="button"
              onClick={() => setHistoryCurrentOnly((current) => !current)}
              aria-pressed={isCurrentEntityHistoryFilterActive}
            >
              当前对象
            </button>
          ) : null}
          {HISTORY_SCOPE_FILTERS.map((item) => (
            <button
              className={item.value === historyScopeFilter ? "is-active" : ""}
              type="button"
              key={item.value}
              onClick={() => setHistoryScopeFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="reading-assistant-thread-list reading-assistant-thread-list--full">
          {isLoadingThreads ? (
            <span className="reading-assistant-thread-empty">
              <Loader2 aria-hidden="true" className="spin" size={14} />
              正在读取历史
            </span>
          ) : filteredThreads.length > 0 ? (
            filteredThreads.map((thread) => (
              <button
                className={thread.id === threadId ? "is-active" : ""}
                type="button"
                key={thread.id}
                onClick={() => void handleLoadThread(thread.id)}
              >
                <span>{thread.title}</span>
                <small>{historyThreadMeta(thread)}</small>
              </button>
            ))
          ) : threads.length > 0 ? (
            <span className="reading-assistant-thread-empty">没有匹配的历史</span>
          ) : (
            <span className="reading-assistant-thread-empty">暂无历史</span>
          )}
        </div>
      </div>
    );
  }

  function renderSettingsView() {
    return (
      <div className="reading-assistant-subview reading-assistant-settings-view">
        {renderError()}

        <div className="reading-assistant-settings-list">
          <label className="reading-assistant-setting-row">
            <span>
              <strong>个性化上下文</strong>
              <small>本地阅读统计、书籍和画像</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.usePersonalizedContext}
              onChange={(event) =>
                void updatePreference({
                  ...preferences,
                  usePersonalizedContext: event.currentTarget.checked
                })
              }
              disabled={isLoadingPreferences}
            />
          </label>
          <label className="reading-assistant-setting-row">
            <span>
              <strong>阅读记忆</strong>
              <small>已沉淀的阅读资产摘要</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.useReadingMemory}
              onChange={(event) =>
                void updatePreference({
                  ...preferences,
                  useReadingMemory: event.currentTarget.checked
                })
              }
              disabled={isLoadingPreferences || !preferences.usePersonalizedContext}
            />
          </label>
          <label className="reading-assistant-setting-row">
            <span>
              <strong>原始笔记片段</strong>
              <small>默认关闭，需要时再打开</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.allowRawBookNotes}
              onChange={(event) =>
                void updatePreference({
                  ...preferences,
                  allowRawBookNotes: event.currentTarget.checked
                })
              }
              disabled={isLoadingPreferences || !preferences.usePersonalizedContext}
            />
          </label>
          <label className="reading-assistant-setting-row">
            <span>
              <strong>保存对话历史</strong>
              <small>保存在本机用于继续追问</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.saveConversationHistory}
              onChange={(event) =>
                void updatePreference({
                  ...preferences,
                  saveConversationHistory: event.currentTarget.checked
                })
              }
              disabled={isLoadingPreferences}
            />
          </label>
        </div>

        <div className="reading-assistant-danger-zone">
          <button
            className="text-button reading-assistant-danger-action"
            type="button"
            onClick={() => void handleClearHistory()}
            disabled={threads.length === 0 || isLoadingThreads}
          >
            <Trash2 aria-hidden="true" size={14} />
            清空对话历史
          </button>
        </div>
      </div>
    );
  }

  function renderCurrentView() {
    switch (panelView) {
      case "history":
        return renderHistoryView();
      case "settings":
        return renderSettingsView();
      case "chat":
      default:
        return renderChatView();
    }
  }

  if (!open) {
    return null;
  }

  return (
    <aside className="reading-assistant-panel" aria-label="AI 阅读助手">
      {renderHeader()}
      {renderCurrentView()}
    </aside>
  );
}

export function ReadingAssistantMarkdownLite({ content }: { content: string }) {
  const blocks = useMemo(() => parseReadingAssistantMarkdownLite(content), [content]);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="reading-assistant-markdown-lite">
      {blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return (
            <p
              className={readingAssistantMarkdownParagraphClassName(block)}
              key={blockIndex}
            >
              {renderMarkdownInline(block.children, blockIndex)}
            </p>
          );
        }

        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag
            className={readingAssistantMarkdownListClassName(blocks, blockIndex)}
            key={blockIndex}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderMarkdownInline(item, `${blockIndex}-${itemIndex}`)}</li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

function readingAssistantMarkdownParagraphClassName(
  block: Extract<ReadingAssistantMarkdownBlock, { type: "paragraph" }>
): string | undefined {
  return isReadingAssistantMarkdownSectionLabel(block)
    ? "reading-assistant-markdown-lite-label"
    : undefined;
}

function readingAssistantMarkdownListClassName(
  blocks: ReadingAssistantMarkdownBlock[],
  blockIndex: number
): string {
  const classNames = ["reading-assistant-markdown-lite-list"];
  const previousBlock = blocks[blockIndex - 1];
  if (previousBlock?.type === "paragraph" && isReadingAssistantMarkdownSectionLabel(previousBlock)) {
    classNames.push("is-after-label");
  }

  return classNames.join(" ");
}

function isReadingAssistantMarkdownSectionLabel(
  block: Extract<ReadingAssistantMarkdownBlock, { type: "paragraph" }>
): boolean {
  const text = plainTextFromMarkdownInline(block.children).trim();
  const normalized = text.replace(/[:：]\s*$/, "");
  return (
    normalized.length < 16 &&
    text.length <= 18 &&
    /[:：]\s*$/.test(text) &&
    READING_ASSISTANT_MARKDOWN_SECTION_LABELS.has(normalized)
  );
}

function plainTextFromMarkdownInline(nodes: ReadingAssistantMarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "strong") {
        return plainTextFromMarkdownInline(node.children);
      }

      return node.text;
    })
    .join("");
}

function renderMarkdownInline(
  nodes: ReadingAssistantMarkdownInline[],
  keyPrefix: string | number
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "strong":
        return <strong key={key}>{renderMarkdownInline(node.children, key)}</strong>;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "text":
      default:
        return node.text;
    }
  });
}

const READING_ASSISTANT_MARKDOWN_SECTION_LABELS = new Set([
  "下一步",
  "建议",
  "范围说明",
  "核心数据",
  "选择依据",
  "注意",
  "原因",
  "结论"
]);

function normalizeMessageSuggestions(suggestions: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  suggestions.forEach((suggestion) => {
    const trimmed = suggestion.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized.slice(0, 3);
}

function assistantMessageFromAnswer(answer: ReadingAssistantAnswer): LocalAssistantMessage {
  return {
    id: answer.messageId,
    role: "assistant",
    content: answer.answer,
    status: "answered",
    suggestions: answer.suggestions,
    usedContext: answer.usedContext,
    recommendedBooks: answer.recommendedBooks,
    action: answer.action
  };
}

function localMessageFromThreadMessage(message: ReadingAssistantMessage): LocalAssistantMessage {
  const output =
    message.role === "assistant" && message.status === "answered" ? message.output : undefined;

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status === "failed" ? "failed" : "answered",
    suggestions: output?.suggestions ?? [],
    usedContext: message.usedContext,
    recommendedBooks: output?.recommendedBooks ?? [],
    action: output?.action
  };
}

function wereadSearchResultKey(result: ReadingAssistantWereadSearchResult): string {
  return `weread-search:${result.bookId}`;
}

function recommendedBookActionLabel(state: RecommendedBookCandidateState): string {
  switch (state) {
    case "adding":
      return "加入中";
    case "added":
      return "已加入";
    case "exists":
      return "已在候选";
    case "inLibrary":
      return "已在本地";
    case "failed":
      return "重试加入";
    case "available":
    default:
      return "加入本地候选";
  }
}

function recommendedBookSearchActionLabel(status: RecommendedBookSearchStatus): string {
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

function aiProviderDisplayLabel(settings: AiSettingsState): string {
  const presetId = settings.provider.presetId;
  if (presetId && PROVIDER_PRESET_LABELS[presetId]) {
    return PROVIDER_PRESET_LABELS[presetId];
  }

  if (settings.provider.baseUrl) {
    return "自定义";
  }

  return "未配置 Provider";
}

function historyThreadMeta(thread: ReadingAssistantThreadSummary): string {
  return `${historyScopeLabel(thread.scope)} · ${thread.messageCount} 条`;
}

function historyScopeLabel(scope: AssistantContextScope): string {
  return HISTORY_SCOPE_FILTERS.find((item) => item.value === scope)?.label ?? SCOPE_TITLES[scope];
}

function filterReadingAssistantThreads(
  threads: ReadingAssistantThreadSummary[],
  query: string,
  scopeFilter: ReadingAssistantHistoryScopeFilter,
  currentEntityFilter?: ReadingAssistantCurrentEntityFilter
): ReadingAssistantThreadSummary[] {
  const normalizedQuery = query.trim().toLowerCase();

  return threads.filter((thread) => {
    if (
      currentEntityFilter &&
      (thread.scope !== currentEntityFilter.scope || thread.entityId !== currentEntityFilter.entityId)
    ) {
      return false;
    }

    if (scopeFilter !== "all" && thread.scope !== scopeFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchableText = [
      thread.title,
      historyScopeLabel(thread.scope),
      SCOPE_TITLES[thread.scope],
      thread.entityId ?? ""
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

function findEditableUserMessageId(
  messages: LocalAssistantMessage[],
  isSubmitting: boolean
): string | undefined {
  if (isSubmitting) {
    return undefined;
  }

  let userMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      userMessageIndex = index;
      break;
    }
  }
  if (userMessageIndex < 0) {
    return undefined;
  }

  const tailMessages = messages.slice(userMessageIndex + 1);
  const hasOnlyCompletedAssistantTail = tailMessages.every(
    (message) => message.role === "assistant" && message.status !== "pending"
  );

  return hasOnlyCompletedAssistantTail ? messages[userMessageIndex].id : undefined;
}

function buildEnabledContext(
  scope: AssistantContextScope,
  preferences: ReadingAssistantPreferences
): ReadingAssistantContextOption[] {
  if (!preferences.usePersonalizedContext) {
    return preferences.saveConversationHistory ? ["conversationHistory"] : [];
  }

  const defaults = defaultContextForScope(scope);
  const withRawNotes = preferences.allowRawBookNotes
    ? defaults
    : defaults.filter((item) => item !== "rawBookNotes");
  const withHistory = preferences.saveConversationHistory
    ? withRawNotes
    : withRawNotes.filter((item) => item !== "conversationHistory");

  return preferences.useReadingMemory
    ? withHistory
    : withHistory.filter((item) => item !== "readingMemory");
}

function defaultContextForScope(scope: AssistantContextScope): ReadingAssistantContextOption[] {
  switch (scope) {
    case "bookDetail":
      return [
        "currentBook",
        "bookNotesSummary",
        "rawBookNotes",
        "aiAssetSummary",
        "readingMemory",
        "conversationHistory"
      ];
    case "bookNotes":
      return [
        "currentBook",
        "bookNotesSummary",
        "rawBookNotes",
        "readingMemory",
        "conversationHistory"
      ];
    case "readingStats":
      return ["readingStats", "readingPersona", "readingMemory", "conversationHistory"];
    case "candidateShelf":
      return [
        "candidateBooks",
        "readingStats",
        "readingPersona",
        "readingMemory",
        "conversationHistory"
      ];
    case "aiAsset":
      return ["aiAssetSummary", "currentBook", "readingMemory", "conversationHistory"];
    case "localReaderSelection":
      return ["conversationHistory"];
    case "global":
    default:
      return ["readingStats", "readingPersona", "readingMemory", "conversationHistory"];
  }
}

function suggestionsForScope(scope: AssistantContextScope): string[] {
  switch (scope) {
    case "bookDetail":
      return ["这本书我现在该怎么读？", "这本书适合我继续读吗？", "帮我安排下一次阅读"];
    case "bookNotes":
      return ["我为什么会关注这些笔记？", "这些笔记背后有什么反复问题？", "把这些笔记整理成 3 个复盘问题"];
    case "readingStats":
      return ["这个周期最明显的阅读变化是什么？", "哪些数据说明我需要调整节奏？", "这个周期适合复盘哪几本？"];
    case "candidateShelf":
      return ["从候选书架里先读哪本？", "这些候选书怎么取舍？", "帮我缩小到 3 本"];
    case "aiAsset":
      return ["这份复盘最值得继续追问什么？", "把当前洞察整理成写作提纲", "哪些行动项应该先做？"];
    case "localReaderSelection":
      return ["解释这段话", "这段话和前文有什么关系？", "继续追问这个概念"];
    case "global":
    default:
      return ["我最近反复关注什么主题？", "哪些复盘问题还没有处理？", "基于最近阅读资产，下一步适合整理哪本书？"];
  }
}
