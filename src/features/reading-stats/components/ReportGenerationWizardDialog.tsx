import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { CalendarDays, Download, Loader2, RefreshCw, Share2, X } from "lucide-react";
import type { ReadingStatsMode } from "../../../lib/types";
import {
  formatReadingStatsPeriodAnchor,
  type ReadingStatsCache,
  type ReadingStatsPeriod
} from "../../../pages/reading-stats-period";
import {
  buildReadingStatsJumpMonthOptions,
  buildReadingStatsJumpWeekOptions,
  buildReadingStatsJumpYearOptions,
  deriveReadingStatsJumpSelection,
  type ReadingStatsJumpMonthOption,
  type ReadingStatsJumpWeekOption
} from "../../../pages/reading-stats-period-options";
import type { LifetimeReadingReportData } from "../lifetime-reading-report";
import {
  buildReportGenerationPeriodSelection,
  resolveEnabledReportMonth,
  type ReportGenerationPeriodMode
} from "../report-generation-period-selection";
import { LifetimeReadingReportWide } from "./LifetimeReadingReportWide";
import type { PeriodReportPosterData } from "./PeriodReportPoster";
import { PeriodReportCardSet } from "./PeriodReportCardSet";
import { PeriodReportPoster } from "./PeriodReportPoster";
import { PeriodReportWidePrototype } from "./PeriodReportWidePrototype";
import { useImageArtifactCapabilities } from "../../../lib/use-image-artifact-capabilities";

export type ReportGenerationPreviewMode = "poster" | "cards" | "wide";
export type ReportGenerationDownloadMode = "poster" | "wide" | "cards-current" | "cards-all";
export type ReportGenerationShareMode = "poster" | "wide" | "cards-current";
type ReportGenerationDialogStep = "type" | "time" | "preview";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const POSTER_PREVIEW_WIDTH = 720;
const POSTER_PREVIEW_HEIGHT = 960;
const WIDE_PREVIEW_WIDTH = 1120;
const WIDE_PREVIEW_HEIGHT = 630;

const reportPeriodOptions: Array<{ mode: ReadingStatsMode; label: string; description: string }> = [
  { mode: "weekly", label: "周报", description: "短周期节奏回看" },
  { mode: "monthly", label: "月报", description: "月度分享和主题复盘" },
  { mode: "annually", label: "年报", description: "年度结构和代表书目" },
  { mode: "overall", label: "总计复盘", description: "长期阅读成果整理" }
];

type ReportGenerationWizardDialogProps = {
  cache: ReadingStatsCache;
  data?: PeriodReportPosterData;
  lifetimeData?: LifetimeReadingReportData;
  isDataLoading?: boolean;
  isDownloading: boolean;
  isSyncingReportPeriod?: boolean;
  open: boolean;
  reportPeriod: ReadingStatsPeriod;
  syncReportDisabled?: boolean;
  reportUnavailableReason?: string;
  onClose: () => void;
  onDownload: (mode: ReportGenerationDownloadMode, storyPageIndex?: number) => void;
  onDownloadLifetime?: () => void;
  onGenerateReport: (period: ReadingStatsPeriod) => void;
  onShare?: (mode: ReportGenerationShareMode, storyPageIndex?: number) => void;
  onShareLifetime?: () => void;
  onSyncReportPeriod: () => void;
};

export function ReportGenerationWizardDialog({
  cache,
  data,
  lifetimeData,
  isDataLoading = false,
  isDownloading,
  isSyncingReportPeriod = false,
  open,
  reportPeriod,
  syncReportDisabled = false,
  reportUnavailableReason,
  onClose,
  onDownload,
  onDownloadLifetime,
  onGenerateReport,
  onShare,
  onShareLifetime,
  onSyncReportPeriod
}: ReportGenerationWizardDialogProps) {
  const [dialogStep, setDialogStep] = useState<ReportGenerationDialogStep>("type");
  const [previewMode, setPreviewMode] = useState<ReportGenerationPreviewMode>("poster");
  const [draftPeriod, setDraftPeriod] = useState<ReadingStatsPeriod>(reportPeriod);
  const previewShellRef = useRef<HTMLDivElement>(null);
  const hasInitializedOpenDialogRef = useRef(false);
  const [posterScale, setPosterScale] = useState(1);
  const [wideScale, setWideScale] = useState(1);
  const [storyPageIndex, setStoryPageIndex] = useState(0);
  const imageArtifactCapabilities = useImageArtifactCapabilities();
  const activeReportMode = draftPeriod.mode;
  const activePeriodReportMode: ReportGenerationPeriodMode =
    activeReportMode === "overall" ? "monthly" : activeReportMode;
  const isLifetimeReportMode = activeReportMode === "overall";
  const reportPeriodSelection = useMemo(
    () => deriveReadingStatsJumpSelection(reportPeriod),
    [reportPeriod]
  );
  const [selectedYear, setSelectedYear] = useState(reportPeriodSelection.year);
  const [selectedMonth, setSelectedMonth] = useState(reportPeriodSelection.month);
  const yearOptions = useMemo(() => buildReadingStatsJumpYearOptions(cache), [cache]);
  const monthOptions = useMemo(
    () => buildReadingStatsJumpMonthOptions(selectedYear),
    [selectedYear]
  );
  const weekOptions = useMemo(
    () => buildReadingStatsJumpWeekOptions(selectedYear, selectedMonth),
    [selectedMonth, selectedYear]
  );
  const isCardsMode = previewMode === "cards" && !isLifetimeReportMode;
  const canPreview =
    (isLifetimeReportMode ? Boolean(lifetimeData) : Boolean(data)) &&
    !isDataLoading &&
    !reportUnavailableReason;
  const canDownload =
    canPreview &&
    !isDownloading &&
    (!isLifetimeReportMode || Boolean(onDownloadLifetime));
  const canSyncReportPeriod = !isDataLoading && !syncReportDisabled && !isSyncingReportPeriod;
  const activeReportOption = reportPeriodOptions.find((option) => option.mode === activeReportMode);
  const isTypeStep = dialogStep === "type";
  const isTimeStep = dialogStep === "time";
  const isPreviewStep = dialogStep === "preview";
  const previewPrimaryVerb = imageArtifactCapabilities.canSaveToAlbum
    ? "保存"
    : imageArtifactCapabilities.canExportFile
      ? "导出"
      : "下载";
  const shouldShowShareButton =
    isPreviewStep &&
    canPreview &&
    imageArtifactCapabilities.canShareImage &&
    (isLifetimeReportMode ? Boolean(onShareLifetime) : Boolean(onShare));
  const canSharePreview = shouldShowShareButton && !isDownloading;

  useEffect(() => {
    if (!open) {
      hasInitializedOpenDialogRef.current = false;
      return;
    }

    if (hasInitializedOpenDialogRef.current) {
      return;
    }

    hasInitializedOpenDialogRef.current = true;
    setDialogStep("type");
    setDraftPeriod(reportPeriod);
    setSelectedYear(reportPeriodSelection.year);
    setSelectedMonth(reportPeriodSelection.month);
    setStoryPageIndex(0);
  }, [open, reportPeriod.baseTime, reportPeriod.mode, reportPeriodSelection.month, reportPeriodSelection.year]);

  useEffect(() => {
    if (!open || activeReportMode === "annually" || activeReportMode === "overall") {
      return;
    }

    const enabledMonths = monthOptions.filter((option) => !option.disabled);
    if (enabledMonths.length === 0) {
      return;
    }

    if (!enabledMonths.some((option) => option.month === selectedMonth)) {
      const fallbackMonth = resolveEnabledReportMonth(selectedYear, selectedMonth);
      const selection = buildReportGenerationPeriodSelection({
        mode: activePeriodReportMode,
        preferredWeekBaseTime: draftPeriod.baseTime,
        selectedMonth: fallbackMonth,
        selectedYear
      });
      setSelectedMonth(selection.selectedMonth);
      handleDraftPeriodChange(selection.period);
    }
  }, [
    activePeriodReportMode,
    activeReportMode,
    draftPeriod.baseTime,
    monthOptions,
    open,
    selectedMonth,
    selectedYear
  ]);

  useBrowserLayoutEffect(() => {
    if (!open || previewMode !== "poster" || isLifetimeReportMode) {
      setPosterScale(1);
      return undefined;
    }

    if (!isPreviewStep) {
      setPosterScale(1);
      return undefined;
    }

    const shell = previewShellRef.current;
    if (!shell) {
      return undefined;
    }

    const updateScale = () => {
      const styles = window.getComputedStyle(shell);
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      const availableHeight = Math.max(0, shell.clientHeight - verticalPadding);
      const widthFitScale = shell.clientWidth / POSTER_PREVIEW_WIDTH;
      const heightFitScale = availableHeight / POSTER_PREVIEW_HEIGHT;
      const nextScale = Math.min(0.86, widthFitScale, heightFitScale);
      setPosterScale(Math.max(0.28, Number(nextScale.toFixed(3))));
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [isLifetimeReportMode, isPreviewStep, open, previewMode]);

  useBrowserLayoutEffect(() => {
    if (!open || !isPreviewStep || (!isLifetimeReportMode && previewMode !== "wide")) {
      setWideScale(1);
      return undefined;
    }

    const shell = previewShellRef.current;
    if (!shell) {
      return undefined;
    }

    const updateScale = () => {
      const styles = window.getComputedStyle(shell);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(0, shell.clientWidth - horizontalPadding);
      const availableHeight = Math.max(0, shell.clientHeight - verticalPadding);
      const widthFitScale = availableWidth / WIDE_PREVIEW_WIDTH;
      const heightFitScale = availableHeight / WIDE_PREVIEW_HEIGHT;
      const nextScale = Math.min(1, widthFitScale, heightFitScale);
      setWideScale(Math.max(0.24, Number(nextScale.toFixed(3))));
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    window.addEventListener("resize", updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [isLifetimeReportMode, isPreviewStep, open, previewMode]);

  const posterPreviewStyle =
    previewMode === "poster" && !isLifetimeReportMode
      ? ({
          "--monthly-report-poster-preview-scale": posterScale,
          "--monthly-report-poster-preview-width": `${POSTER_PREVIEW_WIDTH * posterScale}px`,
          "--monthly-report-poster-preview-height": `${POSTER_PREVIEW_HEIGHT * posterScale}px`
        } as CSSProperties)
      : undefined;
  const widePreviewStyle =
    isPreviewStep && (isLifetimeReportMode || previewMode === "wide")
      ? ({
          "--monthly-report-wide-preview-scale": wideScale,
          "--monthly-report-wide-preview-width": `${WIDE_PREVIEW_WIDTH * wideScale}px`,
          "--monthly-report-wide-preview-height": `${WIDE_PREVIEW_HEIGHT * wideScale}px`
        } as CSSProperties)
      : undefined;
  const previewShellStyle = posterPreviewStyle ?? widePreviewStyle;

  if (!open) {
    return null;
  }

  return (
    <div className="reading-route-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`reading-route-dialog monthly-report-poster-dialog is-${dialogStep}-step`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthly-report-poster-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭阅读报告预览">
          <X aria-hidden="true" size={18} />
        </button>

        <div className="reading-route-dialog-heading">
          <div>
            <p className="section-kicker">社交分享预览</p>
            <h3 id="monthly-report-poster-dialog-title">阅读报告生成</h3>
            <p>
              {isTypeStep
                ? "第一步先选择报告类型，周报、月报、年报和总计复盘会进入各自独立流程。"
                : isTimeStep
                  ? `第二步${isLifetimeReportMode ? "确认长期复盘范围" : `选择${activeReportOption?.label ?? "报告"}时间`}；确认后再生成预览。`
                : "第三步检查预览效果，再选择竖版、轮播或横版导出。"}
            </p>
          </div>
        </div>

        <div className="monthly-report-step-indicator" aria-label="阅读报告生成步骤">
          <span className={isTypeStep ? "is-active" : ""}>1 选择类型</span>
          <span className={isTimeStep ? "is-active" : ""}>2 选择时间 / 范围</span>
          <span className={isPreviewStep ? "is-active" : ""}>3 生成预览</span>
        </div>

        {isTypeStep ? (
          <section className="monthly-report-kind-selector" aria-label="报告类型选择">
            {reportPeriodOptions.map((option) => (
              <button
                key={option.mode}
                className={activeReportMode === option.mode ? "is-active" : ""}
                type="button"
                onClick={() => handleReportModeSelect(option.mode)}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
                <small>{buildReportKindHint(option.mode)}</small>
              </button>
            ))}
          </section>
        ) : null}

        {isTimeStep ? (
        <div className="monthly-report-dialog-toolbar is-select-step">
          <section className="monthly-report-period-selector" aria-label="阅读报告周期选择">
            <div className="monthly-report-period-selector-heading">
              <div>
                <span>{isLifetimeReportMode ? "报告范围" : `${activeReportOption?.label ?? "报告"}时间`}</span>
                <strong>
                  {isLifetimeReportMode ? "全部历史 · 长期阅读成果" : formatReadingStatsPeriodAnchor(draftPeriod)}
                </strong>
              </div>
              <small>
                <CalendarDays aria-hidden="true" size={14} />
                {isLifetimeReportMode ? "不进入周/月/年选择" : "未来周期已禁用"}
              </small>
            </div>

            {isLifetimeReportMode ? (
              <div className="monthly-report-overall-range">
                <CalendarDays aria-hidden="true" size={24} />
                <div>
                  <strong>长期复盘默认覆盖全部历史</strong>
                  <span>这一类报告不需要选择具体年份或月份，会读取总计统计来生成长期成果视角。</span>
                </div>
              </div>
            ) : (
            <div className={`monthly-report-period-picker is-${activePeriodReportMode}`}>
              {activePeriodReportMode === "weekly" ? (
                <>
                  <section className="monthly-report-weekly-focus" aria-label="周报年月定位">
                    <ReportPeriodOptionGroup title="年份" description="先锁定周报所属年份">
                      <div className="monthly-report-period-grid monthly-report-period-grid--years">
                        {yearOptions.map((year) => (
                          <button
                            key={year}
                            type="button"
                            className={selectedYear === year ? "is-active" : ""}
                            onClick={() => handleYearSelect(year)}
                          >
                            {year} 年
                          </button>
                        ))}
                      </div>
                    </ReportPeriodOptionGroup>

                    <ReportPeriodOptionGroup title="月份" description="再定位周报所在月份">
                      <div className="monthly-report-period-grid monthly-report-period-grid--months">
                        {monthOptions.map((option) => (
                          <button
                            key={`${selectedYear}-${option.month}`}
                            type="button"
                            className={selectedMonth === option.month ? "is-active" : ""}
                            disabled={option.disabled}
                            onClick={() => handleMonthSelect(option)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </ReportPeriodOptionGroup>
                  </section>

                  <ReportPeriodOptionGroup title="具体周" description="选择周一锚点后点击生成周报">
                    <div className="monthly-report-period-grid monthly-report-period-grid--weeks monthly-report-week-grid">
                      {weekOptions.map((option) => (
                        <button
                          key={option.baseTime}
                          type="button"
                          className={option.baseTime === draftPeriod.baseTime ? "is-active" : ""}
                          disabled={option.disabled}
                          onClick={() => handleWeekSelect(option)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </ReportPeriodOptionGroup>
                </>
              ) : (
                <>
                  <ReportPeriodOptionGroup title="年份" description={buildYearPickerDescription(activePeriodReportMode)}>
                    <div className="monthly-report-period-grid monthly-report-period-grid--years">
                      {yearOptions.map((year) => (
                        <button
                          key={year}
                          type="button"
                          className={selectedYear === year ? "is-active" : ""}
                          onClick={() => handleYearSelect(year)}
                        >
                          {year} 年
                        </button>
                      ))}
                    </div>
                  </ReportPeriodOptionGroup>

              {activePeriodReportMode === "monthly" ? (
                <ReportPeriodOptionGroup
                  title="具体月份"
                  description="选择月份后点击生成报告预览"
                >
                  <div className="monthly-report-period-grid monthly-report-period-grid--months">
                    {monthOptions.map((option) => (
                      <button
                        key={`${selectedYear}-${option.month}`}
                        type="button"
                        className={selectedMonth === option.month ? "is-active" : ""}
                        disabled={option.disabled}
                        onClick={() => handleMonthSelect(option)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </ReportPeriodOptionGroup>
              ) : null}
                </>
              )}
            </div>
            )}
          </section>
        </div>
        ) : null}

        {isPreviewStep ? (
        <div className="monthly-report-dialog-toolbar is-preview-step">
          {isLifetimeReportMode ? (
            <div className="monthly-report-preview-tabs" role="tablist" aria-label="长期复盘预览类型">
              <button className="is-active" type="button" role="tab" aria-selected="true" disabled>
                16:9 长期复盘
              </button>
            </div>
          ) : (
            <div className="monthly-report-preview-tabs" role="tablist" aria-label="阅读报告预览类型">
              <button
                className={previewMode === "poster" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={previewMode === "poster"}
                onClick={() => setPreviewMode("poster")}
              >
                竖版海报
              </button>
              <button
                className={previewMode === "cards" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={previewMode === "cards"}
                onClick={() => setPreviewMode("cards")}
              >
                轮播报告
              </button>
              <button
                className={previewMode === "wide" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={previewMode === "wide"}
                onClick={() => setPreviewMode("wide")}
              >
                16:9 报告
              </button>
            </div>
          )}
        </div>
        ) : null}

        {isPreviewStep ? (
          <div
            ref={previewShellRef}
            className={
              isLifetimeReportMode
                ? "monthly-report-poster-preview-shell is-wide lifetime-reading-report-preview-shell"
                : `monthly-report-poster-preview-shell is-${previewMode}`
            }
            style={previewShellStyle}
            aria-busy={isDataLoading}
          >
            {!canPreview ? (
              <section className="monthly-report-preview-empty" aria-label="阅读报告不可用">
                {isDataLoading ? (
                  <Loader2 aria-hidden="true" size={24} className="spin" />
                ) : (
                  <CalendarDays aria-hidden="true" size={24} />
                )}
                <strong>
                  {isDataLoading
                    ? isLifetimeReportMode
                      ? "正在读取总计统计"
                      : "正在读取报告数据"
                    : isLifetimeReportMode
                      ? "暂时不能生成长期复盘"
                      : "暂时不能生成这一期报告"}
                </strong>
                <p>
                  {isDataLoading
                    ? isLifetimeReportMode
                      ? "正在从本地统计缓存读取全部历史数据，完成后会自动刷新预览。"
                      : "正在从本地统计缓存读取目标周期，完成后会自动刷新预览。"
                    : reportUnavailableReason ??
                      (isLifetimeReportMode
                        ? "请先同步总计统计，或等长期阅读数据积累后再生成。"
                        : "请选择一个已经同步且有阅读记录的周、月或年。")}
                </p>
              </section>
            ) : isLifetimeReportMode ? (
              <div className="monthly-report-wide-scale-frame">
                <LifetimeReadingReportWide data={lifetimeData!} />
              </div>
            ) : previewMode === "poster" ? (
              <div className="monthly-report-poster-scale-frame">
                <PeriodReportPoster data={data!} />
              </div>
            ) : previewMode === "cards" ? (
              <PeriodReportCardSet
                activeIndex={storyPageIndex}
                data={data!}
                onActiveIndexChange={setStoryPageIndex}
              />
            ) : (
              <div className="monthly-report-wide-scale-frame">
                <PeriodReportWidePrototype data={data!} />
              </div>
            )}
          </div>
        ) : null}

        <div className="reading-route-dialog-footer monthly-report-poster-dialog-actions">
          <button className="sync-button" type="button" onClick={onClose}>
            {isPreviewStep ? "关闭预览" : "关闭"}
          </button>
          {isTypeStep ? (
            <button className="secondary-action" type="button" onClick={() => setDialogStep("time")}>
              <CalendarDays aria-hidden="true" size={18} />
              {isLifetimeReportMode
                ? "下一步：确认长期范围"
                : `下一步：选择${activeReportOption?.label ?? "报告"}时间`}
            </button>
          ) : isTimeStep ? (
            <>
              <button className="sync-button" type="button" onClick={() => setDialogStep("type")}>
                重新选择类型
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={handleGenerateReport}
              >
                <CalendarDays aria-hidden="true" size={18} />
                {isLifetimeReportMode ? "生成长期复盘预览" : "生成报告预览"}
              </button>
            </>
          ) : null}
          {isPreviewStep ? (
            <button className="sync-button" type="button" onClick={() => setDialogStep("time")}>
              {isLifetimeReportMode ? "重新确认范围" : "重新选择时间"}
            </button>
          ) : null}
          {shouldShowShareButton ? (
            <button className="secondary-action" type="button" onClick={handleShareReport} disabled={!canSharePreview}>
              {isDownloading ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Share2 aria-hidden="true" size={18} />
              )}
              {isDownloading ? "生成中" : isCardsMode ? "分享当前页" : "分享"}
            </button>
          ) : null}
          {isPreviewStep && !canPreview ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onSyncReportPeriod}
              disabled={!canSyncReportPeriod}
            >
              {isSyncingReportPeriod ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isSyncingReportPeriod ? "同步中" : isLifetimeReportMode ? "同步总计统计" : "同步目标周期"}
            </button>
          ) : isPreviewStep && isLifetimeReportMode ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onDownloadLifetime}
              disabled={!canDownload}
            >
              {isDownloading ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isDownloading ? "生成中" : `${previewPrimaryVerb}横版 PNG`}
            </button>
          ) : isPreviewStep && isCardsMode ? (
            <>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onDownload("cards-current", storyPageIndex)}
                disabled={!canDownload}
              >
                {isDownloading ? (
                  <Loader2 aria-hidden="true" size={18} className="spin" />
                ) : (
                  <Download aria-hidden="true" size={18} />
                )}
                {isDownloading ? "生成中" : `${previewPrimaryVerb}当前页`}
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onDownload("cards-all")}
                disabled={!canDownload}
              >
                {isDownloading ? (
                  <Loader2 aria-hidden="true" size={18} className="spin" />
                ) : (
                  <Download aria-hidden="true" size={18} />
                )}
                {isDownloading ? "生成中" : `${previewPrimaryVerb}全部页`}
              </button>
            </>
          ) : isPreviewStep ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => onDownload(previewMode === "wide" ? "wide" : "poster")}
              disabled={!canDownload}
            >
              {isDownloading ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isDownloading
                ? "生成中"
                : previewMode === "wide"
                  ? `${previewPrimaryVerb}横版 PNG`
                : `${previewPrimaryVerb} PNG`}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );

  function handleDraftPeriodChange(period: ReadingStatsPeriod) {
    setDraftPeriod(period);
    setStoryPageIndex(0);
  }

  function handleYearSelect(year: number) {
    setSelectedYear(year);

    const selection = buildReportGenerationPeriodSelection({
      mode: activePeriodReportMode,
      preferredWeekBaseTime: draftPeriod.baseTime,
      selectedMonth,
      selectedYear: year
    });
    setSelectedMonth(selection.selectedMonth);
    handleDraftPeriodChange(selection.period);
  }

  function handleReportModeSelect(mode: ReadingStatsMode) {
    if (mode === "overall") {
      const selection = buildReportGenerationPeriodSelection({
        mode,
        preferredWeekBaseTime: draftPeriod.baseTime,
        selectedMonth,
        selectedYear
      });
      handleDraftPeriodChange(selection.period);
      setPreviewMode("wide");
      return;
    }

    setPreviewMode("poster");

    const selection = buildReportGenerationPeriodSelection({
      mode,
      preferredWeekBaseTime: draftPeriod.baseTime,
      selectedMonth,
      selectedYear
    });
    setSelectedMonth(selection.selectedMonth);
    handleDraftPeriodChange(selection.period);
  }

  function handleGenerateReport() {
    onGenerateReport(draftPeriod);
    setDialogStep("preview");
  }

  function handleShareReport() {
    if (isLifetimeReportMode) {
      onShareLifetime?.();
      return;
    }

    if (!onShare) {
      return;
    }

    if (isCardsMode) {
      onShare("cards-current", storyPageIndex);
      return;
    }

    onShare(previewMode === "wide" ? "wide" : "poster");
  }

  function handleMonthSelect(option: ReadingStatsJumpMonthOption) {
    setSelectedMonth(option.month);
    const selection = buildReportGenerationPeriodSelection({
      mode: activePeriodReportMode,
      preferredWeekBaseTime: draftPeriod.baseTime,
      selectedMonth: option.month,
      selectedYear
    });
    handleDraftPeriodChange(selection.period);
  }

  function handleWeekSelect(option: ReadingStatsJumpWeekOption) {
    const selection = buildReportGenerationPeriodSelection({
      mode: "weekly",
      preferredWeekBaseTime: option.baseTime,
      selectedMonth,
      selectedYear
    });
    handleDraftPeriodChange(selection.period);
  }
}

function ReportPeriodOptionGroup({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="monthly-report-period-option-group">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {children}
    </section>
  );
}

function buildYearPickerDescription(mode: ReportGenerationPeriodMode): string {
  if (mode === "annually") {
    return "选择年份后点击生成年报";
  }

  if (mode === "monthly") {
    return "先选择年份，再选择月份";
  }

  return "先选年份和月份，再点具体周";
}

function buildReportKindHint(mode: ReadingStatsMode): string {
  if (mode === "weekly") {
    return "适合复盘某一周的阅读节奏";
  }

  if (mode === "overall") {
    return "适合回看长期成果、峰值年份和稳定偏好";
  }

  if (mode === "annually") {
    return "适合总结全年结构和峰值";
  }

  return "适合生成可分享的月度报告";
}
