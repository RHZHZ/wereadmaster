import { startTransition, useEffect, useState } from "react";
import {
  exportReadingStatsReviewMarkdown,
  getAiSettingsState,
  getCommandErrorInfo,
  getLatestReadingStatsReview,
  getReadingStats,
  summarizeReadingStats,
  syncReadingStats,
  type CommandErrorInfo,
  type ReadingStatsResponse
} from "../../../lib/reading-api";
import {
  buildReadingPersona,
  extractRepresentativeThemes,
  resolveReadingPersona
} from "../../../lib/business-rules";
import type {
  AiSettingsState,
  CredentialStatus,
  ExportAiMarkdownResponse,
  ReadingStatsAiReviewResponse,
  ReadingStatsMode
} from "../../../lib/types";
import {
  buildReadingStatsPeriod,
  canShiftReadingStatsPeriod,
  getReadingStatsRequestBaseTime,
  getReadingStatsResponse,
  shiftReadingStatsPeriod,
  type ReadingStatsCache,
  type ReadingStatsPeriod
} from "../../../pages/reading-stats-period";
import {
  buildReadingStatsDrillPeriods,
  getPeakReadingBucket,
  getTopReadingCategory,
  hasReadingStatsData
} from "../../reading-stats/reading-stats-view-helpers";
import {
  buildReviewTimelineInsights,
  buildReviewTimelineSegments,
  statusMetaFromState,
  statusFromAiState,
  statusFromSource,
  type ReviewStatus
} from "../review-page-helpers";

type UseReadingReviewPageArgs = {
  credentialStatus?: CredentialStatus;
  cache: ReadingStatsCache;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
};

export function useReadingReviewPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings
}: UseReadingReviewPageArgs) {
  const [period, setPeriod] = useState<ReadingStatsPeriod>(() => buildReadingStatsPeriod("monthly"));
  const [aiState, setAiState] = useState<AiSettingsState>();
  const [reviewResponse, setReviewResponse] = useState<ReadingStatsAiReviewResponse>();
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isLoadingReviewCache, setIsLoadingReviewCache] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportAiMarkdownResponse>();
  const [error, setError] = useState<CommandErrorInfo>();
  const hasCredential = credentialStatus?.hasCredential === true;
  const stats = getReadingStatsResponse(cache, period)?.stats;
  const activePeriod = stats ? buildReadingStatsPeriod(stats.mode, stats.baseTime) : period;
  const canStepForward = canShiftReadingStatsPeriod(activePeriod, 1);
  const drillPeriods = buildReadingStatsDrillPeriods(stats);
  const review = reviewResponse?.review;
  const hasStatsData = hasReadingStatsData(stats);
  const isPreviewReadonly = aiState?.provider.model === "preview-readonly";
  const canGenerate =
    Boolean(stats) &&
    hasStatsData &&
    aiState?.credential.hasCredential === true &&
    !isPreviewReadonly &&
    status !== "generating" &&
    !isLoadingReviewCache &&
    !isLoadingStats;
  const peakBucket = getPeakReadingBucket(stats);
  const topCategory = getTopReadingCategory(stats?.categories ?? []);
  const timeSegments = buildReviewTimelineSegments(stats);
  const timelineInsights = buildReviewTimelineInsights(timeSegments, review?.rhythmInsights ?? []);
  const representativeThemes = extractRepresentativeThemes(stats);
  const localPersona = buildReadingPersona(stats);
  const readingPersona = resolveReadingPersona(localPersona, review?.readingPersona);
  const statusMeta = statusMetaFromState(status, Boolean(reviewResponse?.errorMessage));
  const isStaleCache = reviewResponse?.source === "staleCache";

  useEffect(() => {
    let isMounted = true;

    async function loadAiState() {
      try {
        const nextState = await getAiSettingsState();
        if (!isMounted) {
          return;
        }

        setAiState(nextState);
        setStatus((current) =>
          current === "cached" ||
          current === "generated" ||
          current === "generating" ||
          current === "loading-cache"
            ? current
            : statusFromAiState(nextState)
        );
      } catch (settingsError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorInfo(settingsError));
        }
      }
    }

    void loadAiState();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      if (stats) {
        setError(undefined);
        setIsLoadingStats(false);
        return;
      }

      setIsLoadingStats(true);
      setError(undefined);

      try {
        const cached = await getReadingStats(period.mode, getReadingStatsRequestBaseTime(period));
        if (isMounted) {
          onCacheChange(period.mode, cached);
        }
      } catch (statsError) {
        if (isMounted) {
          setError(getCommandErrorInfo(statsError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingStats(false);
        }
      }
    }

    void loadStats();

    return () => {
      isMounted = false;
    };
  }, [onCacheChange, period, stats]);

  useEffect(() => {
    setReviewResponse(undefined);
    setError(undefined);
    setStatus(statusFromAiState(aiState));
  }, [aiState, period, stats?.baseTime]);

  useEffect(() => {
    let isMounted = true;

    async function loadCachedReview() {
      if (!stats || !hasStatsData) {
        setIsLoadingReviewCache(false);
        return;
      }

      setIsLoadingReviewCache(true);
      setError(undefined);
      setStatus("loading-cache");

      try {
        const cached = await getLatestReadingStatsReview({
          mode: stats.mode,
          baseTime: stats.baseTime
        });

        if (!isMounted) {
          return;
        }

        if (cached) {
          setReviewResponse(cached);
          setStatus(statusFromSource(cached.source));
          setError(cached.errorMessage ? { message: cached.errorMessage } : undefined);
          return;
        }

        setReviewResponse(undefined);
        setStatus(statusFromAiState(aiState));
      } catch (cacheError) {
        if (isMounted) {
          setStatus("error");
          setError(getCommandErrorInfo(cacheError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingReviewCache(false);
        }
      }
    }

    void loadCachedReview();

    return () => {
      isMounted = false;
    };
  }, [aiState, hasStatsData, stats]);

  async function handleSyncStats() {
    if (!hasCredential) {
      setError({ message: "请先在设置中保存微信读书 API Key，再同步阅读统计。" });
      onOpenSettings();
      return;
    }

    setIsSyncing(true);
    setError(undefined);

    try {
      const synced = await syncReadingStats(period.mode, getReadingStatsRequestBaseTime(period));
      onCacheChange(period.mode, synced);
    } catch (syncError) {
      setError(getCommandErrorInfo(syncError));
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleGenerate(regenerate: boolean) {
    if (!stats) {
      setError({ message: "请先读取或同步当前周期统计，再生成阅读复盘。" });
      return;
    }

    if (!hasStatsData) {
      setError({ message: "当前周期还没有可复盘的统计数据。" });
      return;
    }

    if (isPreviewReadonly) {
      setError({ message: "Web 预览只支持查看已缓存复盘，生成请在桌面应用中执行。" });
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
      const response = await summarizeReadingStats({
        mode: stats.mode,
        baseTime: stats.baseTime,
        regenerate
      });
      setReviewResponse(response);
      setStatus(statusFromSource(response.source));
      if (response.errorMessage) {
        setError({ message: response.errorMessage });
      }
    } catch (reviewError) {
      setStatus("error");
      setError(getCommandErrorInfo(reviewError));
    }
  }

  async function handleExport() {
    if (!stats || !review) {
      return;
    }

    if (isPreviewReadonly) {
      setError({ message: "Web 预览只支持查看已缓存复盘，导出请在桌面应用中执行。" });
      return;
    }

    setIsExporting(true);
    setError(undefined);
    setExportResult(undefined);

    try {
      const response = await exportReadingStatsReviewMarkdown({
        mode: stats.mode,
        baseTime: stats.baseTime
      });
      setExportResult(response);
    } catch (exportError) {
      setError(getCommandErrorInfo(exportError));
    } finally {
      setIsExporting(false);
    }
  }

  function handleModeChange(nextMode: ReadingStatsMode) {
    startTransition(() => {
      setPeriod(buildReadingStatsPeriod(nextMode));
    });
  }

  function handleShiftPeriod(offset: -1 | 1) {
    startTransition(() => {
      setPeriod(shiftReadingStatsPeriod(activePeriod, offset));
    });
  }

  function handleDrillPeriod(nextPeriod: ReadingStatsPeriod) {
    startTransition(() => {
      setPeriod(nextPeriod);
    });
  }

  return {
    activePeriod,
    aiState,
    canGenerate,
    canStepForward,
    drillPeriods,
    error,
    exportResult,
    handleDrillPeriod,
    handleExport,
    handleGenerate,
    handleModeChange,
    handleShiftPeriod,
    handleSyncStats,
    hasCredential,
    hasStatsData,
    isExporting,
    isLoadingReviewCache,
    isLoadingStats,
    isPreviewReadonly,
    isStaleCache,
    isSyncing,
    peakBucket,
    period,
    readingPersona,
    representativeThemes,
    review,
    reviewResponse,
    stats,
    status,
    statusMeta,
    timeSegments,
    timelineInsights,
    topCategory
  };
}
