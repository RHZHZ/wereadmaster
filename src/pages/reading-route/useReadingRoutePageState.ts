import { useEffect, useRef, useState } from "react";
import {
  exportReadingRouteMarkdown,
  getAiSettingsState,
  getCommandErrorMessage,
  getLatestReadingRoute,
  listReadingItemStates,
  summarizeReadingRoute
} from "../../lib/reading-api";
import type {
  AiSettingsState,
  BookDetail,
  BookAiSummarySource,
  ExportAiMarkdownResponse,
  ReadingItemState,
  ReadingProgress,
  PreparedAssetUpdate,
  ReadingRouteBookInput,
  ReadingRouteRequest,
  ReadingRouteResponse,
  ShelfEntry
} from "../../lib/types";

type RouteStatus =
  | "idle"
  | "setup-required"
  | "loading-inputs"
  | "loading-cache"
  | "generating"
  | "cached"
  | "generated"
  | "error";

type ReadingRoutePageInput = {
  shelfEntry?: ShelfEntry;
  detail?: BookDetail;
  progress?: ReadingProgress;
  preparedUpdate?: PreparedAssetUpdate;
};

export function useReadingRoutePageState({ shelfEntry, detail, progress, preparedUpdate }: ReadingRoutePageInput) {
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [readingStates, setReadingStates] = useState<ReadingItemState[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());
  const [routeResponse, setRouteResponse] = useState<ReadingRouteResponse>();
  const [status, setStatus] = useState<RouteStatus>("idle");
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isLoadingInputs, setIsLoadingInputs] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportAiMarkdownResponse>();
  const [error, setError] = useState<string>();
  const aiStateRef = useRef<AiSettingsState>();

  const currentBook = buildCurrentBookInput(shelfEntry, detail, progress);
  const candidateBooks = buildCandidateBooks(readingStates, currentBook?.bookId);
  const selectedCandidates = candidateBooks.filter((book) => selectedCandidateIds.has(book.bookId));
  const hasCandidateSelection = selectedCandidates.length > 0;
  const request = currentBook ? buildRouteRequest(currentBook, selectedCandidates) : undefined;
  const route = routeResponse?.route;
  const hasRoute = Boolean(route);
  const isCrossBookRoute = (route?.sourceStats.candidateCount ?? selectedCandidates.length) > 0;
  const pageTitle = isCrossBookRoute ? "跨书阅读路线图" : "本书阅读指南";
  const resultTitle = isCrossBookRoute ? "跨书路线图" : "本书指南图";
  const canGenerate =
    Boolean(request) &&
    aiState?.credential.hasCredential === true &&
    !isLoadingSettings &&
    !isLoadingInputs &&
    !isLoadingCache &&
    status !== "generating";
  const isPreparedUpdate = preparedUpdate?.feature === "reading-route";
  const canRegenerate = canGenerate && (hasRoute || isPreparedUpdate);
  const missingPreparedCandidateCount =
    preparedUpdate?.candidateBookIds?.filter((bookId) => !candidateBooks.some((book) => book.bookId === bookId)).length ?? 0;
  const statusMeta = statusMetaFromState(status, Boolean(routeResponse?.errorMessage));

  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialState() {
      setIsLoadingSettings(true);
      setIsLoadingInputs(true);
      setError(undefined);

      const [settingsResult, statesResult] = await Promise.allSettled([
        getAiSettingsState(),
        listReadingItemStates()
      ]);

      if (!isMounted) {
        return;
      }

      if (settingsResult.status === "fulfilled") {
        setAiState(settingsResult.value);
        setStatus(statusFromAiState(settingsResult.value));
      } else {
        setStatus("error");
        setError(getCommandErrorMessage(settingsResult.reason));
      }

      if (statesResult.status === "fulfilled") {
        const nextStates = statesResult.value;
        setReadingStates(nextStates);
        setSelectedCandidateIds(new Set(buildRestoredCandidateIds(nextStates, currentBook?.bookId, preparedUpdate)));
      } else {
        setStatus("error");
        setError(getCommandErrorMessage(statesResult.reason));
      }

      setIsLoadingSettings(false);
      setIsLoadingInputs(false);
    }

    void loadInitialState();

    return () => {
      isMounted = false;
    };
  }, [currentBook?.bookId, preparedUpdate?.inputHash]);

  useEffect(() => {
    let isMounted = true;

    async function loadCachedRoute() {
      if (!request) {
        setStatus("error");
        setError("缺少当前书，无法读取阅读指南缓存。");
        return;
      }

      setRouteResponse(undefined);
      setExportResult(undefined);
      setIsLoadingCache(true);
      setError(undefined);
      setStatus("loading-cache");

      try {
        const cached = await getLatestReadingRoute(request);
        if (!isMounted) {
          return;
        }

        if (cached) {
          setRouteResponse(cached);
          setStatus(statusFromSource(cached.source));
          setError(cached.errorMessage);
          return;
        }

        setStatus(statusFromAiState(aiStateRef.current));
      } catch (cacheError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorMessage(cacheError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingCache(false);
        }
      }
    }

    void loadCachedRoute();

    return () => {
      isMounted = false;
    };
  }, [requestKey(request)]);

  function handleCandidateToggle(bookId: string) {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }

      return next;
    });
  }

  function handleSelectAllCandidates() {
    setSelectedCandidateIds(new Set(candidateBooks.map((book) => book.bookId)));
  }

  function handleClearCandidates() {
    setSelectedCandidateIds(new Set());
  }

  async function handleGenerate(regenerate: boolean) {
    if (!request) {
      setStatus("error");
      setError("缺少当前书，无法生成阅读指南。");
      return;
    }

    if (aiState?.credential.hasCredential !== true) {
      setStatus("setup-required");
      return;
    }

    setStatus("generating");
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await summarizeReadingRoute({ request, regenerate });
      setRouteResponse(response);
      setStatus(statusFromSource(response.source));
      setError(response.errorMessage);
    } catch (routeError) {
      setStatus("error");
      setError(getCommandErrorMessage(routeError));
    }
  }

  async function handleExport() {
    if (!request || !hasRoute) {
      return;
    }

    setIsExporting(true);
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await exportReadingRouteMarkdown(request);
      setExportResult(response);
    } catch (exportError) {
      setError(getCommandErrorMessage(exportError));
    } finally {
      setIsExporting(false);
    }
  }

  return {
    aiState,
    currentBook,
    candidateBooks,
    selectedCandidates,
    routeResponse,
    route,
    status,
    isLoadingSettings,
    isLoadingInputs,
    isLoadingCache,
    isExporting,
    exportResult,
    error,
    hasCandidateSelection,
    hasRoute,
    isCrossBookRoute,
    pageTitle,
    resultTitle,
    canGenerate,
    canRegenerate,
    isPreparedUpdate,
    missingPreparedCandidateCount,
    statusMeta,
    handleCandidateToggle,
    handleSelectAllCandidates,
    handleClearCandidates,
    handleGenerate,
    handleExport
  };
}

function buildCurrentBookInput(
  shelfEntry?: ShelfEntry,
  detail?: BookDetail,
  progress?: ReadingProgress
): ReadingRouteBookInput | undefined {
  const bookId = detail?.bookId ?? shelfEntry?.id;
  const title = detail?.title ?? shelfEntry?.title;
  if (!bookId || !title) {
    return undefined;
  }

  return {
    bookId,
    title,
    author: detail?.author ?? shelfEntry?.author,
    category: detail?.category ?? shelfEntry?.category,
    progressPercent: progress?.progressPercent,
    isFinished: progress?.isFinished ?? shelfEntry?.isFinished
  };
}

function buildCandidateBooks(states: ReadingItemState[], currentBookId?: string): ReadingRouteBookInput[] {
  return states
    .filter((state) => state.itemType === "candidate" && state.status === "toRead" && state.itemId !== currentBookId)
    .slice(0, 8)
    .map((state) => ({
      bookId: state.itemId,
      title: state.title || "未命名候选书",
      author: state.author,
      category: state.category,
      localStatus: "toRead"
    }));
}

function buildRestoredCandidateIds(
  states: ReadingItemState[],
  currentBookId: string | undefined,
  preparedUpdate?: PreparedAssetUpdate
): string[] {
  if (preparedUpdate?.feature !== "reading-route" || !preparedUpdate.candidateBookIds?.length) {
    return [];
  }

  const availableCandidates = new Set(buildCandidateBooks(states, currentBookId).map((book) => book.bookId));
  return preparedUpdate.candidateBookIds.filter((bookId) => availableCandidates.has(bookId));
}

function buildRouteRequest(
  book: ReadingRouteBookInput,
  candidates: ReadingRouteBookInput[]
): ReadingRouteRequest {
  return {
    book,
    candidates
  };
}

function requestKey(request?: ReadingRouteRequest): string {
  if (!request) {
    return "empty";
  }

  return [request.book.bookId, ...request.candidates.map((book) => book.bookId)].join("|");
}

function statusMetaFromState(status: RouteStatus, hasStaleCacheError: boolean) {
  if (status === "setup-required") {
    return { label: "需要设置", tone: "warning" };
  }

  if (status === "loading-inputs") {
    return { label: "读取输入中", tone: "neutral" };
  }

  if (status === "loading-cache") {
    return { label: "读取缓存中", tone: "neutral" };
  }

  if (status === "generating") {
    return { label: "生成中", tone: "neutral" };
  }

  if (status === "cached") {
    return { label: "本地缓存", tone: "neutral" };
  }

  if (status === "generated") {
    return { label: "已生成", tone: "success" };
  }

  if (status === "error") {
    return { label: hasStaleCacheError ? "使用旧缓存" : "生成失败", tone: "warning" };
  }

  return { label: "待生成", tone: "neutral" };
}

function statusFromAiState(aiState?: AiSettingsState): RouteStatus {
  if (!aiState) {
    return "idle";
  }

  return aiState.credential.hasCredential ? "idle" : "setup-required";
}

function statusFromSource(source: BookAiSummarySource): RouteStatus {
  if (source === "generated") {
    return "generated";
  }

  if (source === "cache" || source === "staleCache") {
    return "cached";
  }

  return "idle";
}
