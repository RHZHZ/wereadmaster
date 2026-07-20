import { useEffect, useState } from "react";
import { CalendarDays, Download, Loader2, RefreshCw, X } from "lucide-react";
import type { LifetimeReadingReportData } from "../lifetime-reading-report";
import { LifetimeReadingReportWide } from "./LifetimeReadingReportWide";
import { useImageArtifactCapabilities } from "../../../lib/use-image-artifact-capabilities";

type LifetimeReadingReportDialogStep = "select" | "preview";

type LifetimeReadingReportDialogProps = {
  data?: LifetimeReadingReportData;
  isDataLoading?: boolean;
  isDownloading: boolean;
  isSyncingReport?: boolean;
  open: boolean;
  reportUnavailableReason?: string;
  syncReportDisabled?: boolean;
  onClose: () => void;
  onDownload: () => void;
  onGenerateReport: () => void;
  onSyncReport: () => void;
};

export function LifetimeReadingReportDialog({
  data,
  isDataLoading = false,
  isDownloading,
  isSyncingReport = false,
  open,
  reportUnavailableReason,
  syncReportDisabled = false,
  onClose,
  onDownload,
  onGenerateReport,
  onSyncReport
}: LifetimeReadingReportDialogProps) {
  const [dialogStep, setDialogStep] = useState<LifetimeReadingReportDialogStep>("select");
  const isSelectStep = dialogStep === "select";
  const canPreview = Boolean(data) && !isDataLoading && !reportUnavailableReason;
  const canSyncReport = !isDataLoading && !syncReportDisabled && !isSyncingReport;
  const canDownload = canPreview && !isDownloading;
  const imageArtifactCapabilities = useImageArtifactCapabilities();
  const previewPrimaryVerb = imageArtifactCapabilities.canSaveToAlbum
    ? "保存"
    : imageArtifactCapabilities.canExportFile
      ? "导出"
      : "下载";

  useEffect(() => {
    if (open) {
      setDialogStep("select");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="reading-route-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="reading-route-dialog monthly-report-poster-dialog lifetime-reading-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifetime-reading-report-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭长期复盘预览">
          <X aria-hidden="true" size={18} />
        </button>

        <div className="reading-route-dialog-heading">
          <div>
            <p className="section-kicker">长期成果复盘</p>
            <h3 id="lifetime-reading-report-dialog-title">长期阅读复盘</h3>
            <p>
              {isSelectStep
                ? "第一步确认范围是全部历史；下一步再读取总计统计并生成 16:9 分享图。"
                : `第二步检查长期成果报告的预览效果，再${previewPrimaryVerb}横版 PNG。`}
            </p>
          </div>
        </div>

        <div className="monthly-report-step-indicator" aria-label="长期复盘生成步骤">
          <span className={dialogStep === "select" ? "is-active" : ""}>1 确认范围</span>
          <span className={dialogStep === "preview" ? "is-active" : ""}>2 生成预览</span>
        </div>

        <div className="monthly-report-dialog-toolbar is-select-step lifetime-reading-report-toolbar">
          <section className="monthly-report-period-selector" aria-label="长期复盘范围确认">
            <div className="monthly-report-period-selector-heading">
              <div>
                <span>报告目标</span>
                <strong>全部历史 · 长期阅读成果</strong>
              </div>
              <small>
                <CalendarDays aria-hidden="true" size={14} />
                不进入周/月/年选择
              </small>
            </div>
          </section>
        </div>

        {isSelectStep ? (
          <section className="monthly-report-select-summary lifetime-reading-report-select-summary" aria-label="长期复盘生成前确认">
            <CalendarDays aria-hidden="true" size={24} />
            <div>
              <strong>将生成：全部历史长期阅读成果报告</strong>
              <p>
                这不是某一年或某个月的报告，而是用总计统计回看长期投入、代表书目、稳定分类和作者信号。
              </p>
            </div>
          </section>
        ) : (
          <div
            className="monthly-report-poster-preview-shell is-wide lifetime-reading-report-preview-shell"
            aria-busy={isDataLoading}
          >
            {!canPreview ? (
              <section className="monthly-report-preview-empty" aria-label="长期复盘不可用">
                {isDataLoading ? (
                  <Loader2 aria-hidden="true" size={24} className="spin" />
                ) : (
                  <CalendarDays aria-hidden="true" size={24} />
                )}
                <strong>{isDataLoading ? "正在读取总计统计" : "暂时不能生成长期复盘"}</strong>
                <p>
                  {isDataLoading
                    ? "正在从本地统计缓存读取全部历史数据，完成后会自动刷新预览。"
                    : reportUnavailableReason ?? "请先同步总计统计，或等长期阅读数据积累后再生成。"}
                </p>
              </section>
            ) : (
              <LifetimeReadingReportWide data={data!} />
            )}
          </div>
        )}

        <div className="reading-route-dialog-footer monthly-report-poster-dialog-actions">
          <button className="sync-button" type="button" onClick={onClose}>
            关闭预览
          </button>
          {isSelectStep ? (
            <button className="secondary-action" type="button" onClick={handleGenerateReport}>
              <CalendarDays aria-hidden="true" size={18} />
              生成长期复盘预览
            </button>
          ) : (
            <button className="sync-button" type="button" onClick={() => setDialogStep("select")}>
              重新确认范围
            </button>
          )}
          {!isSelectStep && !canPreview ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onSyncReport}
              disabled={!canSyncReport}
            >
              {isSyncingReport ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <RefreshCw aria-hidden="true" size={18} />
              )}
              {isSyncingReport ? "同步中" : "同步总计统计"}
            </button>
          ) : !isSelectStep ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onDownload}
              disabled={!canDownload}
            >
              {isDownloading ? (
                <Loader2 aria-hidden="true" size={18} className="spin" />
              ) : (
                <Download aria-hidden="true" size={18} />
              )}
              {isDownloading ? "生成中" : `${previewPrimaryVerb}横版 PNG`}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );

  function handleGenerateReport() {
    onGenerateReport();
    setDialogStep("preview");
  }
}
