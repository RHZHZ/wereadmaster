import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Loader2,
  RefreshCw
} from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { CredentialSetupCard } from "../components/CredentialSetupCard";
import { ReadingStatsPeriodJumpPicker } from "../components/ReadingStatsPeriodJumpPicker";
import { ReadingStatsPeriodNavigator } from "../components/ReadingStatsPeriodNavigator";
import { ReadingRank } from "../components/ReadingRank";
import { ReadingTrend } from "../components/ReadingTrend";
import { SkillUpgradeNotice } from "../components/SkillUpgradeNotice";
import { ReportGenerationWizardDialog } from "../features/reading-stats/components/ReportGenerationWizardDialog";
import { useReadingStatsPage } from "../features/reading-stats/hooks/useReadingStatsPage";
import {
  buildLifetimeReadingReportData,
  downloadLifetimeReadingReportWide,
  type LifetimeReadingReportCompleteness
} from "../features/reading-stats/lifetime-reading-report";
import {
  buildPeriodReportData,
  downloadPeriodReportPoster,
  downloadPeriodReportStoryPage,
  downloadPeriodReportStoryPages,
  downloadPeriodReportWideReport,
  type PeriodReportCompleteness,
  type PeriodReportDownloadMode
} from "../features/reading-stats/period-report";
import type { ReportImageExportResult } from "../features/reading-stats/report-image-export";
import { hasReadingStatsData } from "../features/reading-stats/reading-stats-view-helpers";
import { StatsFootnote } from "../features/reading-stats/components/StatsFootnote";
import { StatsHeroSection } from "../features/reading-stats/components/StatsHeroSection";
import { StatsLocalInsights } from "../features/reading-stats/components/StatsLocalInsights";
import { StatsPreferenceSection } from "../features/reading-stats/components/StatsPreferenceSection";
import { StatsSummarySection } from "../features/reading-stats/components/StatsSummarySection";
import { buildStatsSummarySparklineSeries } from "../features/reading-stats/stats-sparkline-helpers";
import { formatUnixDate } from "../lib/formatters";
import {
  getCommandErrorInfo,
  getCommandErrorMessage,
  getLatestReadingStatsReview,
  getReadingStats,
  syncReadingStats,
  type CommandErrorInfo,
  type ReadingStatsResponse
} from "../lib/reading-api";
import {
  formatArtifactCreatedMessage,
  formatArtifactExportedMessage,
  type ReadingArtifactKind
} from "../lib/reading-artifacts";
import type { CredentialStatus, ReadingStatsAiReviewResponse, ReadingStatsMode } from "../lib/types";
import {
  buildReadingStatsPeriod,
  getCurrentReadingStatsAnchor,
  getReadingStatsRequestBaseTime,
  getReadingStatsResponse,
  type ReadingStatsCache,
  type ReadingStatsPeriod
} from "./reading-stats-period";

type StatisticsPageProps = {
  credentialStatus?: CredentialStatus;
  cache: ReadingStatsCache;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
  onOpenReview: () => void;
  defaultMode?: ReadingStatsMode;
};

const periodOptions: Array<{ mode: ReadingStatsMode; label: string; description: string }> = [
  { mode: "weekly", label: "周度", description: "自然周" },
  { mode: "monthly", label: "月度", description: "自然月" },
  { mode: "annually", label: "年度", description: "自然年" },
  { mode: "overall", label: "总计", description: "全部历史" }
];

export function StatisticsPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings,
  onOpenReview,
  defaultMode = "monthly"
}: StatisticsPageProps) {
  const [isJumpPickerOpen, setIsJumpPickerOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isReportPreviewRequested, setIsReportPreviewRequested] = useState(false);
  const [isReportDownloading, setIsReportDownloading] = useState(false);
  const [isReportDataLoading, setIsReportDataLoading] = useState(false);
  const [isReportPeriodSyncing, setIsReportPeriodSyncing] = useState(false);
  const [reportDataError, setReportDataError] = useState<CommandErrorInfo>();
  const [reportPeriod, setReportPeriod] = useState<ReadingStatsPeriod>(() =>
    buildReadingStatsPeriod(defaultMode === "overall" ? "monthly" : defaultMode)
  );
  const [reportResponse, setReportResponse] = useState<ReadingStatsResponse>();
  const [reportReviewResponse, setReportReviewResponse] = useState<ReadingStatsAiReviewResponse>();
  const { showToast } = useToast();
  const {
    activePeriod,
    canStepForward,
    drillPeriods,
    error,
    handleDrillPeriod,
    handleModeChange,
    handleShiftPeriod,
    handleSync,
    hasCredential,
    hasStatsData,
    isLoadingCache,
    isOverallMode,
    isSyncing,
    response,
    stats
  } = useReadingStatsPage({
    credentialStatus,
    cache,
    defaultMode,
    onCacheChange,
    onOpenSettings
  });

  const summarySparklineSeries = buildStatsSummarySparklineSeries(Object.values(cache), stats);
  const isActivePeriodReportMode = activePeriod.mode !== "overall";
  const activeReportDataCompleteness = resolveReportDataCompleteness(response?.source, hasStatsData);
  const activeLifetimeReportDataCompleteness = resolveLifetimeReportDataCompleteness(response?.source, hasStatsData);
  const activeReportDisabledReason = buildReportDisabledReason({
    dataCompleteness: activeReportDataCompleteness,
    hasStatsData,
    isLoadingData: isLoadingCache,
    isPeriodReportMode: isActivePeriodReportMode,
    stats
  }) ?? (
    isOverallMode
      ? buildLifetimeReportDisabledReason({
          dataCompleteness: activeLifetimeReportDataCompleteness,
          hasStatsData,
          isLoadingData: isLoadingCache,
          stats
        })
      : undefined
  );
  const reportStats = reportResponse?.stats;
  const reportDataPeriod = reportStats
    ? buildReadingStatsPeriod(reportStats.mode, reportStats.baseTime)
    : reportPeriod;
  const hasReportStatsData = hasReadingStatsData(reportStats);
  const isReportFutureBlocked = isFutureReadingStatsPeriod(reportDataPeriod);
  const reportDataCompleteness = isReportFutureBlocked
    ? "future_blocked"
    : resolveReportDataCompleteness(reportResponse?.source, hasReportStatsData);
  const lifetimeReportDataCompleteness = resolveLifetimeReportDataCompleteness(
    reportResponse?.source,
    hasReportStatsData
  );
  const isLifetimeReportMode = reportDataPeriod.mode === "overall";
  const reportDataErrorMessage = reportDataError
    ? getCommandErrorMessage(reportDataError)
    : undefined;
  const reportUnavailableReason =
    reportDataErrorMessage ??
    (isLifetimeReportMode
      ? buildLifetimeReportDisabledReason({
          dataCompleteness: lifetimeReportDataCompleteness,
          hasStatsData: hasReportStatsData,
          isLoadingData: isReportDataLoading,
          stats: reportStats
        })
      : buildReportDisabledReason({
          dataCompleteness: reportDataCompleteness,
          hasStatsData: hasReportStatsData,
          isLoadingData: isReportDataLoading,
          isPeriodReportMode: true,
          stats: reportStats
        }));
  const isReportPeriodSyncDisabled =
    isReportDataLoading ||
    isReportPeriodSyncing ||
    isReportFutureBlocked;
  const periodReportAiReview =
    reportReviewResponse &&
    reportReviewResponse.source !== "empty" &&
    reportReviewResponse.mode === reportStats?.mode &&
    reportReviewResponse.baseTime === reportStats?.baseTime
      ? reportReviewResponse.review
      : undefined;
  const periodReportData =
    reportDataPeriod.mode !== "overall" && reportStats
      ? buildPeriodReportData(reportStats, reportDataPeriod, {
          aiReview: periodReportAiReview,
          dataCompleteness: reportDataCompleteness
        })
      : undefined;
  const lifetimeReportData =
    reportDataPeriod.mode === "overall" && reportStats
      ? buildLifetimeReadingReportData(reportStats, {
          aiReview: periodReportAiReview,
          dataCompleteness: lifetimeReportDataCompleteness
        })
      : undefined;

  useEffect(() => {
    let isMounted = true;
    setReportDataError(undefined);

    if (!isReportOpen || !isReportPreviewRequested) {
      setReportResponse(undefined);
      setIsReportDataLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (isFutureReadingStatsPeriod(reportPeriod)) {
      setReportResponse(undefined);
      setIsReportDataLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const cached = getReadingStatsResponse(cache, reportPeriod);
    if (cached) {
      setReportResponse(cached);
      setIsReportDataLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setReportResponse(undefined);
    setIsReportDataLoading(true);

    async function loadReportStats() {
      try {
        const loaded = await getReadingStats(
          reportPeriod.mode,
          getReadingStatsRequestBaseTime(reportPeriod)
        );

        if (isMounted) {
          setReportResponse(loaded);
          onCacheChange(loaded.stats.mode, loaded);
        }
      } catch (loadError) {
        if (isMounted) {
          setReportDataError(getCommandErrorInfo(loadError));
          setReportResponse(undefined);
        }
      } finally {
        if (isMounted) {
          setIsReportDataLoading(false);
        }
      }
    }

    void loadReportStats();

    return () => {
      isMounted = false;
    };
  }, [
    cache,
    isReportOpen,
    isReportPreviewRequested,
    onCacheChange,
    reportPeriod.baseTime,
    reportPeriod.mode
  ]);

  useEffect(() => {
    let isMounted = true;
    setReportReviewResponse(undefined);

    if (!isReportOpen || !reportStats || !hasReportStatsData) {
      return () => {
        isMounted = false;
      };
    }

    const selectedReportStats = reportStats;

    async function loadCachedReportReview() {
      try {
        const cached = await getLatestReadingStatsReview({
          mode: selectedReportStats.mode,
          baseTime: selectedReportStats.baseTime
        });

        if (isMounted) {
          setReportReviewResponse(cached);
        }
      } catch {
        if (isMounted) {
          setReportReviewResponse(undefined);
        }
      }
    }

    void loadCachedReportReview();

    return () => {
      isMounted = false;
    };
  }, [
    hasReportStatsData,
    isReportOpen,
    reportDataPeriod.mode,
    reportStats?.baseTime,
    reportStats?.mode
  ]);

  return (
    <section className="statistics-page" aria-label="阅读统计">
      <StatsHeroSection
        activePeriod={activePeriod}
        hasStatsData={hasStatsData}
        isOverallMode={isOverallMode}
        isReportEnabled={Boolean(stats)}
        isSyncing={isSyncing}
        reportActionLabel={isOverallMode ? "生成长期复盘" : "生成阅读报告"}
        reportDisabledReason={activeReportDisabledReason}
        stats={stats}
        syncDisabled={!hasCredential || isSyncing}
        onOpenReport={handleOpenPeriodReport}
        onOpenReview={onOpenReview}
        onSync={() => void handleSync()}
      />

      <ReadingStatsPeriodNavigator
        activePeriod={activePeriod}
        anchorAriaLabel="统计时间锚点"
        anchorDescription={describeStatsAnchor(activePeriod.mode)}
        canStepForward={canStepForward}
        drillAriaLabel="统计下钻入口"
        drillLabels={{ overall: "历史年份", nested: "本年各月" }}
        drillPeriods={drillPeriods}
        periodOptions={periodOptions}
        tabsAriaLabel="统计周期"
        onDrillPeriod={handleDrillPeriod}
        onModeChange={handleModeChange}
        onOpenJumpPicker={() => setIsJumpPickerOpen(true)}
        onShiftPeriod={handleShiftPeriod}
      />
      <ReadingStatsPeriodJumpPicker
        activePeriod={activePeriod}
        cache={cache}
        open={isJumpPickerOpen}
        onClose={() => setIsJumpPickerOpen(false)}
        onSelectPeriod={handleDrillPeriod}
      />
      {isReportOpen ? (
        <ReportGenerationWizardDialog
          cache={cache}
          data={periodReportData}
          lifetimeData={lifetimeReportData}
          isDataLoading={isReportDataLoading}
          isDownloading={isReportDownloading}
          isSyncingReportPeriod={isReportPeriodSyncing}
          open={isReportOpen}
          reportPeriod={reportPeriod}
          syncReportDisabled={isReportPeriodSyncDisabled}
          reportUnavailableReason={reportUnavailableReason}
          onClose={() => setIsReportOpen(false)}
          onDownload={(mode, storyPageIndex) => void handleReportDownload(mode, storyPageIndex)}
          onDownloadLifetime={() => void handleLifetimeReportDownload()}
          onGenerateReport={handleGeneratePeriodReport}
          onSyncReportPeriod={() => void handleReportPeriodSync()}
        />
      ) : null}

      {!hasCredential ? (
        <CredentialSetupCard
          title="先保存 API Key"
          description="保存凭据后可同步并查看阅读统计。"
          onOpenSettings={onOpenSettings}
        />
      ) : null}

      {error?.code === "upgrade_required" ? (
        <SkillUpgradeNotice error={error} onRetry={() => void handleSync()} />
      ) : error ? (
        <div className="status-message status-message--error status-message--actionable" aria-label="统计同步错误">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{getCommandErrorMessage(error)}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => void handleSync()}
            disabled={!hasCredential || isSyncing}
          >
            {isSyncing ? "同步中" : "重试同步"}
          </button>
        </div>
      ) : null}

      {response?.syncState?.lastSuccessAt ? (
        <div className="status-message status-message--neutral">
          <CalendarDays aria-hidden="true" size={18} />
          <span>最近成功同步：{formatSyncDate(response.syncState.lastSuccessAt)}</span>
        </div>
      ) : null}

      {isLoadingCache ? (
        <section className="book-detail-loading" aria-label="正在读取统计缓存">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取本地统计缓存</h3>
            <p>如果没有缓存，可以点击同步统计获取当前周期数据。</p>
          </div>
        </section>
      ) : null}

      {!isLoadingCache ? (
        <>
          <StatsSummarySection
            isOverallMode={isOverallMode}
            sparklineSeries={summarySparklineSeries}
            stats={stats}
          />

          {!hasStatsData ? (
            <section className="empty-inline stats-empty" aria-label="统计为空">
              <CalendarDays aria-hidden="true" size={28} />
              <h3>还没有统计缓存</h3>
              <p>先同步当前周期；总计页可继续按年份查看，年度页可继续进入具体月份。</p>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void handleSync()}
                disabled={!hasCredential || isSyncing}
              >
                {isSyncing ? "同步中" : "同步统计"}
              </button>
            </section>
          ) : null}

          {stats ? (
            <div className="stats-layout">
              <ReadingTrend mode={stats.mode} buckets={stats.buckets} compare={stats.compare} />
              <ReadingRank items={stats.longestItems} variant={isOverallMode ? "overall" : "period"} />
              <StatsLocalInsights stats={stats} mode={stats.mode} />
              <StatsPreferenceSection
                categories={stats.categories}
                items={stats.longestItems}
                mode={stats.mode}
              />
              <StatsFootnote mode={activePeriod.mode} baseTime={stats.baseTime} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );

  function handleOpenPeriodReport() {
    const nextReportPeriod = activePeriod;
    setReportPeriod(nextReportPeriod);
    setReportResponse(
      response?.stats.mode === activePeriod.mode &&
        response.stats.baseTime === activePeriod.baseTime
        ? response
        : undefined
    );
    setReportDataError(undefined);
    setIsReportPreviewRequested(false);
    setIsReportDataLoading(false);
    setIsReportOpen(true);
  }

  function handleGeneratePeriodReport(period: ReadingStatsPeriod) {
    setReportPeriod(period);
    setReportResponse(undefined);
    setReportReviewResponse(undefined);
    setReportDataError(undefined);
    setIsReportPreviewRequested(true);
  }

  async function handleReportDownload(mode: PeriodReportDownloadMode, storyPageIndex = 0) {
    if (!periodReportData) {
      return;
    }

    setIsReportDownloading(true);

    try {
      if (mode === "wide") {
        showReportExportSuccess(await downloadPeriodReportWideReport(periodReportData), "period-report-image");
        return;
      }

      if (mode === "cards-current") {
        showReportExportSuccess(
          await downloadPeriodReportStoryPage(periodReportData, storyPageIndex),
          "period-report-image"
        );
        return;
      }

      if (mode === "cards-all") {
        showReportExportSuccess(await downloadPeriodReportStoryPages(periodReportData), "period-report-image");
        return;
      }

      showReportExportSuccess(await downloadPeriodReportPoster(periodReportData), "period-report-image");
    } catch (posterError) {
      showToast({
        message: posterError instanceof Error ? posterError.message : "生成阅读报告图片失败。",
        tone: "error"
      });
    } finally {
      setIsReportDownloading(false);
    }
  }

  async function handleLifetimeReportDownload() {
    if (!lifetimeReportData) {
      return;
    }

    setIsReportDownloading(true);

    try {
      showReportExportSuccess(await downloadLifetimeReadingReportWide(lifetimeReportData), "lifetime-report-image");
    } catch (posterError) {
      showToast({
        message: posterError instanceof Error ? posterError.message : "生成长期复盘图片失败。",
        tone: "error"
      });
    } finally {
      setIsReportDownloading(false);
    }
  }

  async function handleReportPeriodSync() {
    if (!hasCredential) {
      showToast({ message: "请先在设置中保存微信读书 API Key。", tone: "error" });
      onOpenSettings();
      return;
    }

    if (isFutureReadingStatsPeriod(reportPeriod)) {
      showToast({ message: "未来周期不能同步阅读报告数据。", tone: "error" });
      return;
    }

    setIsReportPeriodSyncing(true);
    setReportDataError(undefined);

    try {
      const synced = await syncReadingStats(
        reportPeriod.mode,
        getReadingStatsRequestBaseTime(reportPeriod)
      );
      setReportResponse(synced);
      onCacheChange(synced.stats.mode, synced);
      showToast({
        message: reportPeriod.mode === "overall" ? "总计统计已同步。" : "目标周期统计已同步。",
        tone: "success"
      });
    } catch (syncError) {
      const info = getCommandErrorInfo(syncError);
      const message = getCommandErrorMessage(info);
      setReportDataError(info);
      showToast({ message, tone: "error" });
    } finally {
      setIsReportPeriodSyncing(false);
    }
  }

  function showReportExportSuccess(
    result: ReportImageExportResult | ReportImageExportResult[],
    artifactKind: Extract<ReadingArtifactKind, "period-report-image" | "lifetime-report-image">
  ) {
    const results = Array.isArray(result) ? result : [result];
    const exportDirResult = results.find((item) => item.source === "exportDir");
    if (exportDirResult?.path) {
      showToast({
        message: formatArtifactExportedMessage(
          artifactKind,
          results.length > 1
            ? { count: results.length, unit: "张图片", path: exportDirResult.path }
            : { path: exportDirResult.path }
        ),
        tone: "success"
      });
      return;
    }

    showToast({ message: formatArtifactCreatedMessage(artifactKind), tone: "success" });
  }
}

function describeStatsAnchor(mode: ReadingStatsMode): string {
  if (mode === "overall") {
    return "总计页先看长期积累，再从年份继续下钻到月份。";
  }

  if (mode === "annually") {
    return "年度视角适合先看全年节奏，再点进具体月份。";
  }

  if (mode === "monthly") {
    return "月度视角适合对比相邻月份，定位阅读峰值和偏好波动。";
  }

  return "周度视角更适合观察短周期节奏变化。";
}

function resolveReportDataCompleteness(
  source: ReadingStatsResponse["source"],
  hasStatsData: boolean
): PeriodReportCompleteness | undefined {
  if (source === "empty") {
    return "unsynced";
  }

  if (source === "cache" || source === "synced") {
    return hasStatsData ? "cached" : "empty";
  }

  return undefined;
}

function resolveLifetimeReportDataCompleteness(
  source: ReadingStatsResponse["source"],
  hasStatsData: boolean
): LifetimeReadingReportCompleteness | undefined {
  if (source === "empty") {
    return "unsynced";
  }

  if (source === "cache" || source === "synced") {
    return hasStatsData ? "cached" : "empty";
  }

  return undefined;
}

function buildReportDisabledReason({
  dataCompleteness,
  hasStatsData,
  isLoadingData,
  isPeriodReportMode,
  stats
}: {
  dataCompleteness?: PeriodReportCompleteness;
  hasStatsData: boolean;
  isLoadingData: boolean;
  isPeriodReportMode: boolean;
  stats?: ReadingStatsResponse["stats"];
}): string | undefined {
  if (!isPeriodReportMode || hasStatsData) {
    return undefined;
  }

  if (isLoadingData || !stats) {
    return "正在读取本地统计缓存，读取完成后再生成阅读报告。";
  }

  if (dataCompleteness === "unsynced") {
    return "这个周期还没有本地统计缓存，请先同步统计。";
  }

  if (dataCompleteness === "future_blocked") {
    return "未来周期不能生成阅读报告。";
  }

  return "当前周期没有可生成报告的阅读数据。";
}

function buildLifetimeReportDisabledReason({
  dataCompleteness,
  hasStatsData,
  isLoadingData,
  stats
}: {
  dataCompleteness?: LifetimeReadingReportCompleteness;
  hasStatsData: boolean;
  isLoadingData: boolean;
  stats?: ReadingStatsResponse["stats"];
}): string | undefined {
  if (hasStatsData) {
    return undefined;
  }

  if (isLoadingData || !stats) {
    return "正在读取本地总计统计，读取完成后再生成长期复盘。";
  }

  if (dataCompleteness === "unsynced") {
    return "总计统计还没有本地缓存，请先同步总计统计。";
  }

  return "全部历史暂时没有可生成长期复盘的阅读数据。";
}

function isFutureReadingStatsPeriod(period: ReadingStatsPeriod): boolean {
  return period.mode !== "overall" && period.baseTime > getCurrentReadingStatsAnchor(period.mode);
}

function formatSyncDate(value: string): string {
  const timestamp = Number(value);
  return formatUnixDate(timestamp) || "已同步";
}
