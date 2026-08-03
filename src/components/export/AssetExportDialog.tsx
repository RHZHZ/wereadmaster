import {
  AlertCircle,
  CheckCircle2,
  CircleSlash2,
  FolderOpen,
  Loader2,
  RefreshCw,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canSubmitExportTargets,
  exportTargetName,
  getFailedExportTargets,
  resolveExportTargetConfigurations,
  summarizeAssetExportOutcome,
  toggleExportTarget,
  type ExportPlatformMode
} from "../../lib/asset-export-dialog";
import { getCommandErrorMessage, getSettingsState } from "../../lib/reading-api";
import type {
  ExternalExportTarget,
  MultiTargetExportResponse,
  SettingsState
} from "../../lib/types";
import { ExportFailurePanel } from "../ExportFailurePanel";
import { ExportTargetSelection } from "./ExportTargetSelection";

const DEFAULT_TARGETS: ExternalExportTarget[] = ["markdown"];

type AssetExportStage = "select" | "running" | "result";

type AssetExportDialogProps = {
  open: boolean;
  ariaLabel: string;
  assetTitle: string;
  assetDescription?: string;
  platformMode: ExportPlatformMode;
  onExport: (targets: ExternalExportTarget[]) => Promise<MultiTargetExportResponse>;
  onOpenSettings: () => void;
  onClose: () => void;
};

export function AssetExportDialog({
  open,
  ariaLabel,
  assetTitle,
  assetDescription,
  platformMode,
  onExport,
  onOpenSettings,
  onClose
}: AssetExportDialogProps) {
  const [stage, setStage] = useState<AssetExportStage>("select");
  const [selectedTargets, setSelectedTargets] =
    useState<ExternalExportTarget[]>(DEFAULT_TARGETS);
  const [settingsState, setSettingsState] = useState<SettingsState>();
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();
  const [commandError, setCommandError] = useState<string>();
  const [result, setResult] = useState<MultiTargetExportResponse>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const configurations = resolveExportTargetConfigurations({
    exportData: settingsState?.exportData,
    integrationData: settingsState?.integrationData,
    platformMode
  });
  const canSubmit =
    !isLoadingSettings &&
    !settingsError &&
    canSubmitExportTargets(selectedTargets, configurations);

  useEffect(() => {
    if (!open) {
      return;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => headingRef.current?.focus());

    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (platformMode === "webReadonly") {
      setSettingsState(undefined);
      setSettingsError(undefined);
      setIsLoadingSettings(false);
      setStage("select");
      setCommandError(undefined);
      setResult(undefined);
      return;
    }

    setStage("select");
    setCommandError(undefined);
    setResult(undefined);
    void loadSettings();
  }, [open, platformMode]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && stage !== "running") {
        handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, stage]);

  if (!open) {
    return null;
  }

  async function loadSettings() {
    setIsLoadingSettings(true);
    setSettingsError(undefined);

    try {
      setSettingsState(await getSettingsState());
    } catch (error) {
      setSettingsState(undefined);
      setSettingsError(getCommandErrorMessage(error));
    } finally {
      setIsLoadingSettings(false);
    }
  }

  function handleClose() {
    if (stage === "running") {
      return;
    }

    onClose();
  }

  function handleTargetChange(target: ExternalExportTarget) {
    if (stage !== "select") {
      return;
    }

    setSelectedTargets((current) => toggleExportTarget(current, target));
    setCommandError(undefined);
    setResult(undefined);
  }

  async function handleExport(targets = selectedTargets) {
    if (
      platformMode === "webReadonly" ||
      stage === "running" ||
      !canSubmitExportTargets(targets, configurations)
    ) {
      return;
    }

    setStage("running");
    setCommandError(undefined);
    setResult(undefined);

    try {
      const response = await onExport(targets);
      setResult(response);
      setStage("result");
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
      setStage("result");
    }
  }

  function handleBackToSelection() {
    setCommandError(undefined);
    setResult(undefined);
    setStage("select");
  }

  function handleOpenSettings() {
    onClose();
    onOpenSettings();
  }

  const failedTargets = result ? getFailedExportTargets(result) : [];
  const outcome = result ? summarizeAssetExportOutcome(result.results) : undefined;

  return (
    <div
      className="asset-export-backdrop"
      role="presentation"
      onMouseDown={handleClose}
    >
      <section
        className="asset-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-busy={stage === "running"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="asset-export-heading">
          <div>
            <p className="section-kicker">文档导出</p>
            <h3 ref={headingRef} tabIndex={-1}>{assetTitle}</h3>
            {assetDescription ? <p>{assetDescription}</p> : null}
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={handleClose}
            disabled={stage === "running"}
            aria-label={`关闭${ariaLabel}`}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="asset-export-body">
          {stage === "select" ? (
            <ExportTargetSelection
              configurations={configurations}
              isLoadingSettings={isLoadingSettings}
              platformMode={platformMode}
              selectedTargets={selectedTargets}
              settingsError={settingsError}
              onOpenSettings={handleOpenSettings}
              onReloadSettings={() => void loadSettings()}
              onTargetChange={handleTargetChange}
            />
          ) : null}

          {stage === "running" ? (
            <section className="asset-export-progress" aria-live="polite">
              <Loader2 aria-hidden="true" size={28} className="spin" />
              <div>
                <h4>正在导出</h4>
                <p>已提交 {selectedTargets.length} 个目标，请稍候。完成前请不要关闭窗口。</p>
              </div>
            </section>
          ) : null}

          {stage === "result" && commandError ? (
            <ExportFailurePanel
              ariaLabel="导出失败详情"
              error={commandError}
              contextTitle="选择已保留"
              contextDescription="你可以直接重试，或返回目标选择后调整范围。"
            />
          ) : null}

          {stage === "result" && result ? (
            <AssetExportResults response={result} outcome={outcome!} />
          ) : null}
        </div>

        <footer className="asset-export-actions">
          {stage === "select" ? (
            <>
              <button className="btn-ghost" type="button" onClick={handleClose}>
                取消
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleExport()}
                disabled={!canSubmit}
              >
                开始导出
              </button>
            </>
          ) : null}

          {stage === "running" ? (
            <button className="btn-primary" type="button" disabled>
              <Loader2 aria-hidden="true" size={17} className="spin" />
              导出中
            </button>
          ) : null}

          {stage === "result" ? (
            <>
              <button className="btn-ghost" type="button" onClick={handleClose}>
                关闭
              </button>
              {(commandError || outcome === "failed" || outcome === "partial") ? (
                <button className="btn-secondary" type="button" onClick={handleBackToSelection}>
                  返回选择
                </button>
              ) : null}
              {commandError ? (
                <button className="btn-primary" type="button" onClick={() => void handleExport()}>
                  <RefreshCw aria-hidden="true" size={17} />
                  重试
                </button>
              ) : null}
              {failedTargets.length > 0 ? (
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void handleExport(failedTargets)}
                >
                  <RefreshCw aria-hidden="true" size={17} />
                  重试失败目标
                </button>
              ) : null}
            </>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function AssetExportResults({
  response,
  outcome
}: {
  response: MultiTargetExportResponse;
  outcome: ReturnType<typeof summarizeAssetExportOutcome>;
}) {
  const summary =
    outcome === "succeeded"
      ? `已导出到 ${response.results.length} 个目标`
      : outcome === "partial"
        ? "部分目标已完成"
        : outcome === "failed"
          ? "导出未完成"
          : "没有写入新的内容";

  return (
    <section className={`asset-export-results asset-export-results--${outcome}`} aria-label="导出结果">
      <header>
        <div>
          <p className="section-kicker">导出结果</p>
          <h4>{summary}</h4>
        </div>
        <span>{response.results.length} 个目标</span>
      </header>
      <div className="asset-export-result-list">
        {response.results.map((item) => (
          <article className={`asset-export-result asset-export-result--${item.status}`} key={item.target}>
            {item.status === "succeeded" ? (
              <CheckCircle2 aria-hidden="true" size={20} />
            ) : item.status === "failed" ? (
              <AlertCircle aria-hidden="true" size={20} />
            ) : (
              <CircleSlash2 aria-hidden="true" size={20} />
            )}
            <div>
              <strong>{exportTargetName(item.target)}</strong>
              <span>
                {item.status === "succeeded"
                  ? item.path || item.url || item.title || "导出成功"
                  : item.status === "failed"
                    ? item.error?.message || "导出失败"
                    : item.warning || "本次未写入内容"}
              </span>
              {item.warning && item.status !== "skipped" ? <small>{item.warning}</small> : null}
            </div>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                <FolderOpen aria-hidden="true" size={15} />
                打开
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
