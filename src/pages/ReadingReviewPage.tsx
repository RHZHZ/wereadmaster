import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Database,
  Download,
  Loader2,
  Settings
} from "lucide-react";
import { useToast } from "../components/ToastProvider";
import { ReadingStatsPeriodJumpPicker } from "../components/ReadingStatsPeriodJumpPicker";
import { ReadingStatsPeriodNavigator } from "../components/ReadingStatsPeriodNavigator";
import { ReviewActionsSection } from "../features/reading-review/components/ReviewActionsSection";
import { ReviewFocusBooksSection } from "../features/reading-review/components/ReviewFocusBooksSection";
import { ReviewHeroSection } from "../features/reading-review/components/ReviewHeroSection";
import { ReviewMetaSection } from "../features/reading-review/components/ReviewMetaSection";
import { ReviewMetricSection } from "../features/reading-review/components/ReviewMetricSection";
import { ReviewPreferenceSection } from "../features/reading-review/components/ReviewPreferenceSection";
import { ReviewProfileSection } from "../features/reading-review/components/ReviewProfileSection";
import { ReviewTimelineSection } from "../features/reading-review/components/ReviewTimelineSection";
import { useReadingReviewPage } from "../features/reading-review/hooks/useReadingReviewPage";
import { ReportGenerationWizardDialog } from "../features/reading-stats/components/ReportGenerationWizardDialog";
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
import {
  getCommandErrorMessage,
  getLatestReadingStatsReview,
  getReadingStats,
  syncReadingStats,
  type ReadingStatsResponse
} from "../lib/reading-api";
import type { CredentialStatus, ReadingStatsAiReviewResponse, ReadingStatsMode } from "../lib/types";
import {
  buildReadingStatsPeriod,
  getCurrentReadingStatsAnchor,
  getReadingStatsRequestBaseTime,
  getReadingStatsResponse,
  type ReadingStatsCache,
  type ReadingStatsPeriod
} from "./reading-stats-period";

type ReadingReviewPageProps = {
  credentialStatus?: CredentialStatus;
  cache: ReadingStatsCache;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
};

const periodOptions: Array<{ mode: ReadingStatsMode; label: string; description: string }> = [
  { mode: "weekly", label: "周度", description: "自然周" },
  { mode: "monthly", label: "月度", description: "自然月" },
  { mode: "annually", label: "年度", description: "自然年" },
  { mode: "overall", label: "总计", description: "全部历史" }
];

export function ReadingReviewPage({
  credentialStatus,
  cache,
  onCacheChange,
  onOpenSettings
}: ReadingReviewPageProps) {
  const [isJumpPickerOpen, setIsJumpPickerOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isReportPreviewRequested, setIsReportPreviewRequested] = useState(false);
  const [isReportDownloading, setIsReportDownloading] = useState(false);
  const [isReportDataLoading, setIsReportDataLoading] = useState(false);
  const [isReportPeriodSyncing, setIsReportPeriodSyncing] = useState(false);
  const [reportDataError, setReportDataError] = useState<string>();
  const [reportPeriod, setReportPeriod] = useState<ReadingStatsPeriod>(() =>
    buildReadingStatsPeriod("monthly")
  );
  const [reportResponse, setReportResponse] = useState<ReadingStatsResponse>();
  const [reportReviewResponse, setReportReviewResponse] = useState<ReadingStatsAiReviewResponse>();
  const { showToast } = useToast();
  const {
    activePeriod,
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
    representativeThemes,
    readingPersona,
    review,
    reviewResponse,
    stats,
    status,
    statusMeta,
    timelineInsights,
    topCategory
  } = useReadingReviewPage({
    credentialStatus,
    cache,
    onCacheChange,
    onOpenSettings
  });
  const activeReportResponse = getReadingStatsResponse(cache, activePeriod);
  const isActivePeriodReportMode = activePeriod.mode !== "overall";
  const activeReportDataCompleteness = resolveReportDataCompleteness(
    activeReportResponse?.source,
    hasStatsData
  );
  const activeLifetimeReportDataCompleteness = resolveLifetimeReportDataCompleteness(
    activeReportResponse?.source,
    hasStatsData
  );
  const activeReportDisabledReason = isActivePeriodReportMode
    ? buildReportDisabledReason({
        dataCompleteness: activeReportDataCompleteness,
        hasStatsData,
        isLoadingData: isLoadingStats,
        isPeriodReportMode: true,
        stats
      })
    : buildLifetimeReportDisabledReason({
        dataCompleteness: activeLifetimeReportDataCompleteness,
        hasStatsData,
        isLoadingData: isLoadingStats,
        stats
      });
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
  const reportUnavailableReason =
    reportDataError ??
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
  const currentReviewForReport =
    reviewResponse &&
    reviewResponse.source !== "empty" &&
    reviewResponse.mode === reportStats?.mode &&
    reviewResponse.baseTime === reportStats?.baseTime
      ? reviewResponse.review
      : undefined;
  const cachedReviewForReport =
    reportReviewResponse &&
    reportReviewResponse.source !== "empty" &&
    reportReviewResponse.mode === reportStats?.mode &&
    reportReviewResponse.baseTime === reportStats?.baseTime
      ? reportReviewResponse.review
      : undefined;
  const periodReportAiReview = currentReviewForReport ?? cachedReviewForReport;
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
          setReportDataError(getCommandErrorMessage(loadError));
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

    if (!isReportOpen || !reportStats || !hasReportStatsData || currentReviewForReport) {
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
    currentReviewForReport,
    hasReportStatsData,
    isReportOpen,
    reportDataPeriod.mode,
    reportStats?.baseTime,
    reportStats?.mode
  ]);

  return (
    <section className="reading-review-page" aria-label="阅读复盘">
      <ReviewHeroSection
        activePeriod={activePeriod}
        canGenerate={canGenerate}
        exportDisabled={
          isPreviewReadonly || !review || isExporting || isLoadingReviewCache || status === "generating"
        }
        hasReview={Boolean(review)}
        isExporting={isExporting}
        isLoadingReviewCache={isLoadingReviewCache}
        isSyncing={isSyncing}
        review={review}
        reportActionLabel={activePeriod.mode === "overall" ? "长期复盘图" : "生成报告图"}
        reportDisabled={Boolean(activeReportDisabledReason) || isLoadingStats}
        reportDisabledReason={activeReportDisabledReason}
        stats={stats}
        status={status}
        statusMeta={statusMeta}
        syncDisabled={!hasCredential || isSyncing}
        onExport={() => void handleExport()}
        onGenerate={() => void handleGenerate(false)}
        onOpenReport={handleOpenReport}
        onRegenerate={() => void handleGenerate(true)}
        onSyncStats={() => void handleSyncStats()}
      />

      <ReadingStatsPeriodNavigator
        activePeriod={activePeriod}
        anchorAriaLabel="复盘时间锚点"
        anchorDescription={describeReviewAnchor(activePeriod.mode)}
        canStepForward={canStepForward}
        drillAriaLabel="复盘下钻入口"
        drillLabels={{ overall: "历史年份", nested: "本年各月" }}
        drillPeriods={drillPeriods}
        periodOptions={periodOptions}
        tabsAriaLabel="复盘周期"
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
          reportUnavailableReason={reportUnavailableReason}
          syncReportDisabled={isReportPeriodSyncDisabled}
          onClose={() => setIsReportOpen(false)}
          onDownload={(mode, storyPageIndex) => void handleReportDownload(mode, storyPageIndex)}
          onDownloadLifetime={() => void handleLifetimeReportDownload()}
          onGenerateReport={handleGeneratePeriodReport}
          onSyncReportPeriod={() => void handleReportPeriodSync()}
        />
      ) : null}

      {status === "setup-required" ? (
        <div className="ai-summary-callout">
          <Settings aria-hidden="true" size={20} />
          <div>
            <strong>需要先配置 AI Provider</strong>
            <p>复盘页只发送结构化统计，不发送笔记正文或书籍全文。</p>
          </div>
          <button className="secondary-action" type="button" onClick={onOpenSettings}>
            去设置
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="status-message status-message--warning">
          <AlertCircle aria-hidden="true" size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {isPreviewReadonly && !error ? (
        <div className="status-message status-message--neutral">
          <Database aria-hidden="true" size={18} />
          <span>当前为 Web 只读预览：统计与已缓存复盘来自导出缓存，生成和导出请在桌面应用中执行。</span>
        </div>
      ) : null}

      {exportResult ? (
        <div className="status-message status-message--neutral">
          <Download aria-hidden="true" size={18} />
          <span>已导出 {exportResult.fileName}，路径：{exportResult.path}</span>
        </div>
      ) : null}

      {isStaleCache && !error ? (
        <div className="status-message status-message--neutral">
          <Database aria-hidden="true" size={18} />
          <span>正在展示同周期最近一次缓存；统计数据已变化，可点击重新生成更新复盘。</span>
        </div>
      ) : null}

      {isLoadingStats ? (
        <section className="book-detail-loading" aria-label="正在读取复盘统计">
          <Loader2 aria-hidden="true" size={26} className="spin" />
          <div>
            <h3>正在读取本地统计缓存</h3>
            <p>没有缓存时可以先同步统计，再生成阅读复盘。</p>
          </div>
        </section>
      ) : null}

      {!isLoadingStats && !hasStatsData ? (
        <section className="empty-inline stats-empty" aria-label="复盘统计为空">
          <CalendarDays aria-hidden="true" size={28} />
          <h3>还没有可复盘的数据</h3>
          <p>先同步当前周期统计；后续可以从总计继续下钻到年份和月份生成对应复盘。</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void handleSyncStats()}
            disabled={!hasCredential || isSyncing}
          >
            {isSyncing ? "同步中" : "同步统计"}
          </button>
        </section>
      ) : null}

      {stats ? (
        <>
          <ReviewMetricSection
            activeMode={activePeriod.mode}
            peakBucket={peakBucket}
            stats={stats}
            topCategory={topCategory}
          />

          <section className="review-layout">
            <div className="review-column review-column--left">
              <ReviewTimelineSection
                mode={stats.mode}
                readDays={stats.readDays}
                themes={representativeThemes}
                timelineInsights={timelineInsights}
                buckets={stats.buckets}
              />
              <ReviewProfileSection persona={readingPersona} />
            </div>

            <div className="review-column review-column--right">
              <ReviewPreferenceSection
                aiItems={review?.preferenceInsights ?? []}
                categories={stats.categories}
              />
              <ReviewFocusBooksSection aiItems={review?.focusItems ?? []} items={stats.longestItems} />
            </div>

            <ReviewActionsSection items={review?.nextActions ?? []} />
          </section>

          <ReviewMetaSection review={review} reviewResponse={reviewResponse} stats={stats} />
        </>
      ) : null}
    </section>
  );

  function handleOpenReport() {
    const nextReportPeriod = activePeriod;
    setReportPeriod(nextReportPeriod);
    setReportResponse(activeReportResponse);
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
        showReportExportSuccess(await downloadPeriodReportWideReport(periodReportData), "已生成横版报告。");
        return;
      }

      if (mode === "cards-current") {
        showReportExportSuccess(
          await downloadPeriodReportStoryPage(periodReportData, storyPageIndex),
          "已生成当前轮播页。"
        );
        return;
      }

      if (mode === "cards-all") {
        showReportExportSuccess(await downloadPeriodReportStoryPages(periodReportData), "已生成全部轮播页。");
        return;
      }

      showReportExportSuccess(await downloadPeriodReportPoster(periodReportData), "已生成阅读报告。");
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
      showReportExportSuccess(await downloadLifetimeReadingReportWide(lifetimeReportData), "已生成长期复盘报告。");
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
      const message = getCommandErrorMessage(syncError);
      setReportDataError(message);
      showToast({ message, tone: "error" });
    } finally {
      setIsReportPeriodSyncing(false);
    }
  }

  function showReportExportSuccess(
    result: ReportImageExportResult | ReportImageExportResult[],
    browserFallbackMessage: string
  ) {
    const results = Array.isArray(result) ? result : [result];
    const exportDirResult = results.find((item) => item.source === "exportDir");
    if (exportDirResult?.path) {
      showToast({
        message:
          results.length > 1
            ? `已保存 ${results.length} 张图片到应用导出目录。`
            : `已保存到应用导出目录：${exportDirResult.path}`,
        tone: "success"
      });
      return;
    }

    showToast({ message: browserFallbackMessage, tone: "success" });
  }
}

function describeReviewAnchor(mode: ReadingStatsMode): string {
  if (mode === "overall") {
    return "先看长期画像，再继续进入具体年份和月份生成对应复盘。";
  }

  if (mode === "annually") {
    return "年度复盘适合先看全年结论，再点进月份核对峰值来源。";
  }

  if (mode === "monthly") {
    return "月度复盘适合和相邻月份对照，确认节奏变化是否持续。";
  }

  return "周度复盘更适合快速检查短周期状态。";
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
