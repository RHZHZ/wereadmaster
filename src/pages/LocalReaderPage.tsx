import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import {
  AlertCircle,
  AlignLeft,
  ArrowLeft,
  BookOpen,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Highlighter,
  ListTree,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Palette,
  RefreshCw,
  Search,
  Type,
  X
} from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  createLocalReaderAiQuestionRecord,
  createLocalReaderAiQuestionThreadTurn,
  getLocalReaderAiQuestionDraftStorage,
  readLocalReaderAiQuestionRecords,
  removeLocalReaderAiQuestionRecord,
  upsertLocalReaderAiQuestionRecord,
  upsertLocalReaderAiQuestionThreadTurn,
  writeLocalReaderAiQuestionRecords,
  type LocalReaderAiQuestionRecord
} from "../lib/local-reader-ai-drafts";
import {
  createLocalReaderAiQuestionRequest,
  type LocalReaderAiQuestionResponse
} from "../lib/local-reader-ai-requests";
import {
  getLocalBook,
  getLocalBookText,
  getLocalReadingProgress,
  saveLocalReadingProgress
} from "../lib/local-reader-api";
import {
  buildLocalReaderHighlightSegments,
  createLocalReaderHighlight,
  getLocalReaderHighlightStorage,
  hasLocalReaderHighlightOverlap,
  normalizeLocalReaderSelectionRange,
  readLocalReaderHighlights,
  writeLocalReaderHighlights,
  type LocalReaderHighlight,
  type LocalReaderHighlightTone
} from "../lib/local-reader-highlights";
import {
  buildLocalReaderMarkdownExport,
  downloadLocalReaderMarkdownFile
} from "../lib/local-reader-markdown";
import {
  getLocalReaderPreferenceStorage,
  readLocalReaderPreferences,
  writeLocalReaderPreferences,
  type LocalReaderFontScale,
  type LocalReaderLineSpacing,
  type LocalReaderPreferences,
  type LocalReaderTheme
} from "../lib/local-reader-preferences";
import {
  createLocalReaderThought,
  getLocalReaderThoughtStorage,
  readLocalReaderThoughts,
  writeLocalReaderThoughts,
  type LocalReaderThought
} from "../lib/local-reader-thoughts";
import type { LocalBook, LocalBookFormat, LocalReadingProgress } from "../lib/local-reader-types";
import { formatAiTimestamp, formatProgress } from "../lib/formatters";
import {
  askLocalReaderSelectionQuestion,
  canAskLocalReaderSelectionQuestion,
  getCommandErrorMessage
} from "../lib/reading-api";

type LocalReaderPageProps = {
  bookId: string;
  onBack: () => void;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type PendingProgressSave = {
  progressPercent: number;
  locator: string;
  readTimeSeconds: number;
};
type LocalReaderProgressReadResult = {
  progress?: LocalReadingProgress;
  error?: string;
};
type LocalReaderInspectorTab = "highlights" | "thoughts" | "ai";
type LocalReaderToolbarPanel = "font" | "lineSpacing" | "theme" | "export";

type SelectionMenuState = {
  text: string;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

type ThoughtDraftState = SelectionMenuState & {
  note: string;
};

type AiQuestionComposerState = SelectionMenuState & {
  question: string;
  parentRecordId?: string;
};

type LocalReaderOutlineItem = {
  id: string;
  title: string;
  offset: number;
};

type LocalReaderSearchMatch = {
  id: string;
  startOffset: number;
  endOffset: number;
};

type LocalReaderMarkdownBlockKind =
  | "blank"
  | "blockquote"
  | "codeFence"
  | "codeLine"
  | "heading"
  | "horizontalRule"
  | "listItem"
  | "paragraph";

type LocalReaderMarkdownBlock = {
  id: string;
  kind: LocalReaderMarkdownBlockKind;
  startOffset: number;
  endOffset: number;
  textEndOffset: number;
  level?: number;
  markerEndOffset?: number;
  visibleTextEndOffset?: number;
  listOrdered?: boolean;
};

async function readLocalReaderProgressSafely(
  bookId: string
): Promise<LocalReaderProgressReadResult> {
  try {
    return { progress: await getLocalReadingProgress(bookId) };
  } catch (error) {
    return { error: getCommandErrorMessage(error) };
  }
}

export function resolveLocalReaderProgressLoadWarning(progressErrorMessage: string) {
  return {
    message: `阅读正文已打开，但阅读进度暂时无法读取：${progressErrorMessage}`,
    tone: "neutral" as const
  };
}

export function resolveLocalReaderProgressSaveErrorNotice(progressErrorMessage: string) {
  return {
    message: `阅读进度保存失败：${progressErrorMessage}`,
    tone: "error" as const
  };
}

export function shouldNotifyLocalReaderProgressSaveError(
  previousErrorMessage: string | undefined,
  nextErrorMessage: string
) {
  return previousErrorMessage !== nextErrorMessage;
}

export function shouldIgnoreLocalReaderProgressSaveResult({
  activeBookId,
  requestBookId,
  activeSaveSessionId,
  requestSaveSessionId,
  resultBookId = requestBookId
}: {
  activeBookId: string;
  requestBookId: string;
  activeSaveSessionId: number;
  requestSaveSessionId: number;
  resultBookId?: string;
}) {
  return (
    activeBookId !== requestBookId ||
    activeSaveSessionId !== requestSaveSessionId ||
    resultBookId !== requestBookId
  );
}

const FLOATING_LAYER_PADDING = 16;
const SELECTION_POPOVER_WIDTH = 520;
const SELECTION_POPOVER_BASE_HEIGHT = 58;
const SELECTION_POPOVER_RELATED_GROUP_HEIGHT = 174;
const SELECTION_POPOVER_MAX_HEIGHT = 420;
const THOUGHT_COMPOSER_WIDTH = 360;
const THOUGHT_COMPOSER_HEIGHT = 220;
const AI_QUESTION_COMPOSER_WIDTH = 380;
const AI_QUESTION_COMPOSER_HEIGHT = 250;
const FONT_SCALE_OPTIONS: Array<{ value: LocalReaderFontScale; label: string; detail: string }> = [
  { value: "compact", label: "紧凑", detail: "更高信息密度" },
  { value: "standard", label: "标准", detail: "默认阅读尺寸" },
  { value: "large", label: "大号", detail: "更舒展易读" }
];
const LINE_SPACING_OPTIONS: Array<{ value: LocalReaderLineSpacing; label: string; detail: string }> = [
  { value: "standard", label: "标准", detail: "适合快速浏览" },
  { value: "relaxed", label: "舒适", detail: "段落更松一点" },
  { value: "loose", label: "宽松", detail: "适合长时间阅读" }
];
const THEME_OPTIONS: Array<{ value: LocalReaderTheme; label: string; detail: string }> = [
  { value: "paper", label: "纸张", detail: "低干扰阅读" },
  { value: "warm", label: "暖色", detail: "夜间前的温和底色" },
  { value: "mint", label: "青绿", detail: "偏清爽的背景" }
];

export function LocalReaderPage({ bookId, onBack }: LocalReaderPageProps) {
  const [book, setBook] = useState<LocalBook>();
  const [progress, setProgress] = useState<LocalReadingProgress>();
  const [content, setContent] = useState("");
  const [highlights, setHighlights] = useState<LocalReaderHighlight[]>([]);
  const [thoughts, setThoughts] = useState<LocalReaderThought[]>([]);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState>();
  const [thoughtDraft, setThoughtDraft] = useState<ThoughtDraftState>();
  const [aiQuestionComposer, setAiQuestionComposer] = useState<AiQuestionComposerState>();
  const [aiQuestionRecords, setAiQuestionRecords] = useState<LocalReaderAiQuestionRecord[]>([]);
  const [isAiQuestionProviderAvailable, setIsAiQuestionProviderAvailable] = useState(false);
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [activeAiQuestionRecordId, setActiveAiQuestionRecordId] = useState<string>();
  const [activeThoughtDetail, setActiveThoughtDetail] = useState<LocalReaderThought>();
  const [activeHighlightDetail, setActiveHighlightDetail] = useState<LocalReaderHighlight>();
  const [thoughtEditDraft, setThoughtEditDraft] = useState<string>();
  const [revealedThoughtRange, setRevealedThoughtRange] =
    useState<Pick<SelectionMenuState, "startOffset" | "endOffset">>();
  const [pendingDeleteThoughtId, setPendingDeleteThoughtId] = useState<string>();
  const [pendingDeleteHighlightId, setPendingDeleteHighlightId] = useState<string>();
  const [pendingDeleteAiQuestionRecordId, setPendingDeleteAiQuestionRecordId] = useState<string>();
  const [isOutlineOpen, setIsOutlineOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeToolbarPanel, setActiveToolbarPanel] = useState<LocalReaderToolbarPanel>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<LocalReaderInspectorTab>("highlights");
  const [readerPreferences, setReaderPreferences] = useState<LocalReaderPreferences>(() =>
    readLocalReaderPreferences(getLocalReaderPreferenceStorage())
  );
  const [visibleProgress, setVisibleProgress] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const readerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef(false);
  const pendingPreferenceScrollRatioRef = useRef<number>();
  const pendingProgressSaveRef = useRef<PendingProgressSave>();
  const saveTimerRef = useRef<number>();
  const lastSavedPercentRef = useRef(-1);
  const lastProgressSaveErrorMessageRef = useRef<string>();
  const progressSaveSessionRef = useRef(0);
  const aiQuestionSubmissionLockRef = useRef(false);
  const currentBookIdRef = useRef(bookId);
  const preserveSelectionMenuUntilRef = useRef(0);
  const outlineButtonRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const lastSelectionTriggerRef = useRef<HTMLElement>();
  const { showToast } = useToast();
  currentBookIdRef.current = bookId;

  function resetReaderTransientUiState() {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setActiveAiQuestionRecordId(undefined);
    setIsAskingAi(false);
    setActiveThoughtDetail(undefined);
    setActiveHighlightDetail(undefined);
    setThoughtEditDraft(undefined);
    setRevealedThoughtRange(undefined);
    setPendingDeleteThoughtId(undefined);
    setPendingDeleteHighlightId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    setIsOutlineOpen(false);
    setIsSearchOpen(false);
    setActiveToolbarPanel(undefined);
    setSearchQuery("");
    setSearchMatchIndex(0);
  }

  const contentSegments = useMemo(
    () => buildLocalReaderHighlightSegments(content, highlights),
    [content, highlights]
  );
  const contentRenderSegments = useMemo(() => {
    let offset = 0;
    return contentSegments.map((segment) => {
      const startOffset = offset;
      offset += segment.text.length;
      return {
        ...segment,
        startOffset,
        endOffset: offset
      };
    });
  }, [contentSegments]);
  const markdownBlocks = useMemo(
    () => (book?.format === "markdown" ? buildLocalReaderMarkdownBlocks(content) : []),
    [book?.format, content]
  );
  const readerOutline = useMemo(
    () => buildLocalReaderOutline(content, book?.format),
    [book?.format, content]
  );
  const searchMatches = useMemo(
    () => buildLocalReaderSearchMatches(content, searchQuery),
    [content, searchQuery]
  );
  const activeSearchMatch = searchMatches[searchMatchIndex];
  const selectionThoughts = useMemo(
    () =>
      selectionMenu
        ? findThoughtsForRange(thoughts, selectionMenu.startOffset, selectionMenu.endOffset)
        : [],
    [selectionMenu, thoughts]
  );
  const selectionAiQuestionRecords = useMemo(
    () =>
      selectionMenu
        ? findAiQuestionRecordsForRange(
            aiQuestionRecords,
            selectionMenu.startOffset,
            selectionMenu.endOffset
          )
        : [],
    [aiQuestionRecords, selectionMenu]
  );
  const activeAiQuestionRecord = useMemo(
    () =>
      activeAiQuestionRecordId
        ? aiQuestionRecords.find((record) => record.id === activeAiQuestionRecordId)
        : undefined,
    [activeAiQuestionRecordId, aiQuestionRecords]
  );

  useEffect(() => {
    document.querySelector<HTMLElement>(".workspace")?.scrollTo({ top: 0, left: 0 });
  }, [bookId, loadAttempt]);

  useEffect(() => {
    setHighlights(readLocalReaderHighlights(getLocalReaderHighlightStorage(), bookId));
    setThoughts(readLocalReaderThoughts(getLocalReaderThoughtStorage(), bookId));
    setAiQuestionRecords(readLocalReaderAiQuestionRecords(getLocalReaderAiQuestionDraftStorage(), bookId));
    resetReaderTransientUiState();
  }, [bookId]);

  useEffect(() => {
    let isMounted = true;
    setIsAiQuestionProviderAvailable(false);

    async function loadAiQuestionAvailability() {
      try {
        const canAsk = await canAskLocalReaderSelectionQuestion();
        if (isMounted) {
          setIsAiQuestionProviderAvailable(canAsk);
        }
      } catch {
        if (isMounted) {
          setIsAiQuestionProviderAvailable(false);
        }
      }
    }

    void loadAiQuestionAvailability();

    return () => {
      isMounted = false;
    };
  }, [bookId]);

  useEffect(() => {
    setSearchMatchIndex(0);
  }, [content, searchQuery]);

  useEffect(() => {
    let isMounted = true;
    progressSaveSessionRef.current += 1;
    restoreScrollRef.current = false;
    lastSavedPercentRef.current = -1;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    pendingProgressSaveRef.current = undefined;
    lastProgressSaveErrorMessageRef.current = undefined;

    async function loadBook() {
      setIsLoading(true);
      setError(undefined);
      setBook(undefined);
      setContent("");
      setProgress(undefined);
      setVisibleProgress(0);
      setSaveState("idle");
      resetReaderTransientUiState();

      try {
        const nextBook = await getLocalBook(bookId);

        if (!nextBook) {
          throw new Error("本地图书不存在。");
        }

        const [text, progressResult] = await Promise.all([
          getLocalBookText(nextBook.id),
          readLocalReaderProgressSafely(nextBook.id)
        ]);

        if (!isMounted) {
          return;
        }

        setBook(nextBook);
        setProgress(progressResult.progress);
        setVisibleProgress(progressResult.progress?.progressPercent ?? 0);
        lastSavedPercentRef.current = progressResult.progress?.progressPercent ?? -1;
        setContent(text.content);
        if (progressResult.error) {
          showToast(resolveLocalReaderProgressLoadWarning(progressResult.error));
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorMessage(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBook();

    return () => {
      isMounted = false;
      progressSaveSessionRef.current += 1;
      flushPendingProgressSave();
    };
  }, [bookId, loadAttempt]);

  useEffect(() => {
    if (!shouldUseLocalReaderPreviewMarks(bookId, content)) {
      return;
    }

    setHighlights((current) =>
      current.length > 0 ? current : buildLocalReaderPreviewHighlights(bookId, content)
    );
    setThoughts((current) =>
      current.length > 0 ? current : buildLocalReaderPreviewThoughts(bookId, content)
    );
    setAiQuestionRecords((current) =>
      current.length > 0 ? current : buildLocalReaderPreviewAiQuestions(bookId, content)
    );
  }, [bookId, content]);

  useEffect(() => {
    if (!content || restoreScrollRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const reader = readerRef.current;
      if (!reader) {
        return;
      }

      const scrollableHeight = reader.scrollHeight - reader.clientHeight;
      const progressPercent = progress?.progressPercent ?? 0;
      if (scrollableHeight > 0 && progressPercent > 0) {
        reader.scrollTop = snapScrollTopToTextLine(
          reader,
          Math.round((scrollableHeight * progressPercent) / 100)
        );
      }
      restoreScrollRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [content, progress?.progressPercent]);

  useEffect(() => {
    const ratio = pendingPreferenceScrollRatioRef.current;
    const reader = readerRef.current;
    if (ratio === undefined || !reader || !content) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const scrollableHeight = reader.scrollHeight - reader.clientHeight;
      if (scrollableHeight > 0) {
        reader.scrollTop = snapScrollTopToTextLine(reader, Math.round(scrollableHeight * ratio));
      }
      pendingPreferenceScrollRatioRef.current = undefined;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [content, readerPreferences]);

  useEffect(() => {
    if (!activeThoughtDetail && !activeHighlightDetail && !activeAiQuestionRecord) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        if (thoughtEditDraft !== undefined) {
          setThoughtEditDraft(undefined);
          return;
        }

        if (activeThoughtDetail) {
          handleCloseThoughtDetail();
          return;
        }

        if (activeHighlightDetail) {
          handleCloseHighlightDetail();
          return;
        }

        handleCloseAiQuestionDetail();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeAiQuestionRecord, activeHighlightDetail, activeThoughtDetail, thoughtEditDraft]);

  useEffect(() => {
    const hasTransientLayer =
      selectionMenu ||
      thoughtDraft ||
      aiQuestionComposer ||
      isOutlineOpen ||
      isSearchOpen ||
      activeToolbarPanel;
    if (!hasTransientLayer || activeThoughtDetail || activeHighlightDetail || activeAiQuestionRecord) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      const shouldFocusOutlineButton = isOutlineOpen;
      const shouldFocusSearchButton = isSearchOpen;
      const selectionTrigger = lastSelectionTriggerRef.current;
      releaseSelectionMenuProtection();
      clearReaderSelection();
      setSelectionMenu(undefined);
      setThoughtDraft(undefined);
      setAiQuestionComposer(undefined);
      setIsOutlineOpen(false);
      setIsSearchOpen(false);
      setActiveToolbarPanel(undefined);
      window.requestAnimationFrame(() => {
        if (shouldFocusOutlineButton) {
          outlineButtonRef.current?.focus();
          return;
        }

        if (shouldFocusSearchButton) {
          searchButtonRef.current?.focus();
          return;
        }

        if (selectionTrigger?.isConnected) {
          selectionTrigger.focus();
          return;
        }

        readerRef.current?.focus();
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeToolbarPanel,
    activeAiQuestionRecord,
    activeHighlightDetail,
    activeThoughtDetail,
    aiQuestionComposer,
    isOutlineOpen,
    isSearchOpen,
    selectionMenu,
    thoughtDraft
  ]);

  useEffect(() => {
    const hasToolbarPanel = isOutlineOpen || isSearchOpen || activeToolbarPanel;
    if (!hasToolbarPanel || activeThoughtDetail || activeHighlightDetail || activeAiQuestionRecord) {
      return;
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (isLocalReaderToolbarPanelTarget(event.target)) {
        return;
      }

      setIsOutlineOpen(false);
      setIsSearchOpen(false);
      setActiveToolbarPanel(undefined);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [
    activeAiQuestionRecord,
    activeHighlightDetail,
    activeThoughtDetail,
    activeToolbarPanel,
    isOutlineOpen,
    isSearchOpen
  ]);

  useEffect(() => {
    if (!selectionMenu) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      selectionMenuRef.current
        ?.querySelector<HTMLButtonElement>(".local-reader-selection-menu button")
        ?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectionMenu]);

  useEffect(() => {
    if (!revealedThoughtRange) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setRevealedThoughtRange(undefined);
    }, 1800);

    return () => window.clearTimeout(timerId);
  }, [revealedThoughtRange]);

  useEffect(() => {
    if (!pendingDeleteThoughtId) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setPendingDeleteThoughtId(undefined);
    }, 3200);

    return () => window.clearTimeout(timerId);
  }, [pendingDeleteThoughtId]);

  useEffect(() => {
    if (!pendingDeleteHighlightId) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setPendingDeleteHighlightId(undefined);
    }, 3200);

    return () => window.clearTimeout(timerId);
  }, [pendingDeleteHighlightId]);

  useEffect(() => {
    if (!pendingDeleteAiQuestionRecordId) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setPendingDeleteAiQuestionRecordId(undefined);
    }, 3200);

    return () => window.clearTimeout(timerId);
  }, [pendingDeleteAiQuestionRecordId]);

  function shouldPreserveSelectionMenu(): boolean {
    return Date.now() < preserveSelectionMenuUntilRef.current;
  }

  function handleReaderScroll() {
    const reader = readerRef.current;
    if (!reader) {
      return;
    }

    if (!shouldPreserveSelectionMenu()) {
      setSelectionMenu(undefined);
    }
    setIsOutlineOpen(false);

    const scrollableHeight = reader.scrollHeight - reader.clientHeight;
    const nextProgress =
      scrollableHeight <= 0 ? 100 : Math.round((reader.scrollTop / scrollableHeight) * 100);
    const clampedProgress = Math.min(100, Math.max(0, nextProgress));
    setVisibleProgress((current) => (current === clampedProgress ? current : clampedProgress));

    const locator = `text:${Math.round(reader.scrollTop)}:${reader.scrollHeight}`;
    queueProgressSave(clampedProgress, locator);
  }

  function queueProgressSave(progressPercent: number, locator: string) {
    const delta = Math.abs(progressPercent - lastSavedPercentRef.current);
    if (delta < 2 && progressPercent !== 0 && progressPercent !== 100) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    pendingProgressSaveRef.current = {
      progressPercent,
      locator,
      readTimeSeconds: progress?.readTimeSeconds ?? 0
    };
    saveTimerRef.current = window.setTimeout(() => {
      const pendingProgress = pendingProgressSaveRef.current;
      pendingProgressSaveRef.current = undefined;
      saveTimerRef.current = undefined;
      if (pendingProgress) {
        void saveProgress(pendingProgress);
      }
    }, 500);
  }

  function flushPendingProgressSave() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const pendingProgress = pendingProgressSaveRef.current;
    pendingProgressSaveRef.current = undefined;
    if (!pendingProgress) {
      return;
    }

    void saveLocalReadingProgress({
      bookId,
      locator: pendingProgress.locator,
      progressPercent: pendingProgress.progressPercent,
      readTimeSeconds: pendingProgress.readTimeSeconds
    }).catch(() => undefined);
  }

  async function saveProgress({ progressPercent, locator, readTimeSeconds }: PendingProgressSave) {
    const requestBookId = bookId;
    const requestSaveSessionId = progressSaveSessionRef.current;

    try {
      setSaveState("saving");
      const savedProgress = await saveLocalReadingProgress({
        bookId: requestBookId,
        locator,
        progressPercent,
        readTimeSeconds
      });
      if (
        shouldIgnoreLocalReaderProgressSaveResult({
          activeBookId: currentBookIdRef.current,
          requestBookId,
          activeSaveSessionId: progressSaveSessionRef.current,
          requestSaveSessionId,
          resultBookId: savedProgress.bookId
        })
      ) {
        return;
      }
      lastSavedPercentRef.current = savedProgress.progressPercent;
      lastProgressSaveErrorMessageRef.current = undefined;
      setProgress(savedProgress);
      setSaveState("saved");
    } catch (saveError) {
      const message = getCommandErrorMessage(saveError);
      if (
        shouldIgnoreLocalReaderProgressSaveResult({
          activeBookId: currentBookIdRef.current,
          requestBookId,
          activeSaveSessionId: progressSaveSessionRef.current,
          requestSaveSessionId
        })
      ) {
        return;
      }
      setSaveState("error");
      if (shouldNotifyLocalReaderProgressSaveError(lastProgressSaveErrorMessageRef.current, message)) {
        showToast(resolveLocalReaderProgressSaveErrorNotice(message));
      }
      lastProgressSaveErrorMessageRef.current = message;
    }
  }

  function handleSelectionChange() {
    window.setTimeout(() => {
      if (shouldPreserveSelectionMenu()) {
        return;
      }

      const nextSelection = readReaderSelection(
        contentRef.current,
        content.length,
        (startOffset, endOffset) =>
          getSelectionPopoverEstimatedHeight(
            findThoughtsForRange(thoughts, startOffset, endOffset).length,
            findAiQuestionRecordsForRange(aiQuestionRecords, startOffset, endOffset).length
          )
      );
      if (nextSelection) {
        setAiQuestionComposer(undefined);
        lastSelectionTriggerRef.current = undefined;
      }
      setSelectionMenu(nextSelection);
    }, 0);
  }

  function updateReaderPreferences(
    updater: (current: LocalReaderPreferences) => LocalReaderPreferences,
    message: string
  ) {
    const reader = readerRef.current;
    if (reader) {
      const scrollableHeight = reader.scrollHeight - reader.clientHeight;
      pendingPreferenceScrollRatioRef.current =
        scrollableHeight > 0 ? reader.scrollTop / scrollableHeight : 0;
    }

    const nextPreferences = writeLocalReaderPreferences(
      getLocalReaderPreferenceStorage(),
      updater(readerPreferences)
    );
    setReaderPreferences(nextPreferences);
    showToast({ message, tone: "success" });
  }

  function handleSelectFontScale(fontScale: LocalReaderFontScale) {
    updateReaderPreferences(
      (current) => ({
        ...current,
        fontScale
      }),
      `字号已切换为${formatFontScaleLabel(fontScale)}`
    );
  }

  function handleSelectLineSpacing(lineSpacing: LocalReaderLineSpacing) {
    updateReaderPreferences(
      (current) => ({
        ...current,
        lineSpacing
      }),
      `行距已切换为${formatLineSpacingLabel(lineSpacing)}`
    );
  }

  function handleSelectTheme(theme: LocalReaderTheme) {
    updateReaderPreferences(
      (current) => ({
        ...current,
        theme
      }),
      `主题已切换为${formatReaderThemeLabel(theme)}`
    );
  }

  function handleToggleToolbarPanel(panel: LocalReaderToolbarPanel) {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setIsOutlineOpen(false);
    setIsSearchOpen(false);
    setActiveToolbarPanel((current) => (current === panel ? undefined : panel));
  }

  function handleToggleOutline() {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setIsSearchOpen(false);
    setActiveToolbarPanel(undefined);
    setIsOutlineOpen((current) => !current);
  }

  function handleJumpToOutlineItem(item: LocalReaderOutlineItem) {
    const reader = readerRef.current;
    const contentRoot = contentRef.current;
    setIsOutlineOpen(false);

    if (
      !reader ||
      !contentRoot ||
      !scrollReaderToTextRange(
        reader,
        contentRoot,
        item.offset,
        Math.min(content.length, item.offset + Math.max(1, item.title.length))
      )
    ) {
      showToast({ message: "未能定位到章节位置。", tone: "warning" });
      return;
    }

    showToast({ message: `已跳转到 ${item.title}`, tone: "success" });
  }

  function handleToggleSearch() {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setIsOutlineOpen(false);
    setActiveToolbarPanel(undefined);
    setIsSearchOpen((current) => !current);
  }

  function releaseSelectionMenuProtection() {
    preserveSelectionMenuUntilRef.current = 0;
  }

  function focusSelectionOrigin() {
    releaseSelectionMenuProtection();
    const selectionTrigger = lastSelectionTriggerRef.current;
    window.requestAnimationFrame(() => {
      if (selectionTrigger?.isConnected) {
        selectionTrigger.focus();
        return;
      }

      readerRef.current?.focus();
    });
  }

  function handleCloseSearch() {
    releaseSelectionMenuProtection();
    setIsSearchOpen(false);
    window.requestAnimationFrame(() => searchButtonRef.current?.focus());
  }

  function handleCancelThoughtDraft() {
    setThoughtDraft(undefined);
    focusSelectionOrigin();
  }

  function handleCancelAiQuestionComposer() {
    setAiQuestionComposer(undefined);
    focusSelectionOrigin();
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!searchQuery.trim()) {
      showToast({ message: "请输入要搜索的正文关键词。", tone: "warning" });
      return;
    }

    if (searchMatches.length === 0) {
      showToast({ message: "未找到匹配正文。", tone: "warning" });
      return;
    }

    handleJumpToSearchMatch(searchMatchIndex);
  }

  function handleMoveSearchMatch(delta: number) {
    if (searchMatches.length === 0) {
      showToast({ message: "未找到匹配正文。", tone: "warning" });
      return;
    }

    handleJumpToSearchMatch(
      (searchMatchIndex + delta + searchMatches.length) % searchMatches.length
    );
  }

  function handleJumpToSearchMatch(nextIndex: number) {
    const match = searchMatches[nextIndex];
    const reader = readerRef.current;
    const contentRoot = contentRef.current;

    if (
      !match ||
      !reader ||
      !contentRoot ||
      !scrollReaderToTextRange(reader, contentRoot, match.startOffset, match.endOffset)
    ) {
      showToast({ message: "未能定位到搜索结果。", tone: "warning" });
      return;
    }

    setSearchMatchIndex(nextIndex);
  }

  function handleCreateHighlight(tone: LocalReaderHighlightTone) {
    if (!selectionMenu) {
      return;
    }

    if (hasLocalReaderHighlightOverlap(highlights, selectionMenu.startOffset, selectionMenu.endOffset)) {
      showToast({ message: "选区已与现有划线重叠。", tone: "warning" });
      clearReaderSelection();
      setSelectionMenu(undefined);
      return;
    }

    const highlight = createLocalReaderHighlight({
      bookId,
      text: content.slice(selectionMenu.startOffset, selectionMenu.endOffset),
      startOffset: selectionMenu.startOffset,
      endOffset: selectionMenu.endOffset,
      tone
    });
    const nextHighlights = writeLocalReaderHighlights(getLocalReaderHighlightStorage(), bookId, [
      ...highlights,
      highlight
    ]);

    setHighlights(nextHighlights);
    clearReaderSelection();
    setSelectionMenu(undefined);
    showToast({ message: tone === "blue" ? "已添加本地标记" : "已添加本地划线", tone: "success" });
  }

  function handleRemoveHighlight(highlightId: string) {
    const nextHighlights = writeLocalReaderHighlights(
      getLocalReaderHighlightStorage(),
      bookId,
      highlights.filter((highlight) => highlight.id !== highlightId)
    );
    setHighlights(nextHighlights);
    setSelectionMenu(undefined);
    setActiveHighlightDetail((current) => (current?.id === highlightId ? undefined : current));
    setPendingDeleteHighlightId(undefined);
    showToast({ message: "已移除本地划线", tone: "success" });
  }

  function handleRequestRemoveHighlight(highlightId: string) {
    if (pendingDeleteHighlightId === highlightId) {
      handleRemoveHighlight(highlightId);
      return;
    }

    setPendingDeleteHighlightId(highlightId);
    showToast({ message: "再次点击删除以确认。", tone: "warning" });
  }

  function handleUpdateHighlightTone(
    highlight: LocalReaderHighlight,
    tone: LocalReaderHighlightTone
  ) {
    if (highlight.tone === tone) {
      return;
    }

    const nextHighlights = writeLocalReaderHighlights(
      getLocalReaderHighlightStorage(),
      bookId,
      highlights.map((item) =>
        item.id === highlight.id
          ? {
              ...item,
              tone
            }
          : item
      )
    );
    const nextActiveHighlight = nextHighlights.find((item) => item.id === highlight.id);

    setHighlights(nextHighlights);
    setActiveHighlightDetail(nextActiveHighlight);
    setPendingDeleteHighlightId(undefined);
    showToast({ message: "已更新划线类型", tone: "success" });
  }

  function handleOpenHighlightDetail(highlight: LocalReaderHighlight) {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setActiveThoughtDetail(undefined);
    setActiveAiQuestionRecordId(undefined);
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    setPendingDeleteHighlightId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    setRevealedThoughtRange({
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset
    });
    setActiveHighlightDetail(highlight);
  }

  function handleCloseHighlightDetail() {
    setPendingDeleteHighlightId(undefined);
    setActiveHighlightDetail(undefined);
  }

  function handleWriteThoughtForHighlight(highlight: LocalReaderHighlight) {
    openHighlightFloatingComposer(highlight, "thought");
  }

  function handleAskAiForHighlight(highlight: LocalReaderHighlight) {
    openHighlightFloatingComposer(highlight, "ai");
  }

  function handleOpenAiQuestionDetail(record: LocalReaderAiQuestionRecord) {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setActiveThoughtDetail(undefined);
    setActiveHighlightDetail(undefined);
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    setPendingDeleteHighlightId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    setRevealedThoughtRange({
      startOffset: record.startOffset,
      endOffset: record.endOffset
    });
    setActiveAiQuestionRecordId(record.id);
  }

  function handleCloseAiQuestionDetail() {
    setPendingDeleteAiQuestionRecordId(undefined);
    setActiveAiQuestionRecordId(undefined);
  }

  function handleOpenThoughtDetail(thought: LocalReaderThought) {
    setSelectionMenu(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    setActiveHighlightDetail(undefined);
    setActiveAiQuestionRecordId(undefined);
    setPendingDeleteHighlightId(undefined);
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    setRevealedThoughtRange({
      startOffset: thought.startOffset,
      endOffset: thought.endOffset
    });
    setActiveThoughtDetail(thought);
  }

  function handleCloseThoughtDetail() {
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    setActiveThoughtDetail(undefined);
  }

  function handleOpenHighlightMenu(
    highlight: LocalReaderHighlight,
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    lastSelectionTriggerRef.current = event.currentTarget;
    const preferredLeft = "clientX" in event ? event.clientX : rect.left + rect.width / 2;
    const position = getFloatingLayerPosition(rect, {
      preferredLeft,
      width: SELECTION_POPOVER_WIDTH,
      height: getSelectionPopoverEstimatedHeight(
        findThoughtsForRange(thoughts, highlight.startOffset, highlight.endOffset).length,
        findAiQuestionRecordsForRange(
          aiQuestionRecords,
          highlight.startOffset,
          highlight.endOffset
        ).length
      ),
      bounds: getFloatingLayerBounds(event.currentTarget)
    });
    clearReaderSelection();
    setActiveHighlightDetail(undefined);
    setActiveAiQuestionRecordId(undefined);
    setPendingDeleteHighlightId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    setThoughtDraft(undefined);
    setAiQuestionComposer(undefined);
    preserveSelectionMenuUntilRef.current = Date.now() + 240;
    setRevealedThoughtRange({
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset
    });
    setSelectionMenu({
      text: highlight.text,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      left: position.left,
      top: position.top
    });
  }

  function handleHighlightKeyDown(
    highlight: LocalReaderHighlight,
    event: KeyboardEvent<HTMLElement>
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleOpenHighlightMenu(highlight, event);
  }

  function handleSaveThought(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!thoughtDraft) {
      return;
    }

    const note = thoughtDraft.note.trim();
    if (!note) {
      showToast({ message: "请先写下想法内容。", tone: "warning" });
      return;
    }

    const thought = createLocalReaderThought({
      bookId,
      selectedText: content.slice(thoughtDraft.startOffset, thoughtDraft.endOffset),
      note,
      startOffset: thoughtDraft.startOffset,
      endOffset: thoughtDraft.endOffset
    });
    if (!hasLocalReaderHighlightOverlap(highlights, thoughtDraft.startOffset, thoughtDraft.endOffset)) {
      const highlight = createLocalReaderHighlight({
        bookId,
        text: content.slice(thoughtDraft.startOffset, thoughtDraft.endOffset),
        startOffset: thoughtDraft.startOffset,
        endOffset: thoughtDraft.endOffset,
        tone: "yellow"
      });
      const nextHighlights = writeLocalReaderHighlights(getLocalReaderHighlightStorage(), bookId, [
        ...highlights,
        highlight
      ]);
      setHighlights(nextHighlights);
    }

    const nextThoughts = writeLocalReaderThoughts(getLocalReaderThoughtStorage(), bookId, [
      ...thoughts,
      thought
    ]);

    setThoughts(nextThoughts);
    setThoughtDraft(undefined);
    showToast({ message: "已保存本地想法", tone: "success" });
  }

  function handleRemoveThought(thoughtId: string) {
    const nextThoughts = writeLocalReaderThoughts(
      getLocalReaderThoughtStorage(),
      bookId,
      thoughts.filter((thought) => thought.id !== thoughtId)
    );
    setThoughts(nextThoughts);
    setActiveThoughtDetail((current) => (current?.id === thoughtId ? undefined : current));
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    showToast({ message: "已移除本地想法", tone: "success" });
  }

  function handleRequestRemoveThought(thoughtId: string) {
    if (pendingDeleteThoughtId === thoughtId) {
      handleRemoveThought(thoughtId);
      return;
    }

    setPendingDeleteThoughtId(thoughtId);
    showToast({ message: "再次点击删除以确认。", tone: "warning" });
  }

  function handleStartThoughtEdit(note: string) {
    setPendingDeleteThoughtId(undefined);
    setThoughtEditDraft(note);
  }

  async function handleCopyThoughtText(label: "原文" | "想法" | "问题" | "划线" | "回答", text: string) {
    if (!text.trim()) {
      showToast({ message: `${label}内容为空，无法复制。`, tone: "warning" });
      return;
    }

    try {
      await copyTextToClipboard(text);
      showToast({ message: `已复制${label}`, tone: "success" });
    } catch (copyError) {
      const message =
        copyError instanceof Error && copyError.message ? copyError.message : "复制失败，请稍后重试。";
      showToast({ message, tone: "error" });
    }
  }

  function handleSaveThoughtEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeThoughtDetail || thoughtEditDraft === undefined) {
      return;
    }

    const note = thoughtEditDraft.trim();
    if (!note) {
      showToast({ message: "想法内容不能为空。", tone: "warning" });
      return;
    }

    const nextThoughts = writeLocalReaderThoughts(
      getLocalReaderThoughtStorage(),
      bookId,
      thoughts.map((thought) =>
        thought.id === activeThoughtDetail.id
          ? {
              ...thought,
              note
            }
          : thought
      )
    );
    const nextActiveThought = nextThoughts.find((thought) => thought.id === activeThoughtDetail.id);

    setThoughts(nextThoughts);
    setActiveThoughtDetail(nextActiveThought);
    setThoughtEditDraft(undefined);
    setPendingDeleteThoughtId(undefined);
    showToast({ message: "已更新本地想法", tone: "success" });
  }

  function handleRevealThoughtSource(thought: LocalReaderThought) {
    setThoughtEditDraft(undefined);
    setActiveThoughtDetail(undefined);
    setActiveHighlightDetail(undefined);
    setPendingDeleteThoughtId(undefined);
    setSelectionMenu(undefined);
    revealReaderRange(
      thought.startOffset,
      thought.endOffset,
      "未能定位到原文位置。",
      "已定位到想法原文"
    );
  }

  function handleRevealHighlightSource(highlight: LocalReaderHighlight) {
    setActiveHighlightDetail(undefined);
    setPendingDeleteHighlightId(undefined);
    setSelectionMenu(undefined);
    revealReaderRange(
      highlight.startOffset,
      highlight.endOffset,
      "未能定位到划线位置。",
      "已定位到划线原文"
    );
  }

  function handleAskAiForSelection() {
    if (!selectionMenu) {
      return;
    }

    setAiQuestionComposer({
      ...selectionMenu,
      left: clampFloatingLayerLeft(selectionMenu.left, AI_QUESTION_COMPOSER_WIDTH),
      question: ""
    });
    clearReaderSelection();
    setSelectionMenu(undefined);
  }

  async function handleCopySelectionText() {
    if (!selectionMenu?.text.trim()) {
      showToast({ message: "选中文本为空，无法复制。", tone: "warning" });
      return;
    }

    try {
      await copyTextToClipboard(selectionMenu.text);
      clearReaderSelection();
      setSelectionMenu(undefined);
      showToast({ message: "已复制选中文本", tone: "success" });
    } catch (copyError) {
      const message =
        copyError instanceof Error && copyError.message ? copyError.message : "复制失败，请稍后重试。";
      showToast({ message, tone: "error" });
    }
  }

  async function refreshAiQuestionProviderAvailability(): Promise<boolean> {
    try {
      const canAsk = await canAskLocalReaderSelectionQuestion();
      setIsAiQuestionProviderAvailable(canAsk);
      return canAsk;
    } catch {
      setIsAiQuestionProviderAvailable(false);
      return false;
    }
  }

  async function handleSubmitAiQuestionRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!aiQuestionComposer || isAskingAi || aiQuestionSubmissionLockRef.current) {
      return;
    }

    const composer = aiQuestionComposer;
    const question = composer.question.trim();
    if (!question) {
      showToast({ message: "请先写下要问 AI 的问题。", tone: "warning" });
      return;
    }

    aiQuestionSubmissionLockRef.current = true;
    const selectedText = content.slice(
      composer.startOffset,
      composer.endOffset
    );

    try {
      if (composer.parentRecordId) {
        await handleSubmitAiQuestionThreadTurn(
          { ...composer, parentRecordId: composer.parentRecordId },
          question,
          selectedText
        );
        return;
      }

      const record = createLocalReaderAiQuestionRecord({
        bookId,
        question,
        selectedText,
        startOffset: composer.startOffset,
        endOffset: composer.endOffset
      });
      let nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
        getLocalReaderAiQuestionDraftStorage(),
        bookId,
        upsertLocalReaderAiQuestionRecord(aiQuestionRecords, bookId, record)
      );
      setAiQuestionRecords(nextAiQuestionRecords);
      setAiQuestionComposer(undefined);
      setInspectorTab("ai");

      const canAskAi = await refreshAiQuestionProviderAvailability();

      if (!canAskAi || !book) {
        showToast({ message: "已保存 AI 提问记录，当前不会请求模型。", tone: "success" });
        return;
      }

      const request = createLocalReaderAiQuestionRequest({
        book,
        selectedText,
        question,
        startOffset: composer.startOffset,
        endOffset: composer.endOffset,
        content
      });

      if (!request) {
        showToast({ message: "选区或问题无效，已先保存 AI 提问记录。", tone: "warning" });
        return;
      }

      const pendingRecord: LocalReaderAiQuestionRecord = {
        ...record,
        status: "pending",
        updatedAt: new Date().toISOString()
      };
      nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
        getLocalReaderAiQuestionDraftStorage(),
        bookId,
        upsertLocalReaderAiQuestionRecord(nextAiQuestionRecords, bookId, pendingRecord)
      );
      setAiQuestionRecords(nextAiQuestionRecords);
      setIsAskingAi(true);
      try {
        const response = await askLocalReaderSelectionQuestion(request);
        const answeredRecord: LocalReaderAiQuestionRecord = {
          ...pendingRecord,
          status: "answered",
          updatedAt: response.answer.generatedAt,
          answer: createAiQuestionRecordAnswer(response)
        };
        nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
          getLocalReaderAiQuestionDraftStorage(),
          bookId,
          upsertLocalReaderAiQuestionRecord(nextAiQuestionRecords, bookId, answeredRecord)
        );
        setAiQuestionRecords(nextAiQuestionRecords);
        showToast({ message: "AI 已基于选区和前后文回答。", tone: "success" });
      } catch (askError) {
        const message = getCommandErrorMessage(askError);
        const failedRecord: LocalReaderAiQuestionRecord = {
          ...pendingRecord,
          status: "failed",
          updatedAt: new Date().toISOString(),
          errorMessage: message
        };
        nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
          getLocalReaderAiQuestionDraftStorage(),
          bookId,
          upsertLocalReaderAiQuestionRecord(nextAiQuestionRecords, bookId, failedRecord)
        );
        setAiQuestionRecords(nextAiQuestionRecords);
        showToast({ message: `AI 提问失败：${message}`, tone: "error" });
      } finally {
        setIsAskingAi(false);
      }
    } finally {
      aiQuestionSubmissionLockRef.current = false;
    }
  }

  async function handleSubmitAiQuestionThreadTurn(
    composer: AiQuestionComposerState & { parentRecordId: string },
    question: string,
    selectedText: string
  ) {
    const parentRecord = aiQuestionRecords.find((record) => record.id === composer.parentRecordId);

    if (!parentRecord) {
      showToast({ message: "原 AI 提问记录不存在，无法保存追问。", tone: "warning" });
      return;
    }

    const requestSelectedText = selectedText || parentRecord.selectedText;
    const existingTurn = parentRecord.thread?.find(
      (turn) => normalizeAiQuestionText(turn.question) === normalizeAiQuestionText(question)
    );
    const turn = createLocalReaderAiQuestionThreadTurn({
      question,
      ...(existingTurn ? { id: existingTurn.id, now: existingTurn.createdAt } : {})
    });
    let nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
      getLocalReaderAiQuestionDraftStorage(),
      bookId,
      upsertLocalReaderAiQuestionThreadTurn(aiQuestionRecords, bookId, parentRecord.id, turn)
    );
    setAiQuestionRecords(nextAiQuestionRecords);
    setAiQuestionComposer(undefined);
    setInspectorTab("ai");
    setActiveAiQuestionRecordId(parentRecord.id);

    const canAskAi = await refreshAiQuestionProviderAvailability();

    if (!canAskAi || !book) {
      showToast({ message: "已保存追问，当前不会请求模型。", tone: "success" });
      return;
    }

    const request = createLocalReaderAiQuestionRequest({
      book,
      selectedText: requestSelectedText,
      question,
      startOffset: parentRecord.startOffset,
      endOffset: parentRecord.endOffset,
      content
    });

    if (!request) {
      showToast({ message: "选区或追问无效，已先保存追问。", tone: "warning" });
      return;
    }

    const pendingTurn = {
      ...turn,
      status: "pending" as const,
      updatedAt: new Date().toISOString()
    };
    nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
      getLocalReaderAiQuestionDraftStorage(),
      bookId,
      upsertLocalReaderAiQuestionThreadTurn(nextAiQuestionRecords, bookId, parentRecord.id, pendingTurn)
    );
    setAiQuestionRecords(nextAiQuestionRecords);
    setIsAskingAi(true);

    try {
      const response = await askLocalReaderSelectionQuestion(request);
      const answeredTurn = {
        ...pendingTurn,
        status: "answered" as const,
        updatedAt: response.answer.generatedAt,
        answer: createAiQuestionRecordAnswer(response)
      };
      nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
        getLocalReaderAiQuestionDraftStorage(),
        bookId,
        upsertLocalReaderAiQuestionThreadTurn(
          nextAiQuestionRecords,
          bookId,
          parentRecord.id,
          answeredTurn
        )
      );
      setAiQuestionRecords(nextAiQuestionRecords);
      showToast({ message: "AI 已基于原选区和前后文回答追问。", tone: "success" });
    } catch (askError) {
      const message = getCommandErrorMessage(askError);
      const failedTurn = {
        ...pendingTurn,
        status: "failed" as const,
        updatedAt: new Date().toISOString(),
        errorMessage: message
      };
      nextAiQuestionRecords = writeLocalReaderAiQuestionRecords(
        getLocalReaderAiQuestionDraftStorage(),
        bookId,
        upsertLocalReaderAiQuestionThreadTurn(
          nextAiQuestionRecords,
          bookId,
          parentRecord.id,
          failedTurn
        )
      );
      setAiQuestionRecords(nextAiQuestionRecords);
      showToast({ message: `AI 追问失败：${message}`, tone: "error" });
    } finally {
      setIsAskingAi(false);
    }
  }

  function handleRevealAiQuestionSource(record: LocalReaderAiQuestionRecord) {
    setSelectionMenu(undefined);
    setAiQuestionComposer(undefined);
    setActiveHighlightDetail(undefined);
    setActiveThoughtDetail(undefined);
    setActiveAiQuestionRecordId(undefined);
    setPendingDeleteAiQuestionRecordId(undefined);
    revealReaderRange(
      record.startOffset,
      record.endOffset,
      "未能定位到 AI 提问原文。",
      "已定位到 AI 提问原文"
    );
  }

  function handleRemoveAiQuestionRecord(recordId: string) {
    const nextRecords = writeLocalReaderAiQuestionRecords(
      getLocalReaderAiQuestionDraftStorage(),
      bookId,
      removeLocalReaderAiQuestionRecord(aiQuestionRecords, recordId)
    );
    setAiQuestionRecords(nextRecords);
    setActiveAiQuestionRecordId((current) => (current === recordId ? undefined : current));
    setPendingDeleteAiQuestionRecordId(undefined);
    setRevealedThoughtRange(undefined);
    showToast({ message: "已清除 AI 提问记录", tone: "success" });
  }

  function handleRequestRemoveAiQuestionRecord(recordId: string) {
    if (pendingDeleteAiQuestionRecordId === recordId) {
      handleRemoveAiQuestionRecord(recordId);
      return;
    }

    setPendingDeleteAiQuestionRecordId(recordId);
    showToast({ message: "再次点击删除以确认。", tone: "warning" });
  }

  function handleFollowUpAiQuestion(record: LocalReaderAiQuestionRecord, question = "") {
    const top = typeof window === "undefined" ? 300 : Math.round(window.innerHeight / 2);
    const left = typeof window === "undefined" ? 360 : Math.round(window.innerWidth / 2);

    setActiveAiQuestionRecordId(undefined);
    setAiQuestionComposer({
      text: record.selectedText,
      startOffset: record.startOffset,
      endOffset: record.endOffset,
      top,
      left: clampFloatingLayerLeft(left, AI_QUESTION_COMPOSER_WIDTH),
      question,
      parentRecordId: record.id
    });
  }

  function handleExportLocalMarks() {
    if (!book) {
      return;
    }

    if (highlights.length === 0 && thoughts.length === 0 && aiQuestionRecords.length === 0) {
      showToast({ message: "暂无本地划线、想法或 AI 提问记录可导出。", tone: "warning" });
      return;
    }

    const result = buildLocalReaderMarkdownExport({
      book,
      highlights,
      thoughts,
      aiQuestionRecords,
      progress
    });
    downloadLocalReaderMarkdownFile(result.fileName, result.markdown);
    showToast({ message: `已导出 ${result.fileName}`, tone: "success" });
  }

  function handleWriteThoughtForSelection() {
    if (!selectionMenu) {
      return;
    }

    setAiQuestionComposer(undefined);
    setThoughtDraft({
      ...selectionMenu,
      left: clampFloatingLayerLeft(selectionMenu.left, THOUGHT_COMPOSER_WIDTH),
      note: ""
    });
    clearReaderSelection();
    setSelectionMenu(undefined);
  }

  function openHighlightFloatingComposer(
    highlight: LocalReaderHighlight,
    action: "thought" | "ai"
  ) {
    setActiveHighlightDetail(undefined);
    setPendingDeleteHighlightId(undefined);
    setSelectionMenu(undefined);
    setRevealedThoughtRange({
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset
    });

    const reader = readerRef.current;
    const contentRoot = contentRef.current;
    const didScroll =
      reader &&
      contentRoot &&
      scrollReaderToTextRange(reader, contentRoot, highlight.startOffset, highlight.endOffset);

    window.setTimeout(
      () => {
        const selectionState = readHighlightFloatingSelectionState(
          highlight,
          action === "thought" ? THOUGHT_COMPOSER_WIDTH : AI_QUESTION_COMPOSER_WIDTH,
          action === "thought" ? THOUGHT_COMPOSER_HEIGHT : AI_QUESTION_COMPOSER_HEIGHT
        );

        if (!selectionState) {
          showToast({ message: "未能定位到划线原文。", tone: "warning" });
          return;
        }

        if (action === "thought") {
          setAiQuestionComposer(undefined);
          setThoughtDraft({
            ...selectionState,
            left: clampFloatingLayerLeft(selectionState.left, THOUGHT_COMPOSER_WIDTH),
            note: ""
          });
          return;
        }

        setThoughtDraft(undefined);
        setAiQuestionComposer({
          ...selectionState,
          left: clampFloatingLayerLeft(selectionState.left, AI_QUESTION_COMPOSER_WIDTH),
          question: ""
        });
      },
      didScroll ? 140 : 0
    );
  }

  function readHighlightFloatingSelectionState(
    highlight: LocalReaderHighlight,
    width: number,
    height: number
  ): SelectionMenuState | undefined {
    const reader = readerRef.current;
    const contentRoot = contentRef.current;
    if (!reader || !contentRoot) {
      return undefined;
    }

    const startPoint = findTextPointAtOffset(contentRoot, highlight.startOffset);
    if (!startPoint) {
      return undefined;
    }

    const endPoint = findTextPointAtOffset(contentRoot, highlight.endOffset);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    if (endPoint) {
      range.setEnd(endPoint.node, endPoint.offset);
    } else {
      range.collapse(true);
    }

    const readerRect = reader.getBoundingClientRect();
    const rect = getRangeAnchorRect(range) ?? range.getBoundingClientRect();
    const anchorRect = rect.width > 0 || rect.height > 0 ? rect : readerRect;
    const position = getFloatingLayerPosition(anchorRect, {
      width,
      height,
      bounds: getFloatingLayerBounds(reader)
    });

    return {
      text: content.slice(highlight.startOffset, highlight.endOffset) || highlight.text,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
      left: position.left,
      top: position.top
    };
  }

  function revealReaderRange(
    startOffset: number,
    endOffset: number,
    failureMessage: string,
    successMessage: string
  ) {
    setRevealedThoughtRange({
      startOffset,
      endOffset
    });

    window.requestAnimationFrame(() => {
      const reader = readerRef.current;
      const contentRoot = contentRef.current;
      if (
        !reader ||
        !contentRoot ||
        !scrollReaderToTextRange(reader, contentRoot, startOffset, endOffset)
      ) {
        showToast({ message: failureMessage, tone: "warning" });
        return;
      }

      showToast({ message: successMessage, tone: "success" });
    });
  }

  const saveStateLabel =
    saveState === "saving"
      ? "保存中"
      : saveState === "saved"
        ? "已保存"
        : saveState === "error"
          ? "保存失败"
          : "本地进度";
  const readerStatusFormat = book
    ? `${formatLocalReaderFormatLabel(book.format)} · 本地文本阅读`
    : "本地文本阅读";

  function handleRetryOpenBook() {
    setLoadAttempt((current) => current + 1);
  }

  return (
    <section className="local-reader-page" aria-label="本地阅读器">
      <div className="local-reader-layout">
        <section className="local-reader-main-pane" aria-label="正文阅读区">
          <header className="local-reader-header">
            <div className="local-reader-bookline">
              <button className="local-reader-back-button" type="button" onClick={onBack}>
                <ArrowLeft aria-hidden="true" size={16} />
              </button>
              <span className="local-reader-cover-mini">
                <BookOpen aria-hidden="true" size={18} />
              </span>
              <div className="local-reader-title">
                <p>本地书库 / 正在阅读</p>
                <h3>{book?.title ?? "本地图书"}</h3>
                <small aria-label="阅读来源边界">
                  {book?.author || "未知作者"} · {book ? formatLocalReaderFormatLabel(book.format) : "TXT"} · 本地版本 · 与微信书架隔离
                </small>
              </div>
            </div>

            <div className="local-reader-toolbar" aria-label="阅读工具">
              <div className="local-reader-outline-control">
                <button
                  ref={outlineButtonRef}
                  type="button"
                  className={isOutlineOpen ? "is-active" : undefined}
                  aria-haspopup="true"
                  aria-expanded={isOutlineOpen}
                  onClick={handleToggleOutline}
                >
                  <ListTree aria-hidden="true" size={17} />
                  目录
                </button>
                {isOutlineOpen ? (
                  <nav className="local-reader-outline-popover" aria-label="本地图书目录">
                    <header>
                      <strong>目录</strong>
                      <span>
                        {readerOutline.length > 0 ? `${readerOutline.length} 处` : "未识别"}
                      </span>
                    </header>
                    {readerOutline.length > 0 ? (
                      <ol className="local-reader-outline-list">
                        {readerOutline.map((item) => (
                          <li key={item.id}>
                            <button type="button" onClick={() => handleJumpToOutlineItem(item)}>
                              <span>{item.title}</span>
                              <small>
                                {formatProgress((item.offset / Math.max(1, content.length)) * 100)}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="local-reader-outline-empty">未识别到章节目录</p>
                    )}
                  </nav>
                ) : null}
              </div>
              <div className="local-reader-tool-control">
                <button
                  type="button"
                  className={activeToolbarPanel === "font" ? "is-active" : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={activeToolbarPanel === "font"}
                  onClick={() => handleToggleToolbarPanel("font")}
                >
                  <Type aria-hidden="true" size={17} />
                  字号
                </button>
                {activeToolbarPanel === "font" ? (
                  <section className="local-reader-tool-popover" aria-label="字号设置">
                    <header>
                      <strong>字号</strong>
                      <span>{formatFontScaleLabel(readerPreferences.fontScale)}</span>
                    </header>
                    <div className="local-reader-tool-options" role="group" aria-label="字号选项">
                      {FONT_SCALE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            readerPreferences.fontScale === option.value ? "is-selected" : undefined
                          }
                          onClick={() => handleSelectFontScale(option.value)}
                        >
                          <span>{option.label}</span>
                          <small>{option.detail}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="local-reader-tool-control">
                <button
                  type="button"
                  className={activeToolbarPanel === "lineSpacing" ? "is-active" : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={activeToolbarPanel === "lineSpacing"}
                  onClick={() => handleToggleToolbarPanel("lineSpacing")}
                >
                  <AlignLeft aria-hidden="true" size={17} />
                  行距
                </button>
                {activeToolbarPanel === "lineSpacing" ? (
                  <section className="local-reader-tool-popover" aria-label="行距设置">
                    <header>
                      <strong>行距</strong>
                      <span>{formatLineSpacingLabel(readerPreferences.lineSpacing)}</span>
                    </header>
                    <div className="local-reader-tool-options" role="group" aria-label="行距选项">
                      {LINE_SPACING_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            readerPreferences.lineSpacing === option.value
                              ? "is-selected"
                              : undefined
                          }
                          onClick={() => handleSelectLineSpacing(option.value)}
                        >
                          <span>{option.label}</span>
                          <small>{option.detail}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="local-reader-tool-control">
                <button
                  type="button"
                  className={activeToolbarPanel === "theme" ? "is-active" : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={activeToolbarPanel === "theme"}
                  onClick={() => handleToggleToolbarPanel("theme")}
                >
                  <Palette aria-hidden="true" size={17} />
                  主题
                </button>
                {activeToolbarPanel === "theme" ? (
                  <section className="local-reader-tool-popover" aria-label="主题设置">
                    <header>
                      <strong>主题</strong>
                      <span>{formatReaderThemeLabel(readerPreferences.theme)}</span>
                    </header>
                    <div className="local-reader-tool-options" role="group" aria-label="主题选项">
                      {THEME_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            readerPreferences.theme === option.value ? "is-selected" : undefined
                          }
                          onClick={() => handleSelectTheme(option.value)}
                        >
                          <span>
                            <i className={`local-reader-theme-swatch is-${option.value}`} />
                            {option.label}
                          </span>
                          <small>{option.detail}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="local-reader-tool-control">
                <button
                  type="button"
                  className={activeToolbarPanel === "export" ? "is-active" : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={activeToolbarPanel === "export"}
                  onClick={() => handleToggleToolbarPanel("export")}
                >
                  <Download aria-hidden="true" size={17} />
                  导出
                </button>
                {activeToolbarPanel === "export" ? (
                  <section
                    className="local-reader-tool-popover local-reader-tool-popover--export"
                    aria-label="导出设置"
                  >
                    <header>
                      <strong>导出</strong>
                      <span>Markdown</span>
                    </header>
                    <p>导出本书划线、想法和 AI 提问记录。</p>
                    <button
                      type="button"
                      className="local-reader-tool-primary-action"
                      onClick={() => {
                        setActiveToolbarPanel(undefined);
                        handleExportLocalMarks();
                      }}
                    >
                      <Download aria-hidden="true" size={15} />
                      导出 Markdown
                    </button>
                  </section>
                ) : null}
              </div>
              <div className="local-reader-search-control">
                <button
                  ref={searchButtonRef}
                  type="button"
                  className={`local-reader-icon-button ${isSearchOpen ? "is-active" : ""}`}
                  aria-label="打开更多工具"
                  aria-haspopup="dialog"
                  aria-expanded={isSearchOpen}
                  onClick={handleToggleSearch}
                >
                  <MoreHorizontal aria-hidden="true" size={18} />
                </button>
                {isSearchOpen ? (
                  <form
                    className="local-reader-search-popover"
                    aria-label="更多阅读工具"
                    onSubmit={handleSearchSubmit}
                  >
                    <header className="local-reader-search-popover-header">
                      <strong>更多工具</strong>
                      <span>书内搜索</span>
                    </header>
                    <label className="local-reader-search-field">
                      <Search aria-hidden="true" size={15} />
                      <input
                        aria-label="搜索正文"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="搜索正文"
                        autoFocus
                      />
                    </label>
                    <div className="local-reader-search-meta">
                      <span>
                        {searchQuery.trim()
                          ? searchMatches.length > 0
                            ? `${searchMatchIndex + 1} / ${searchMatches.length}`
                            : "无匹配"
                          : "输入关键词"}
                      </span>
                      <button type="button" onClick={() => setSearchQuery("")}>
                        清空
                      </button>
                    </div>
                    <footer>
                      <button
                        type="button"
                        aria-label="上一个搜索结果"
                        disabled={searchMatches.length === 0}
                        onClick={() => handleMoveSearchMatch(-1)}
                      >
                        <ChevronLeft aria-hidden="true" size={15} />
                      </button>
                      <button type="submit" disabled={searchMatches.length === 0}>
                        定位
                      </button>
                      <button
                        type="button"
                        aria-label="下一个搜索结果"
                        disabled={searchMatches.length === 0}
                        onClick={() => handleMoveSearchMatch(1)}
                      >
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="关闭书内搜索"
                        onClick={handleCloseSearch}
                      >
                        <X aria-hidden="true" size={15} />
                      </button>
                    </footer>
                  </form>
                ) : null}
              </div>
            </div>
          </header>

          {error ? (
            <div className="status-message status-message--error status-message--actionable">
              <AlertCircle aria-hidden="true" size={18} />
              <span>{error}</span>
              <div className="local-reader-error-actions">
                <button type="button" onClick={handleRetryOpenBook}>
                  <RefreshCw aria-hidden="true" size={15} />
                  重新打开
                </button>
                <button type="button" onClick={onBack}>
                  <ArrowLeft aria-hidden="true" size={15} />
                  返回本地书库
                </button>
              </div>
            </div>
          ) : null}

          {!error && isLoading ? (
            <div className="local-reader-loading">
              <Loader2 aria-hidden="true" size={22} className="spin" />
              <span>正在打开本地图书</span>
            </div>
          ) : null}

          {!error && !isLoading && book ? (
            <article
              ref={readerRef}
              className="local-reader-document"
              data-font-scale={readerPreferences.fontScale}
              data-line-spacing={readerPreferences.lineSpacing}
              data-reader-theme={readerPreferences.theme}
              aria-label={`${book.title} 正文`}
              tabIndex={-1}
              onScroll={handleReaderScroll}
              onMouseUp={handleSelectionChange}
              onKeyUp={handleSelectionChange}
            >
              <div
                ref={contentRef}
                className={
                  book.format === "markdown"
                    ? "local-reader-content local-reader-content--markdown"
                    : "local-reader-content local-reader-content--plain"
                }
              >
                {content ? (
                  book.format === "markdown" ? (
                    renderLocalReaderMarkdownContent({
                      activeSearchMatch,
                      blocks: markdownBlocks,
                      contentRenderSegments,
                      handleHighlightKeyDown,
                      handleOpenHighlightMenu,
                      revealedThoughtRange
                    })
                  ) : (
                    <pre>
                      {renderLocalReaderInlineSegments({
                        activeSearchMatch,
                        contentRenderSegments,
                        handleHighlightKeyDown,
                        handleOpenHighlightMenu,
                        revealedThoughtRange
                      })}
                    </pre>
                  )
                ) : (
                  "本书暂无可显示内容。"
                )}
              </div>
            </article>
          ) : null}

          <footer className="local-reader-statusbar" aria-label="阅读状态">
            <span>{readerStatusFormat}</span>
            <span>滚动位置</span>
            <strong>{formatProgress(visibleProgress)}</strong>
            <meter min={0} max={100} value={visibleProgress} />
            <small>{saveStateLabel}</small>
          </footer>
        </section>

        <aside className="local-reader-inspector" aria-label="阅读侧栏">
          <div className="local-reader-inspector-tabs" role="tablist" aria-label="本地阅读侧栏">
            {([
              ["highlights", "划线"],
              ["thoughts", "想法"],
              ["ai", "AI 提问"]
            ] as Array<[LocalReaderInspectorTab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                className={inspectorTab === tab ? "is-active" : ""}
                aria-selected={inspectorTab === tab}
                onClick={() => setInspectorTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="local-reader-inspector-panel" aria-label="本地阅读侧栏内容">
            {inspectorTab === "highlights" ? (
              <div className="local-reader-inspector-section" aria-label="本地划线列表">
              <div className="local-reader-filter-row">
                <span className="local-reader-filter-label">全部书籍</span>
                <strong>{highlights.length}</strong>
              </div>
              {highlights.length > 0 ? (
                <ol className="local-reader-highlight-list">
                  {highlights.map((highlight) => {
                    const isRevealed = isLocalReaderRangeRevealed(
                      revealedThoughtRange,
                      highlight
                    );
                    const isActive = activeHighlightDetail?.id === highlight.id;

                    return (
                      <li
                        key={highlight.id}
                        className={[
                          pendingDeleteHighlightId === highlight.id ? "is-delete-pending" : "",
                          isActive ? "is-active" : "",
                          isRevealed ? "is-revealed" : "",
                          `is-${highlight.tone}`
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-current={isActive || isRevealed ? "location" : undefined}
                      >
                        <button
                          type="button"
                          className="local-reader-highlight-card"
                          aria-label={`查看划线详情 ${highlight.text.slice(0, 18)}`}
                          title="点击查看划线详情"
                          onClick={() => handleOpenHighlightDetail(highlight)}
                        >
                          <span>{highlight.text}</span>
                          <small>{book ? formatAiTimestamp(highlight.createdAt) : ""}</small>
                        </button>
                        <button
                          type="button"
                          className="local-reader-highlight-delete"
                          aria-label={
                            pendingDeleteHighlightId === highlight.id
                              ? `确认删除划线 ${highlight.text.slice(0, 12)}`
                              : `移除划线 ${highlight.text.slice(0, 12)}`
                          }
                          title={pendingDeleteHighlightId === highlight.id ? "确认删除" : "移除划线"}
                          onClick={() => handleRequestRemoveHighlight(highlight.id)}
                        >
                          <X aria-hidden="true" size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="local-reader-inspector-empty">
                  <Highlighter aria-hidden="true" size={22} />
                  <span>暂无划线</span>
                </div>
              )}
              </div>
            ) : null}

            {inspectorTab === "thoughts" ? (
              <div className="local-reader-inspector-section" aria-label="本地想法列表">
                <div className="local-reader-filter-row">
                  <span className="local-reader-filter-label">本书想法</span>
                  <strong>{thoughts.length}</strong>
                </div>
                {thoughts.length > 0 ? (
                  <ol className="local-reader-thought-list">
                    {thoughts.map((thought) => {
                      const isRevealed = isLocalReaderRangeRevealed(
                        revealedThoughtRange,
                        thought
                      );
                      const isActive = activeThoughtDetail?.id === thought.id;

                      return (
                        <li
                          key={thought.id}
                          className={[
                            pendingDeleteThoughtId === thought.id ? "is-delete-pending" : "",
                            isActive ? "is-active" : "",
                            isRevealed ? "is-revealed" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-current={isActive || isRevealed ? "location" : undefined}
                        >
                          <button
                            type="button"
                            className="local-reader-thought-card"
                            aria-label={`查看想法详情 ${thought.note.slice(0, 18)}`}
                            title="点击查看想法详情"
                            onClick={() => handleOpenThoughtDetail(thought)}
                          >
                            <p>{thought.note}</p>
                            <small>{formatAiTimestamp(thought.createdAt)}</small>
                          </button>
                          <button
                            type="button"
                            className="local-reader-thought-delete"
                            aria-label={
                              pendingDeleteThoughtId === thought.id
                                ? `确认删除想法 ${thought.note.slice(0, 12)}`
                                : `移除想法 ${thought.note.slice(0, 12)}`
                            }
                            title={pendingDeleteThoughtId === thought.id ? "确认删除" : "移除想法"}
                            onClick={() => handleRequestRemoveThought(thought.id)}
                          >
                            <X aria-hidden="true" size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
                {thoughts.length === 0 ? (
                  <div className="local-reader-inspector-empty">
                    <BookmarkPlus aria-hidden="true" size={22} />
                    <span>暂无想法</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {inspectorTab === "ai" ? (
              <div className="local-reader-inspector-section" aria-label="AI 提问列表">
                <div className="local-reader-filter-row">
                  <span className="local-reader-filter-label">基于选区</span>
                  <strong>{aiQuestionRecords.length}</strong>
                </div>
                {aiQuestionRecords.length > 0 ? (
                  <ol className="local-reader-ai-list">
                    {aiQuestionRecords.map((record) => {
                      const isRevealed = isLocalReaderRangeRevealed(
                        revealedThoughtRange,
                        record
                      );
                      const isActive = activeAiQuestionRecordId === record.id;
                      const displayStatus = getAiQuestionRecordDisplayStatus(record);
                      const turnSummary = formatAiQuestionRecordTurnSummary(record);

                      return (
                        <li
                          key={record.id}
                          className={[
                            pendingDeleteAiQuestionRecordId === record.id
                              ? "is-delete-pending"
                              : "",
                            isActive ? "is-active" : "",
                            isRevealed ? "is-revealed" : "",
                            `is-${displayStatus}`
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-current={isActive || isRevealed ? "location" : undefined}
                        >
                          <button
                            type="button"
                            className="local-reader-ai-card"
                            aria-label={`查看 AI 提问详情 ${record.question.slice(0, 18)}`}
                            title="点击查看 AI 提问详情"
                            onClick={() => handleOpenAiQuestionDetail(record)}
                          >
                            <span className="local-reader-ai-card-meta">
                              <span className="local-reader-ai-status">
                                {displayStatus === "pending" ? (
                                  <Loader2 aria-hidden="true" size={12} />
                                ) : null}
                                {formatAiQuestionStatus(displayStatus)}
                              </span>
                              <small>
                                {turnSummary ? `${turnSummary} · ` : ""}
                                {formatAiTimestamp(record.updatedAt || record.createdAt)}
                              </small>
                            </span>
                            <p>{record.question}</p>
                            <blockquote>{record.selectedText}</blockquote>
                            {record.answer ? (
                              <small className="local-reader-ai-answer-preview">
                                {record.answer.answer}
                              </small>
                            ) : null}
                            {record.errorMessage ? (
                              <small className="local-reader-ai-error-preview">
                                {record.errorMessage}
                              </small>
                            ) : null}
                          </button>
                          <div className="local-reader-ai-card-actions">
                            <button
                              type="button"
                              aria-label={`复制 AI 提问 ${record.question.slice(0, 12)}`}
                              title="复制问题"
                              onClick={() => void handleCopyThoughtText("问题", record.question)}
                            >
                              <Copy aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label={`定位 AI 提问原文 ${record.question.slice(0, 12)}`}
                              title="定位原文"
                              onClick={() => handleRevealAiQuestionSource(record)}
                            >
                              <FileText aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label={
                                pendingDeleteAiQuestionRecordId === record.id
                                  ? `确认删除 AI 提问 ${record.question.slice(0, 12)}`
                                  : `删除 AI 提问 ${record.question.slice(0, 12)}`
                              }
                              title={
                                pendingDeleteAiQuestionRecordId === record.id
                                  ? "确认删除"
                                  : "删除 AI 提问"
                              }
                              onClick={() => handleRequestRemoveAiQuestionRecord(record.id)}
                            >
                              <X aria-hidden="true" size={14} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="local-reader-inspector-empty" aria-label="AI 提问空态">
                    <MessageSquareText aria-hidden="true" size={22} />
                    <span>暂无 AI 提问记录</span>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {selectionMenu ? (
        <div
          ref={selectionMenuRef}
          className={`local-reader-selection-popover ${
            selectionThoughts.length > 0 || selectionAiQuestionRecords.length > 0 ? "has-thoughts" : ""
          }`}
          style={{
            left: `${selectionMenu.left}px`,
            top: `${selectionMenu.top}px`
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            className="local-reader-selection-menu"
            role="toolbar"
            aria-label="本地选中文本操作"
          >
            <button type="button" onClick={() => handleCreateHighlight("yellow")}>
              <Highlighter aria-hidden="true" size={15} />
              划线
            </button>
            <button type="button" onClick={handleWriteThoughtForSelection}>
              <MessageSquareText aria-hidden="true" size={15} />
              写想法
            </button>
            <button type="button" onClick={handleAskAiForSelection}>
              <MessageSquareText aria-hidden="true" size={15} />
              问 AI
            </button>
            <button type="button" onClick={() => handleCreateHighlight("green")}>
              <BookmarkPlus aria-hidden="true" size={15} />
              标记
            </button>
            <button type="button" onClick={() => handleCreateHighlight("blue")}>
              <span className="local-reader-selection-dot local-reader-selection-dot--blue" />
              疑问
            </button>
            <button type="button" onClick={() => void handleCopySelectionText()}>
              <Copy aria-hidden="true" size={15} />
              复制
            </button>
          </div>
          {selectionThoughts.length > 0 ? (
            <div className="local-reader-selection-thoughts" aria-label="选区相关想法">
              <strong>相关想法</strong>
              {selectionThoughts.map((thought) => (
                <button
                  key={thought.id}
                  type="button"
                  className="local-reader-selection-thought-card"
                  aria-label={`查看选区想法详情 ${thought.note.slice(0, 18)}`}
                  onClick={() => handleOpenThoughtDetail(thought)}
                  title="点击查看想法详情"
                >
                  <p>{thought.note}</p>
                  <small>{formatAiTimestamp(thought.createdAt)}</small>
                </button>
              ))}
            </div>
          ) : null}
          {selectionAiQuestionRecords.length > 0 ? (
            <div className="local-reader-selection-thoughts" aria-label="选区相关 AI 提问">
              <strong>相关 AI 提问</strong>
              {selectionAiQuestionRecords.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className="local-reader-selection-thought-card"
                  aria-label={`查看选区 AI 提问详情 ${record.question.slice(0, 18)}`}
                  onClick={() => handleOpenAiQuestionDetail(record)}
                  title="点击查看 AI 提问详情"
                >
                  <p>{record.question}</p>
                  <small>
                    {formatAiQuestionStatus(getAiQuestionRecordDisplayStatus(record))} ·{" "}
                    {formatAiQuestionRecordTurnSummary(record)
                      ? `${formatAiQuestionRecordTurnSummary(record)} · `
                      : ""}
                    {formatAiTimestamp(record.updatedAt)}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {thoughtDraft ? (
        <form
          className={`local-reader-thought-composer local-reader-thought-composer--floating ${
            thoughtDraft.top < 260 ? "is-below" : ""
          }`}
          style={getThoughtComposerStyle(thoughtDraft)}
          onSubmit={handleSaveThought}
        >
          <blockquote>{thoughtDraft.text}</blockquote>
          <textarea
            value={thoughtDraft.note}
            onChange={(event) =>
              setThoughtDraft((current) =>
                current ? { ...current, note: event.target.value } : current
              )
            }
            placeholder="写下这段文字触发的想法"
            rows={3}
            autoFocus
          />
          <footer>
            <button type="button" onClick={handleCancelThoughtDraft}>
              取消
            </button>
            <button type="submit">保存想法</button>
          </footer>
        </form>
      ) : null}

      {aiQuestionComposer ? (
        <form
          className={`local-reader-ai-composer local-reader-ai-composer--floating ${
            aiQuestionComposer.top < 280 ? "is-below" : ""
          }`}
          style={getAiQuestionComposerStyle(aiQuestionComposer)}
          aria-label="AI 提问面板"
          onSubmit={handleSubmitAiQuestionRecord}
        >
          <header>
            <span>{aiQuestionComposer.parentRecordId ? "继续追问" : "问 AI"}</span>
            <button
              type="button"
              aria-label="关闭 AI 提问面板"
              onClick={handleCancelAiQuestionComposer}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </header>
          <blockquote>{aiQuestionComposer.text}</blockquote>
          <textarea
            value={aiQuestionComposer.question}
            onChange={(event) =>
              setAiQuestionComposer((current) =>
                current ? { ...current, question: event.target.value } : current
              )
            }
            aria-label="AI 提问内容"
            placeholder={
              aiQuestionComposer.parentRecordId
                ? "继续围绕这段文字追问"
                : "围绕这段文字提一个问题"
            }
            rows={3}
            autoFocus
          />
          <small>
            {aiQuestionComposer.parentRecordId
              ? isAiQuestionProviderAvailable
                ? "追问会归入当前 AI 提问记录；只发送原选区、前后文和追问内容。"
                : "仅把追问保存到当前记录；当前不会请求模型，也不会读取整本书。"
              : isAiQuestionProviderAvailable
                ? "提交时只发送选中文本、前后文和问题；不会读取整本书或微信读书数据。"
                : "仅保存草稿态记录；当前不会请求模型，也不会读取整本书。"}
          </small>
          <footer>
            <button type="button" onClick={handleCancelAiQuestionComposer}>
              取消
            </button>
            <button type="submit" disabled={isAskingAi}>
              {isAskingAi ? (
                <>
                  <Loader2 aria-hidden="true" size={14} />
                  {aiQuestionComposer.parentRecordId ? "追问中" : "提问中"}
                </>
              ) : isAiQuestionProviderAvailable ? (
                aiQuestionComposer.parentRecordId ? "提交追问" : "提交提问"
              ) : (
                aiQuestionComposer.parentRecordId ? "保存追问" : "保存记录"
              )}
            </button>
          </footer>
        </form>
      ) : null}

      {activeThoughtDetail ? (
        <div
          className="local-reader-thought-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseThoughtDetail();
            }
          }}
        >
          <section
            className="local-reader-thought-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-reader-thought-modal-title"
          >
            <header className="local-reader-thought-modal-header">
              <div>
                <span>想法详情</span>
                <h4 id="local-reader-thought-modal-title">
                  {formatAiTimestamp(activeThoughtDetail.createdAt)}
                </h4>
              </div>
              <button
                type="button"
                className="local-reader-thought-modal-close"
                aria-label="关闭想法详情"
                onClick={handleCloseThoughtDetail}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>

            <div className="local-reader-thought-modal-body">
              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>原文</span>
                  <button
                    type="button"
                    className="local-reader-thought-modal-copy"
                    onClick={() => void handleCopyThoughtText("原文", activeThoughtDetail.selectedText)}
                  >
                    <Copy aria-hidden="true" size={14} />
                    <span>复制</span>
                  </button>
                </div>
                <div className="local-reader-thought-modal-content">
                  {activeThoughtDetail.selectedText}
                </div>
              </section>
              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>想法</span>
                  <button
                    type="button"
                    className="local-reader-thought-modal-copy"
                    onClick={() =>
                      void handleCopyThoughtText("想法", thoughtEditDraft ?? activeThoughtDetail.note)
                    }
                  >
                    <Copy aria-hidden="true" size={14} />
                    <span>复制</span>
                  </button>
                </div>
                {thoughtEditDraft === undefined ? (
                  <div className="local-reader-thought-modal-content">
                    {activeThoughtDetail.note}
                  </div>
                ) : (
                  <form
                    id="local-reader-thought-edit-form"
                    className="local-reader-thought-edit-form"
                    onSubmit={handleSaveThoughtEdit}
                  >
                    <textarea
                      value={thoughtEditDraft}
                      onChange={(event) => setThoughtEditDraft(event.target.value)}
                      aria-label="编辑想法内容"
                      rows={6}
                      autoFocus
                    />
                  </form>
                )}
              </section>
            </div>

            <footer className="local-reader-thought-modal-actions">
              {thoughtEditDraft === undefined ? (
                <>
                  <button
                    type="button"
                    onClick={handleCloseThoughtDetail}
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevealThoughtSource(activeThoughtDetail)}
                  >
                    定位原文
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleStartThoughtEdit(activeThoughtDetail.note);
                    }}
                    onClick={() => handleStartThoughtEdit(activeThoughtDetail.note)}
                  >
                    编辑想法
                  </button>
                  <button
                    type="button"
                    className={`is-danger ${
                      pendingDeleteThoughtId === activeThoughtDetail.id ? "is-confirming" : ""
                    }`}
                    onClick={() => handleRequestRemoveThought(activeThoughtDetail.id)}
                  >
                    {pendingDeleteThoughtId === activeThoughtDetail.id ? "确认删除" : "删除想法"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setThoughtEditDraft(undefined)}>
                    取消编辑
                  </button>
                  <button
                    type="submit"
                    form="local-reader-thought-edit-form"
                    className="is-primary"
                  >
                    保存修改
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      ) : null}

      {activeHighlightDetail ? (
        <div
          className="local-reader-thought-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseHighlightDetail();
            }
          }}
        >
          <section
            className="local-reader-thought-modal-panel local-reader-highlight-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-reader-highlight-modal-title"
          >
            <header className="local-reader-thought-modal-header">
              <div>
                <span>划线详情</span>
                <h4 id="local-reader-highlight-modal-title">
                  {formatHighlightToneLabel(activeHighlightDetail.tone)} ·{" "}
                  {formatAiTimestamp(activeHighlightDetail.createdAt)}
                </h4>
              </div>
              <button
                type="button"
                className="local-reader-thought-modal-close"
                aria-label="关闭划线详情"
                onClick={handleCloseHighlightDetail}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>

            <div className="local-reader-thought-modal-body">
              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>完整划线</span>
                  <button
                    type="button"
                    className="local-reader-thought-modal-copy"
                    onClick={() => void handleCopyThoughtText("划线", activeHighlightDetail.text)}
                  >
                    <Copy aria-hidden="true" size={14} />
                    <span>复制</span>
                  </button>
                </div>
                <div className="local-reader-thought-modal-content">
                  {activeHighlightDetail.text}
                </div>
              </section>
              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>本地边界</span>
                  <span
                    className={`local-reader-highlight-tone-pill is-${activeHighlightDetail.tone}`}
                  >
                    {formatHighlightToneLabel(activeHighlightDetail.tone)}
                  </span>
                </div>
                <div className="local-reader-thought-modal-content">
                  本条记录只属于本地阅读器，不会写回微信读书，也不会和微信读书笔记自动合并。
                </div>
                <div className="local-reader-highlight-tone-actions" aria-label="划线类型">
                  {(["yellow", "green", "blue"] as const).map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      className={activeHighlightDetail.tone === tone ? "is-active" : undefined}
                      onClick={() => handleUpdateHighlightTone(activeHighlightDetail, tone)}
                    >
                      {activeHighlightDetail.tone === tone
                        ? formatHighlightToneLabel(tone)
                        : `设为${formatHighlightToneLabel(tone)}`}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <footer className="local-reader-thought-modal-actions">
              <button type="button" onClick={handleCloseHighlightDetail}>
                关闭
              </button>
              <button
                type="button"
                onClick={() => handleRevealHighlightSource(activeHighlightDetail)}
              >
                定位原文
              </button>
              <button
                type="button"
                onClick={() => handleWriteThoughtForHighlight(activeHighlightDetail)}
              >
                写想法
              </button>
              <button
                type="button"
                onClick={() => handleAskAiForHighlight(activeHighlightDetail)}
              >
                问 AI
              </button>
              <button
                type="button"
                className={`is-danger ${
                  pendingDeleteHighlightId === activeHighlightDetail.id ? "is-confirming" : ""
                }`}
                onClick={() => handleRequestRemoveHighlight(activeHighlightDetail.id)}
              >
                {pendingDeleteHighlightId === activeHighlightDetail.id ? "确认删除" : "删除划线"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {activeAiQuestionRecord ? (
        <div
          className="local-reader-thought-modal local-reader-ai-detail-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseAiQuestionDetail();
            }
          }}
        >
          <section
            className="local-reader-thought-modal-panel local-reader-ai-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-reader-ai-modal-title"
          >
            <header className="local-reader-thought-modal-header">
              <div>
                <h4 id="local-reader-ai-modal-title">AI 提问详情</h4>
                <span>
                  {formatAiQuestionStatus(getAiQuestionRecordDisplayStatus(activeAiQuestionRecord))} ·{" "}
                  {formatAiQuestionRecordTurnSummary(activeAiQuestionRecord)
                    ? `${formatAiQuestionRecordTurnSummary(activeAiQuestionRecord)} · `
                    : ""}
                  {formatAiTimestamp(activeAiQuestionRecord.updatedAt)}
                </span>
              </div>
              <button
                type="button"
                className="local-reader-thought-modal-close"
                aria-label="关闭 AI 提问详情"
                onClick={handleCloseAiQuestionDetail}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>

            <div className="local-reader-thought-modal-body">
              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>选中文本</span>
                  <button
                    type="button"
                    className="local-reader-thought-modal-copy"
                    onClick={() =>
                      void handleCopyThoughtText("原文", activeAiQuestionRecord.selectedText)
                    }
                  >
                    <Copy aria-hidden="true" size={14} />
                    <span>复制</span>
                  </button>
                </div>
                <div className="local-reader-thought-modal-content">
                  {activeAiQuestionRecord.selectedText}
                </div>
              </section>

              <section className="local-reader-thought-modal-section">
                <div className="local-reader-thought-modal-section-header">
                  <span>用户问题</span>
                  <button
                    type="button"
                    className="local-reader-thought-modal-copy"
                    onClick={() =>
                      void handleCopyThoughtText("问题", activeAiQuestionRecord.question)
                    }
                  >
                    <Copy aria-hidden="true" size={14} />
                    <span>复制</span>
                  </button>
                </div>
                <div className="local-reader-thought-modal-content">
                  {activeAiQuestionRecord.question}
                </div>
              </section>

              {activeAiQuestionRecord.answer ? (
                <section className="local-reader-thought-modal-section local-reader-ai-answer-section">
                  <div className="local-reader-thought-modal-section-header">
                    <span>AI 回答</span>
                    <button
                      type="button"
                      className="local-reader-thought-modal-copy"
                      onClick={() =>
                        activeAiQuestionRecord.answer
                          ? void handleCopyThoughtText("回答", activeAiQuestionRecord.answer.answer)
                          : undefined
                      }
                    >
                      <Copy aria-hidden="true" size={14} />
                      <span>复制</span>
                    </button>
                  </div>
                  <div className="local-reader-thought-modal-content">
                    {activeAiQuestionRecord.answer.answer}
                  </div>
                  {activeAiQuestionRecord.answer.keyPoints.length > 0 ? (
                    <ul className="local-reader-ai-modal-list">
                      {activeAiQuestionRecord.answer.keyPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  {activeAiQuestionRecord.answer.followUpQuestions.length > 0 ? (
                    <div className="local-reader-ai-followups">
                      {activeAiQuestionRecord.answer.followUpQuestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => handleFollowUpAiQuestion(activeAiQuestionRecord, question)}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeAiQuestionRecord.errorMessage ? (
                <section className="local-reader-thought-modal-section">
                  <div className="local-reader-thought-modal-section-header">
                    <span>失败原因</span>
                  </div>
                  <div className="local-reader-thought-modal-content">
                    {activeAiQuestionRecord.errorMessage}
                  </div>
                </section>
              ) : null}

              {activeAiQuestionRecord.thread?.length ? (
                <section className="local-reader-thought-modal-section local-reader-ai-thread-section">
                  <div className="local-reader-thought-modal-section-header">
                    <span>追问线程</span>
                    <span className="local-reader-ai-scope">
                      {activeAiQuestionRecord.thread.length} 条追问
                    </span>
                  </div>
                  <ol className="local-reader-ai-thread-list">
                    {activeAiQuestionRecord.thread.map((turn, index) => (
                      <li key={turn.id} className={`is-${turn.status}`}>
                        <header>
                          <span>追问 {index + 1}</span>
                          <small>
                            {formatAiQuestionStatus(turn.status)} ·{" "}
                            {formatAiTimestamp(turn.updatedAt || turn.createdAt)}
                          </small>
                        </header>
                        <div className="local-reader-ai-thread-question">{turn.question}</div>
                        {turn.answer ? (
                          <>
                            <div className="local-reader-ai-thread-answer">
                              {turn.answer.answer}
                            </div>
                            {turn.answer.followUpQuestions.length > 0 ? (
                              <div className="local-reader-ai-followups">
                                {turn.answer.followUpQuestions.map((question) => (
                                  <button
                                    key={`${turn.id}-${question}`}
                                    type="button"
                                    onClick={() =>
                                      handleFollowUpAiQuestion(activeAiQuestionRecord, question)
                                    }
                                  >
                                    {question}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {turn.errorMessage ? (
                          <div className="local-reader-ai-thread-error">
                            {turn.errorMessage}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

            </div>

            <footer className="local-reader-thought-modal-actions">
              <button type="button" onClick={handleCloseAiQuestionDetail}>
                关闭
              </button>
              <button
                type="button"
                onClick={() => handleRevealAiQuestionSource(activeAiQuestionRecord)}
              >
                定位原文
              </button>
              <button
                type="button"
                onClick={() => handleFollowUpAiQuestion(activeAiQuestionRecord)}
              >
                继续追问
              </button>
              <button
                type="button"
                className={`is-danger ${
                  pendingDeleteAiQuestionRecordId === activeAiQuestionRecord.id ? "is-confirming" : ""
                }`}
                onClick={() => handleRequestRemoveAiQuestionRecord(activeAiQuestionRecord.id)}
              >
                {pendingDeleteAiQuestionRecordId === activeAiQuestionRecord.id
                  ? "确认删除"
                  : "删除记录"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {!error && !isLoading && !book ? (
        <section className="local-reader-pending" aria-label="本地图书不存在">
          <FileText aria-hidden="true" size={42} />
          <h3>本地图书不存在</h3>
        </section>
      ) : null}
    </section>
  );
}

function readReaderSelection(
  contentRoot: HTMLElement | null,
  contentLength: number,
  getEstimatedPopoverHeight?: (startOffset: number, endOffset: number) => number
): SelectionMenuState | undefined {
  if (!contentRoot) {
    return undefined;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  if (!contentRoot.contains(range.commonAncestorContainer)) {
    return undefined;
  }

  const normalizedRange = normalizeLocalReaderSelectionRange(
    readTextOffset(contentRoot, range.startContainer, range.startOffset),
    readTextOffset(contentRoot, range.endContainer, range.endOffset),
    contentLength
  );
  const selectedText = selection.toString().trim();
  if (!normalizedRange || !selectedText) {
    return undefined;
  }

  const rect = range.getBoundingClientRect();
  const anchorRect = getRangeAnchorRect(range) ?? rect;
  const position = getFloatingLayerPosition(anchorRect, {
    width: SELECTION_POPOVER_WIDTH,
    height:
      getEstimatedPopoverHeight?.(
        normalizedRange.startOffset,
        normalizedRange.endOffset
      ) ?? SELECTION_POPOVER_BASE_HEIGHT,
    bounds: getFloatingLayerBounds(contentRoot)
  });
  return {
    text: selectedText,
    startOffset: normalizedRange.startOffset,
    endOffset: normalizedRange.endOffset,
    left: position.left,
    top: position.top
  };
}

function getSelectionPopoverEstimatedHeight(
  relatedThoughtCount: number,
  relatedAiQuestionCount: number
): number {
  const relatedGroupCount =
    (relatedThoughtCount > 0 ? 1 : 0) + (relatedAiQuestionCount > 0 ? 1 : 0);

  return Math.min(
    SELECTION_POPOVER_MAX_HEIGHT,
    SELECTION_POPOVER_BASE_HEIGHT + relatedGroupCount * SELECTION_POPOVER_RELATED_GROUP_HEIGHT
  );
}

function readTextOffset(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

function clearReaderSelection() {
  window.getSelection()?.removeAllRanges();
}

function getRangeAnchorRect(range: Range): DOMRect | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
  );

  return rects[0];
}

function getFloatingLayerPosition(
  rect: DOMRect,
  options: {
    bounds?: DOMRect;
    preferredLeft?: number;
    width: number;
    height: number;
  }
): { left: number; top: number } {
  return {
    left: clampFloatingLayerLeft(
      options.preferredLeft ?? rect.left + rect.width / 2,
      options.width,
      options.bounds
    ),
    top: clampFloatingLayerTop(rect.top - 54, options.height, options.bounds)
  };
}

function getFloatingLayerBounds(anchor: Element): DOMRect | undefined {
  return anchor.closest(".local-reader-main-pane")?.getBoundingClientRect();
}

function clampFloatingLayerLeft(left: number, width: number, bounds?: DOMRect): number {
  if (typeof window === "undefined") {
    return Math.round(left);
  }

  const availableWidth = bounds
    ? bounds.width - FLOATING_LAYER_PADDING * 2
    : window.innerWidth - FLOATING_LAYER_PADDING * 2;
  const safeWidth = Math.max(
    0,
    Math.min(width, availableWidth, window.innerWidth - FLOATING_LAYER_PADDING * 2)
  );
  const halfWidth = safeWidth / 2;
  const minLeft = bounds
    ? bounds.left + FLOATING_LAYER_PADDING + halfWidth
    : FLOATING_LAYER_PADDING + halfWidth;
  const maxLeft = bounds
    ? bounds.right - FLOATING_LAYER_PADDING - halfWidth
    : window.innerWidth - FLOATING_LAYER_PADDING - halfWidth;

  return Math.round(
    clampNumber(
      left,
      minLeft,
      maxLeft
    )
  );
}

function clampFloatingLayerTop(top: number, height: number, bounds?: DOMRect): number {
  if (typeof window === "undefined") {
    return Math.max(58, Math.round(top));
  }

  const minTop = bounds
    ? Math.max(58, bounds.top + FLOATING_LAYER_PADDING)
    : 58;
  const maxTop = bounds
    ? Math.min(
        window.innerHeight - height - FLOATING_LAYER_PADDING,
        bounds.bottom - height - FLOATING_LAYER_PADDING
      )
    : window.innerHeight - height - FLOATING_LAYER_PADDING;

  return Math.round(
    clampNumber(
      top,
      minTop,
      Math.max(minTop, maxTop)
    )
  );
}

function getThoughtComposerStyle(thoughtDraft: ThoughtDraftState) {
  const isBelow = thoughtDraft.top < 260;
  const top = isBelow
    ? clampFloatingLayerTop(thoughtDraft.top + 48, THOUGHT_COMPOSER_HEIGHT)
    : clampThoughtComposerAnchorTop(thoughtDraft.top - 10);

  return {
    left: `${clampFloatingLayerLeft(thoughtDraft.left, THOUGHT_COMPOSER_WIDTH)}px`,
    top: `${top}px`
  };
}

function getAiQuestionComposerStyle(aiQuestionComposer: AiQuestionComposerState) {
  const isBelow = aiQuestionComposer.top < 280;
  const top = isBelow
    ? clampFloatingLayerTop(aiQuestionComposer.top + 48, AI_QUESTION_COMPOSER_HEIGHT)
    : clampAiQuestionComposerAnchorTop(aiQuestionComposer.top - 10);

  return {
    left: `${clampFloatingLayerLeft(aiQuestionComposer.left, AI_QUESTION_COMPOSER_WIDTH)}px`,
    top: `${top}px`
  };
}

function clampThoughtComposerAnchorTop(top: number): number {
  if (typeof window === "undefined") {
    return Math.max(58 + THOUGHT_COMPOSER_HEIGHT, Math.round(top));
  }

  return Math.round(
    clampNumber(
      top,
      58 + THOUGHT_COMPOSER_HEIGHT,
      window.innerHeight - FLOATING_LAYER_PADDING
    )
  );
}

function clampAiQuestionComposerAnchorTop(top: number): number {
  if (typeof window === "undefined") {
    return Math.max(58 + AI_QUESTION_COMPOSER_HEIGHT, Math.round(top));
  }

  return Math.round(
    clampNumber(
      top,
      58 + AI_QUESTION_COMPOSER_HEIGHT,
      window.innerHeight - FLOATING_LAYER_PADDING
    )
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function buildLocalReaderOutline(
  content: string,
  format?: LocalBookFormat
): LocalReaderOutlineItem[] {
  const items: LocalReaderOutlineItem[] = [];
  let offset = 0;
  let isMarkdownCodeBlock = false;

  for (const rawLine of content.split(/\n/)) {
    const title = rawLine.trim();
    if (format === "markdown" && isMarkdownFenceLine(title)) {
      isMarkdownCodeBlock = !isMarkdownCodeBlock;
    }

    const markdownHeading =
      format === "markdown" && !isMarkdownCodeBlock
        ? parseMarkdownOutlineHeading(title)
        : undefined;
    if (markdownHeading || isLocalReaderOutlineHeading(title)) {
      items.push({
        id: `outline-${items.length}-${offset}`,
        title: markdownHeading ?? title,
        offset
      });
    }

    offset += rawLine.length + 1;
  }

  return items.slice(0, 80);
}

function parseMarkdownOutlineHeading(title: string): string | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(title);
  if (!match) {
    return undefined;
  }

  const heading = match[2]?.trim();
  if (!heading || heading.length > 80) {
    return undefined;
  }

  return heading;
}

function isMarkdownFenceLine(title: string): boolean {
  return title.startsWith("```") || title.startsWith("~~~");
}

function isLocalReaderOutlineHeading(title: string): boolean {
  if (!title || title.length > 42) {
    return false;
  }

  return (
    /^第[\d零〇一二三四五六七八九十百千万两]+[章节回卷部篇集幕](?:[：:、\s-].{0,28})?$/.test(
      title
    ) ||
    /^Chapter\s+\d{1,3}(?:[.:：\s-].{0,28})?$/i.test(title)
  );
}

function buildLocalReaderSearchMatches(
  content: string,
  query: string
): LocalReaderSearchMatch[] {
  const keyword = query.trim();
  if (!content || !keyword) {
    return [];
  }

  const normalizedContent = content.toLocaleLowerCase();
  const normalizedKeyword = keyword.toLocaleLowerCase();
  const matches: LocalReaderSearchMatch[] = [];
  let cursor = normalizedContent.indexOf(normalizedKeyword);

  while (cursor >= 0 && matches.length < 200) {
    matches.push({
      id: `search-${matches.length}-${cursor}`,
      startOffset: cursor,
      endOffset: cursor + keyword.length
    });
    cursor = normalizedContent.indexOf(normalizedKeyword, cursor + Math.max(1, keyword.length));
  }

  return matches;
}

function buildLocalReaderMarkdownBlocks(content: string): LocalReaderMarkdownBlock[] {
  if (!content) {
    return [];
  }

  const blocks: LocalReaderMarkdownBlock[] = [];
  const linePattern = /.*(?:\n|$)/g;
  let match: RegExpExecArray | null;
  let isCodeBlock = false;

  while ((match = linePattern.exec(content))) {
    const rawLine = match[0] ?? "";
    if (!rawLine) {
      break;
    }

    const startOffset = match.index;
    const endOffset = startOffset + rawLine.length;
    const textEndOffset = endOffset - (rawLine.endsWith("\n") ? 1 : 0);
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    const id = `markdown-block-${blocks.length}-${startOffset}`;

    if (isCodeBlock) {
      blocks.push({
        id,
        kind: isMarkdownFenceLine(trimmed) ? "codeFence" : "codeLine",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: isMarkdownFenceLine(trimmed) ? textEndOffset : undefined
      });
      if (isMarkdownFenceLine(trimmed)) {
        isCodeBlock = false;
      }
      continue;
    }

    if (isMarkdownFenceLine(trimmed)) {
      blocks.push({
        id,
        kind: "codeFence",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: textEndOffset
      });
      isCodeBlock = true;
      continue;
    }

    const heading = parseMarkdownBlockHeading(line);
    if (heading) {
      blocks.push({
        id,
        kind: "heading",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: startOffset + heading.markerLength,
        visibleTextEndOffset: textEndOffset - heading.trailingMarkerLength,
        level: heading.level
      });
      continue;
    }

    const blockquote = /^(\s*>\s?)/.exec(line);
    if (blockquote?.[1]) {
      blocks.push({
        id,
        kind: "blockquote",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: startOffset + blockquote[1].length
      });
      continue;
    }

    const listItem = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)/.exec(line);
    if (listItem?.[0]) {
      blocks.push({
        id,
        kind: "listItem",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: startOffset + listItem[0].length,
        listOrdered: /\d/.test(listItem[2] ?? "")
      });
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({
        id,
        kind: "horizontalRule",
        startOffset,
        endOffset,
        textEndOffset,
        markerEndOffset: textEndOffset
      });
      continue;
    }

    blocks.push({
      id,
      kind: trimmed ? "paragraph" : "blank",
      startOffset,
      endOffset,
      textEndOffset
    });
  }

  return blocks;
}

function parseMarkdownBlockHeading(
  line: string
): { level: number; markerLength: number; trailingMarkerLength: number } | undefined {
  const match = /^(#{1,6})(\s+)(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }

  const body = match[3] ?? "";
  if (!body.trim()) {
    return undefined;
  }

  const trailingMarkerMatch = /\s+#{1,}\s*$/.exec(body);
  return {
    level: match[1]?.length ?? 1,
    markerLength: (match[1]?.length ?? 0) + (match[2]?.length ?? 0),
    trailingMarkerLength: trailingMarkerMatch?.[0]?.length ?? 0
  };
}

function renderLocalReaderInlineSegments({
  activeSearchMatch,
  contentRenderSegments,
  handleHighlightKeyDown,
  handleOpenHighlightMenu,
  rangeStartOffset,
  rangeEndOffset,
  revealedThoughtRange
}: {
  activeSearchMatch: LocalReaderSearchMatch | undefined;
  contentRenderSegments: Array<ReturnType<typeof buildLocalReaderHighlightSegments>[number] & {
    startOffset: number;
    endOffset: number;
  }>;
  handleHighlightKeyDown: (
    highlight: LocalReaderHighlight,
    event: KeyboardEvent<HTMLElement>
  ) => void;
  handleOpenHighlightMenu: (
    highlight: LocalReaderHighlight,
    event: MouseEvent<HTMLElement>
  ) => void;
  rangeStartOffset?: number;
  rangeEndOffset?: number;
  revealedThoughtRange?: Pick<SelectionMenuState, "startOffset" | "endOffset">;
}) {
  const start = rangeStartOffset ?? 0;
  const end = rangeEndOffset ?? Number.POSITIVE_INFINITY;
  const nodes: JSX.Element[] = [];

  contentRenderSegments.forEach((segment, index) => {
    const sliceStart = Math.max(segment.startOffset, start);
    const sliceEnd = Math.min(segment.endOffset, end);
    if (sliceStart >= sliceEnd) {
      return;
    }

    const text = segment.text.slice(
      sliceStart - segment.startOffset,
      sliceEnd - segment.startOffset
    );

    if (segment.kind === "highlight") {
      const isRevealed = isLocalReaderRangeRevealed(revealedThoughtRange, segment.highlight);
      nodes.push(
        <mark
          key={`${segment.highlight.id}-${index}-${sliceStart}-${sliceEnd}`}
          className={`local-reader-highlight local-reader-highlight--${segment.highlight.tone}${
            isRevealed ? " is-revealed" : ""
          }`}
          title={segment.highlight.text}
          role="button"
          tabIndex={0}
          onClick={(event) => handleOpenHighlightMenu(segment.highlight, event)}
          onMouseUp={(event) => event.stopPropagation()}
          onKeyDown={(event) => handleHighlightKeyDown(segment.highlight, event)}
        >
          {renderLocalReaderSegmentText(text, sliceStart, activeSearchMatch)}
        </mark>
      );
      return;
    }

    nodes.push(
      <Fragment key={`text-${index}-${sliceStart}-${sliceEnd}`}>
        {renderLocalReaderSegmentText(
          text,
          sliceStart,
          activeSearchMatch,
          revealedThoughtRange
        )}
      </Fragment>
    );
  });

  return nodes;
}

function renderLocalReaderMarkdownContent({
  activeSearchMatch,
  blocks,
  contentRenderSegments,
  handleHighlightKeyDown,
  handleOpenHighlightMenu,
  revealedThoughtRange
}: {
  activeSearchMatch: LocalReaderSearchMatch | undefined;
  blocks: LocalReaderMarkdownBlock[];
  contentRenderSegments: Array<ReturnType<typeof buildLocalReaderHighlightSegments>[number] & {
    startOffset: number;
    endOffset: number;
  }>;
  handleHighlightKeyDown: (
    highlight: LocalReaderHighlight,
    event: KeyboardEvent<HTMLElement>
  ) => void;
  handleOpenHighlightMenu: (
    highlight: LocalReaderHighlight,
    event: MouseEvent<HTMLElement>
  ) => void;
  revealedThoughtRange?: Pick<SelectionMenuState, "startOffset" | "endOffset">;
}) {
  return blocks.map((block) => {
    const commonProps = {
      key: block.id,
      className: `local-reader-markdown-block local-reader-markdown-block--${block.kind}`,
      "data-reader-block-kind": block.kind
    };
    const contentNode = renderLocalReaderMarkdownBlockInline({
      activeSearchMatch,
      block,
      contentRenderSegments,
      handleHighlightKeyDown,
      handleOpenHighlightMenu,
      revealedThoughtRange
    });

    if (block.kind === "heading") {
      const HeadingTag = `h${Math.min(6, Math.max(1, block.level ?? 2))}` as keyof JSX.IntrinsicElements;
      return <HeadingTag {...commonProps}>{contentNode}</HeadingTag>;
    }

    if (block.kind === "blockquote") {
      return <blockquote {...commonProps}>{contentNode}</blockquote>;
    }

    if (block.kind === "listItem") {
      return (
        <p
          {...commonProps}
          data-list-marker={block.listOrdered ? "ordered" : "unordered"}
        >
          {contentNode}
        </p>
      );
    }

    if (block.kind === "codeFence") {
      return (
        <p {...commonProps} aria-hidden="true">
          {contentNode}
        </p>
      );
    }

    if (block.kind === "codeLine") {
      return <pre {...commonProps}>{contentNode}</pre>;
    }

    if (block.kind === "horizontalRule") {
      return (
        <div {...commonProps} role="separator">
          {contentNode}
        </div>
      );
    }

    if (block.kind === "blank") {
      return <p {...commonProps}>{contentNode}</p>;
    }

    return <p {...commonProps}>{contentNode}</p>;
  });
}

function renderLocalReaderMarkdownBlockInline({
  activeSearchMatch,
  block,
  contentRenderSegments,
  handleHighlightKeyDown,
  handleOpenHighlightMenu,
  revealedThoughtRange
}: {
  activeSearchMatch: LocalReaderSearchMatch | undefined;
  block: LocalReaderMarkdownBlock;
  contentRenderSegments: Array<ReturnType<typeof buildLocalReaderHighlightSegments>[number] & {
    startOffset: number;
    endOffset: number;
  }>;
  handleHighlightKeyDown: (
    highlight: LocalReaderHighlight,
    event: KeyboardEvent<HTMLElement>
  ) => void;
  handleOpenHighlightMenu: (
    highlight: LocalReaderHighlight,
    event: MouseEvent<HTMLElement>
  ) => void;
  revealedThoughtRange?: Pick<SelectionMenuState, "startOffset" | "endOffset">;
}) {
  const contentStart = block.markerEndOffset ?? block.startOffset;
  const contentEnd = block.visibleTextEndOffset ?? block.textEndOffset;
  const hasHiddenPrefix = contentStart > block.startOffset;
  const hasHiddenSuffix = contentEnd < block.textEndOffset;
  const visibleContent =
    contentStart < contentEnd
      ? renderLocalReaderInlineSegments({
          activeSearchMatch,
          contentRenderSegments,
          handleHighlightKeyDown,
          handleOpenHighlightMenu,
          rangeStartOffset: contentStart,
          rangeEndOffset: contentEnd,
          revealedThoughtRange
        })
      : null;

  return (
    <>
      {hasHiddenPrefix ? (
        <span className="local-reader-markdown-syntax">
          {renderLocalReaderInlineSegments({
            activeSearchMatch,
            contentRenderSegments,
            handleHighlightKeyDown,
            handleOpenHighlightMenu,
            rangeStartOffset: block.startOffset,
            rangeEndOffset: contentStart,
            revealedThoughtRange
          })}
        </span>
      ) : null}
      {visibleContent}
      {hasHiddenSuffix ? (
        <span className="local-reader-markdown-syntax">
          {renderLocalReaderInlineSegments({
            activeSearchMatch,
            contentRenderSegments,
            handleHighlightKeyDown,
            handleOpenHighlightMenu,
            rangeStartOffset: contentEnd,
            rangeEndOffset: block.textEndOffset,
            revealedThoughtRange
          })}
        </span>
      ) : null}
      {block.endOffset > block.textEndOffset ? (
        <span className="local-reader-markdown-newline">{"\n"}</span>
      ) : null}
    </>
  );
}

function renderLocalReaderSegmentText(
  text: string,
  segmentStartOffset: number,
  activeSearchMatch: LocalReaderSearchMatch | undefined,
  revealedRange?: Pick<SelectionMenuState, "startOffset" | "endOffset">
) {
  if (revealedRange) {
    const revealStart = Math.max(0, revealedRange.startOffset - segmentStartOffset);
    const revealEnd = Math.min(text.length, revealedRange.endOffset - segmentStartOffset);

    if (revealStart < revealEnd) {
      return (
        <>
          {renderLocalReaderSearchText(
            text.slice(0, revealStart),
            segmentStartOffset,
            activeSearchMatch
          )}
          <span className="local-reader-source-reveal is-revealed" data-reader-source-reveal="true">
            {renderLocalReaderSearchText(
              text.slice(revealStart, revealEnd),
              segmentStartOffset + revealStart,
              activeSearchMatch
            )}
          </span>
          {renderLocalReaderSearchText(
            text.slice(revealEnd),
            segmentStartOffset + revealEnd,
            activeSearchMatch
          )}
        </>
      );
    }
  }

  return renderLocalReaderSearchText(text, segmentStartOffset, activeSearchMatch);
}

function renderLocalReaderSearchText(
  text: string,
  segmentStartOffset: number,
  activeSearchMatch: LocalReaderSearchMatch | undefined
) {
  if (!activeSearchMatch) {
    return text;
  }

  const matchStart = activeSearchMatch.startOffset - segmentStartOffset;
  const matchEnd = activeSearchMatch.endOffset - segmentStartOffset;
  if (matchStart < 0 || matchEnd > text.length || matchStart >= matchEnd) {
    return text;
  }

  return (
    <>
      {text.slice(0, matchStart)}
      <span className="local-reader-search-hit" data-search-hit="true">
        {text.slice(matchStart, matchEnd)}
      </span>
      {text.slice(matchEnd)}
    </>
  );
}

function formatHighlightToneLabel(tone: LocalReaderHighlightTone): string {
  if (tone === "green") {
    return "标记";
  }

  if (tone === "blue") {
    return "疑问";
  }

  return "划线";
}

function formatFontScaleLabel(value: LocalReaderFontScale): string {
  return FONT_SCALE_OPTIONS.find((option) => option.value === value)?.label ?? "标准";
}

function formatLineSpacingLabel(value: LocalReaderLineSpacing): string {
  return LINE_SPACING_OPTIONS.find((option) => option.value === value)?.label ?? "标准";
}

function formatReaderThemeLabel(value: LocalReaderTheme): string {
  return THEME_OPTIONS.find((option) => option.value === value)?.label ?? "纸张";
}

function formatLocalReaderFormatLabel(format: LocalBookFormat): string {
  if (format === "markdown") {
    return "Markdown";
  }

  return format.toUpperCase();
}

function isLocalReaderToolbarPanelTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".local-reader-outline-control, .local-reader-tool-control, .local-reader-search-control"
      )
    )
  );
}

function findThoughtsForRange(
  thoughts: LocalReaderThought[],
  startOffset: number,
  endOffset: number
): LocalReaderThought[] {
  return thoughts
    .filter((thought) => thought.startOffset < endOffset && thought.endOffset > startOffset)
    .slice(0, 2);
}

function findAiQuestionRecordsForRange(
  records: LocalReaderAiQuestionRecord[],
  startOffset: number,
  endOffset: number
): LocalReaderAiQuestionRecord[] {
  return records
    .filter((record) => record.startOffset < endOffset && record.endOffset > startOffset)
    .slice(0, 2);
}

function isLocalReaderRangeRevealed(
  range: Pick<SelectionMenuState, "startOffset" | "endOffset"> | undefined,
  target: Pick<SelectionMenuState, "startOffset" | "endOffset">
): boolean {
  return Boolean(
    range && target.startOffset < range.endOffset && target.endOffset > range.startOffset
  );
}

function createAiQuestionRecordAnswer(
  response: LocalReaderAiQuestionResponse
): NonNullable<LocalReaderAiQuestionRecord["answer"]> {
  return {
    answer: response.answer.answer,
    keyPoints: response.answer.keyPoints,
    followUpQuestions: response.answer.followUpQuestions,
    generatedAt: response.answer.generatedAt,
    promptVersion: response.answer.promptVersion,
    ...(response.answer.responseFormat ? { responseFormat: response.answer.responseFormat } : {}),
    basisNotice: response.answer.basisNotice,
    ...(response.providerModel ? { providerModel: response.providerModel } : {}),
    inputHash: response.inputHash
  };
}

function shouldUseLocalReaderPreviewMarks(bookId: string, content: string): boolean {
  if (!bookId.startsWith("preview-") || !content || typeof window === "undefined") {
    return false;
  }

  const searchParams = new URLSearchParams(window.location.search);
  return (
    searchParams.get("local-reader-preview") === "1" &&
    searchParams.get("local-reader-preview-marks") === "1"
  );
}

function buildLocalReaderPreviewHighlights(
  bookId: string,
  content: string
): LocalReaderHighlight[] {
  return [
    createPreviewHighlight(bookId, content, {
      id: "preview-highlight-quiet-reader",
      snippet: "阅读器应该安静、轻便，不抢正文的注意力。",
      tone: "green",
      createdAt: "2025-05-19T20:18:00+08:00"
    }),
    createPreviewHighlight(bookId, content, {
      id: "preview-highlight-present",
      snippet: "我们总在追赶未来，却常常错过了当下。",
      tone: "yellow",
      createdAt: "2025-05-19T20:21:00+08:00"
    }),
    createPreviewHighlight(bookId, content, {
      id: "preview-highlight-local-boundary",
      snippet: "本地版本和微信读书版本会继续隔离保存",
      tone: "blue",
      createdAt: "2025-05-19T20:25:00+08:00"
    })
  ].filter((highlight): highlight is LocalReaderHighlight => Boolean(highlight));
}

function buildLocalReaderPreviewThoughts(bookId: string, content: string): LocalReaderThought[] {
  return [
    createPreviewThought(bookId, content, {
      id: "preview-thought-selection-tool",
      snippet: "划线、想法和向 AI 提问都围绕选中文本出现",
      note: "这里应该保持轻量：正文里完成选择，悬浮工具只承载当前动作，长想法再进入详情弹窗。",
      createdAt: "2025-05-19T20:22:00+08:00"
    }),
    createPreviewThought(bookId, content, {
      id: "preview-thought-source-boundary",
      snippet: "进度、划线、章节位置和 AI 缓存都不会自动合并",
      note: "本地版本和微信版本要像两个清晰来源，允许用户手动关联，但不要默认合并数据。",
      createdAt: "2025-05-19T20:27:00+08:00"
    })
  ].filter((thought): thought is LocalReaderThought => Boolean(thought));
}

function buildLocalReaderPreviewAiQuestions(
  bookId: string,
  content: string
): LocalReaderAiQuestionRecord[] {
  const range = findPreviewTextRange(
    content,
    "我们总在追赶未来，却常常错过了当下。其实，生活并不需要太多的计划和目标"
  );
  if (!range) {
    return [];
  }

  return [
    {
      id: "preview-ai-question-present",
      bookId,
      source: "local",
      status: "draft",
      question: "这段话的核心观点可以怎么概括？",
      selectedText: range.text,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      createdAt: "2025-05-19T20:29:00+08:00",
      updatedAt: "2025-05-19T20:29:00+08:00"
    }
  ];
}

function getAiQuestionRecordDisplayStatus(
  record: LocalReaderAiQuestionRecord
): LocalReaderAiQuestionRecord["status"] {
  const latestTurn = record.thread?.[record.thread.length - 1];
  return latestTurn?.status ?? record.status;
}

function formatAiQuestionRecordTurnSummary(record: LocalReaderAiQuestionRecord): string {
  const turnCount = record.thread?.length ?? 0;
  return turnCount > 0 ? `${turnCount + 1} 轮` : "";
}

function normalizeAiQuestionText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function createPreviewHighlight(
  bookId: string,
  content: string,
  input: {
    id: string;
    snippet: string;
    tone: LocalReaderHighlightTone;
    createdAt: string;
  }
): LocalReaderHighlight | undefined {
  const range = findPreviewTextRange(content, input.snippet);
  if (!range) {
    return undefined;
  }

  return {
    id: input.id,
    bookId,
    text: range.text,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    tone: input.tone,
    createdAt: input.createdAt
  };
}

function createPreviewThought(
  bookId: string,
  content: string,
  input: {
    id: string;
    snippet: string;
    note: string;
    createdAt: string;
  }
): LocalReaderThought | undefined {
  const range = findPreviewTextRange(content, input.snippet);
  if (!range) {
    return undefined;
  }

  return {
    id: input.id,
    bookId,
    selectedText: range.text,
    note: input.note,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    createdAt: input.createdAt
  };
}

function findPreviewTextRange(
  content: string,
  snippet: string
): { text: string; startOffset: number; endOffset: number } | undefined {
  const startOffset = content.indexOf(snippet);
  if (startOffset < 0) {
    return undefined;
  }

  return {
    text: snippet,
    startOffset,
    endOffset: startOffset + snippet.length
  };
}

function formatAiQuestionStatus(status: LocalReaderAiQuestionRecord["status"]): string {
  if (status === "answered") {
    return "已回答";
  }

  if (status === "pending") {
    return "生成中";
  }

  if (status === "failed") {
    return "失败";
  }

  return "草稿";
}

function scrollReaderToTextRange(
  reader: HTMLElement,
  contentRoot: HTMLElement,
  startOffset: number,
  endOffset: number
): boolean {
  const startPoint = findTextPointAtOffset(contentRoot, startOffset);
  if (!startPoint) {
    return false;
  }

  const endPoint = findTextPointAtOffset(contentRoot, endOffset);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  if (endPoint) {
    range.setEnd(endPoint.node, endPoint.offset);
  } else {
    range.collapse(true);
  }

  const rect = getRangeAnchorRect(range) ?? range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }

  const readerRect = reader.getBoundingClientRect();
  const targetTop =
    reader.scrollTop + rect.top - readerRect.top - Math.round(reader.clientHeight * 0.32);
  reader.scrollTo({
    top: snapScrollTopToTextLine(reader, targetTop),
    behavior: "smooth"
  });
  return true;
}

function findTextPointAtOffset(
  root: HTMLElement,
  targetOffset: number
): { node: Text; offset: number } | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let lastTextNode: Text | undefined;
  let node = walker.nextNode();

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const textLength = textNode.textContent?.length ?? 0;
      lastTextNode = textNode;

      if (targetOffset <= currentOffset + textLength) {
        return {
          node: textNode,
          offset: clampNumber(targetOffset - currentOffset, 0, textLength)
        };
      }

      currentOffset += textLength;
    }

    node = walker.nextNode();
  }

  if (!lastTextNode) {
    return undefined;
  }

  return {
    node: lastTextNode,
    offset: lastTextNode.textContent?.length ?? 0
  };
}

function snapScrollTopToTextLine(reader: HTMLElement, scrollTop: number): number {
  const textRoot = reader.querySelector<HTMLElement>(".local-reader-content") ?? reader;
  const lineHeight = Number.parseFloat(window.getComputedStyle(textRoot).lineHeight);

  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    return scrollTop;
  }

  const lineOrigin = textRoot.offsetTop;
  const snapped = lineOrigin + Math.round((scrollTop - lineOrigin) / lineHeight) * lineHeight;
  return Math.max(0, snapped);
}
