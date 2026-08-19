import {
  AlertCircle,
  CheckCircle2,
  CircleSlash2,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  canSubmitAssetExportTargets,
  canCheckImaRemoteDrift,
  canForceRepublishImaResult,
  canRetargetImaKnowledgeAssociation,
  exportTargetName,
  getFailedExportTargets,
  resolveExportTargetConfigurations,
  summarizeAssetExportOutcome,
  toggleExportTarget,
  type ExportPlatformMode
} from "../../lib/asset-export-dialog";
import {
  getCommandErrorMessage,
  getSettingsState,
  checkImaExportDrift,
  listImaAddableKnowledgeBases,
  listImaKnowledgeItems,
  resolveImaUnknownAttempt,
  retargetImaKnowledgeAssociation,
  retryImaExportAttempt
} from "../../lib/reading-api";
import type {
  ExportTargetResult,
  ExternalExportTarget,
  ExportSourceKind,
  ImaKnowledgeBase,
  ImaKnowledgeItem,
  ImaKnowledgePathFolder,
  ImaRemoteDriftReport,
  ImaUnknownResolution,
  MultiTargetExportResponse,
  SettingsState
} from "../../lib/types";
import { ExportFailurePanel } from "../ExportFailurePanel";
import { ExportTargetSelection } from "./ExportTargetSelection";

const DEFAULT_TARGETS: ExternalExportTarget[] = ["markdown"];

type AssetExportStage = "select" | "running" | "result";

export type AssetExportConfirmation = {
  confirmImaBodyExport: boolean;
  forceImaNewSnapshot?: boolean;
};

type AssetExportDialogProps = {
  open: boolean;
  ariaLabel: string;
  assetTitle: string;
  assetDescription?: string;
  imaConfirmationText?: string;
  sourceKind?: ExportSourceKind;
  platformMode: ExportPlatformMode;
  availableTargets?: ExternalExportTarget[];
  onExport: (
    targets: ExternalExportTarget[],
    confirmation: AssetExportConfirmation
  ) => Promise<MultiTargetExportResponse>;
  onOpenSettings: () => void;
  onClose: () => void;
};

export function AssetExportDialog({
  open,
  ariaLabel,
  assetTitle,
  assetDescription,
  imaConfirmationText,
  sourceKind,
  platformMode,
  availableTargets = ["markdown", "obsidian", "notion"],
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
  const [recoveringOperationId, setRecoveringOperationId] = useState<string>();
  const [isForcingImaSnapshot, setIsForcingImaSnapshot] = useState(false);
  const [imaDriftReports, setImaDriftReports] = useState<Record<string, ImaRemoteDriftReport>>({});
  const [checkingImaDriftOperationId, setCheckingImaDriftOperationId] = useState<string>();
  const [runningTargets, setRunningTargets] = useState<ExternalExportTarget[]>([]);
  const [imaBodyExportConfirmed, setImaBodyExportConfirmed] = useState(false);
  const [retargetingItem, setRetargetingItem] = useState<ExportTargetResult>();
  const [retargetKnowledgeBases, setRetargetKnowledgeBases] = useState<ImaKnowledgeBase[]>([]);
  const [retargetKnowledgeItems, setRetargetKnowledgeItems] = useState<ImaKnowledgeItem[]>([]);
  const [retargetKnowledgePath, setRetargetKnowledgePath] = useState<ImaKnowledgePathFolder[]>([]);
  const [retargetKnowledgeBaseId, setRetargetKnowledgeBaseId] = useState("");
  const [retargetKnowledgeFolderId, setRetargetKnowledgeFolderId] = useState("");
  const [isLoadingRetargetTargets, setIsLoadingRetargetTargets] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const configurations = resolveExportTargetConfigurations({
    exportData: settingsState?.exportData,
    integrationData: settingsState?.integrationData,
    platformMode,
    availableTargets,
    sourceKind
  });
  const canSubmit =
    !isLoadingSettings &&
    !settingsError &&
    canSubmitAssetExportTargets(
      selectedTargets,
      configurations,
      imaBodyExportConfirmed
    );

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
      setImaBodyExportConfirmed(false);
      setIsForcingImaSnapshot(false);
      setImaDriftReports({});
      setCheckingImaDriftOperationId(undefined);
      setRunningTargets([]);
      setRetargetingItem(undefined);
      setSelectedTargets(DEFAULT_TARGETS.filter((target) => availableTargets.includes(target)));
      return;
    }

    setStage("select");
    setCommandError(undefined);
    setResult(undefined);
    setRecoveringOperationId(undefined);
    setIsForcingImaSnapshot(false);
    setImaDriftReports({});
    setCheckingImaDriftOperationId(undefined);
    setRunningTargets([]);
    setRetargetingItem(undefined);
    setImaBodyExportConfirmed(false);
    setSelectedTargets(DEFAULT_TARGETS.filter((target) => availableTargets.includes(target)));
    void loadSettings();
  }, [open, platformMode, availableTargets.join("|")]);

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

    setSelectedTargets((current) => toggleExportTarget(current, target, availableTargets));
    if (target === "ima" && selectedTargets.includes("ima")) {
      setImaBodyExportConfirmed(false);
    }
    setCommandError(undefined);
    setResult(undefined);
    setImaDriftReports({});
  }

  async function handleExport(targets = selectedTargets) {
    if (
      platformMode === "webReadonly" ||
      stage === "running" ||
      !canSubmitAssetExportTargets(targets, configurations, imaBodyExportConfirmed)
    ) {
      return;
    }

    setStage("running");
    setRunningTargets(targets);
    setCommandError(undefined);
    setResult(undefined);
    setImaDriftReports({});

    try {
      const response = await onExport(targets, {
        confirmImaBodyExport: targets.includes("ima") && imaBodyExportConfirmed,
        forceImaNewSnapshot: false
      });
      setResult(response);
      setStage("result");
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
      setStage("result");
    }
  }

  async function handleForceImaNewSnapshot(item: ExportTargetResult) {
    const driftReport = item.operationId ? imaDriftReports[item.operationId] : undefined;
    const canRecoverFromDrift = driftReport?.canCreateNewSnapshot === true;
    if (
      platformMode === "webReadonly" ||
      stage !== "result" ||
      isForcingImaSnapshot ||
      (!canForceRepublishImaResult(item) && !canRecoverFromDrift) ||
      !canSubmitAssetExportTargets(["ima"], configurations, true)
    ) {
      return;
    }
    if (!window.confirm("创建新的 Ima 快照？旧笔记不会被覆盖或删除。")) {
      return;
    }

    setIsForcingImaSnapshot(true);
    setStage("running");
    setRunningTargets(["ima"]);
    setCommandError(undefined);
    try {
      const response = await onExport(["ima"], {
        confirmImaBodyExport: true,
        forceImaNewSnapshot: true
      });
      const nextImaResult = response.results.find((target) => target.target === "ima");
      if (!nextImaResult) {
        throw new Error("Ima 未返回强制重新发布结果。");
      }
      setResult((current) => current ? {
        ...current,
        exportId: response.exportId,
        exportedAt: response.exportedAt,
        results: current.results.map((target) => target.target === "ima" ? nextImaResult : target)
      } : response);
      setStage("result");
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
      setStage("result");
    } finally {
      setIsForcingImaSnapshot(false);
    }
  }

  function handleBackToSelection() {
    setCommandError(undefined);
    setResult(undefined);
    setImaDriftReports({});
    setStage("select");
  }

  function handleOpenSettings() {
    onClose();
    onOpenSettings();
  }

  function replaceImaResult(next: ExportTargetResult) {
    setResult((current) => current ? {
      ...current,
      results: current.results.map((item) => item.target === "ima" ? next : item)
    } : current);
  }

  async function handleRetryIma(item: ExportTargetResult) {
    if (!item.operationId || recoveringOperationId) {
      return;
    }
    setRecoveringOperationId(item.operationId);
    setCommandError(undefined);
    try {
      replaceImaResult(await retryImaExportAttempt(item.operationId));
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setRecoveringOperationId(undefined);
    }
  }

  async function handleCheckImaDrift(item: ExportTargetResult) {
    if (
      platformMode === "webReadonly" ||
      !item.operationId ||
      !canCheckImaRemoteDrift(item) ||
      checkingImaDriftOperationId
    ) {
      return;
    }
    setCheckingImaDriftOperationId(item.operationId);
    setCommandError(undefined);
    try {
      const report = await checkImaExportDrift(item.operationId);
      setImaDriftReports((current) => ({
        ...current,
        [item.operationId!]: report
      }));
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setCheckingImaDriftOperationId(undefined);
    }
  }

  async function handleOpenRetarget(item: ExportTargetResult) {
    if (!canRetargetImaKnowledgeAssociation(item) || isLoadingRetargetTargets) {
      return;
    }
    setRetargetingItem(item);
    setRetargetKnowledgeBases([]);
    setRetargetKnowledgeItems([]);
    setRetargetKnowledgePath([]);
    setRetargetKnowledgeBaseId("");
    setRetargetKnowledgeFolderId("");
    setCommandError(undefined);
    setIsLoadingRetargetTargets(true);
    try {
      setRetargetKnowledgeBases(await listImaAddableKnowledgeBases());
    } catch (error) {
      setRetargetingItem(undefined);
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setIsLoadingRetargetTargets(false);
    }
  }

  async function handleRetargetKnowledgeBaseChange(value: string) {
    setRetargetKnowledgeBaseId(value);
    setRetargetKnowledgeFolderId("");
    setRetargetKnowledgePath([]);
    setRetargetKnowledgeItems([]);
    if (!value) {
      return;
    }
    await handleBrowseRetargetFolder(value);
  }

  async function handleBrowseRetargetFolder(knowledgeBaseId: string, folderId?: string) {
    setIsLoadingRetargetTargets(true);
    setCommandError(undefined);
    try {
      const response = await listImaKnowledgeItems(knowledgeBaseId, folderId);
      setRetargetKnowledgeItems(response.items.filter((item) => item.isFolder));
      setRetargetKnowledgePath(response.currentPath);
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setIsLoadingRetargetTargets(false);
    }
  }

  function handleRetargetFolderSelect(folderId?: string) {
    setRetargetKnowledgeFolderId(folderId ?? "");
  }

  async function handleRetarget() {
    const item = retargetingItem;
    if (!item?.operationId || !retargetKnowledgeBaseId || isLoadingRetargetTargets) {
      return;
    }
    const folderLabel = retargetKnowledgeFolderId
      ? retargetKnowledgePath[retargetKnowledgePath.length - 1]?.name ?? retargetKnowledgeFolderId
      : "根目录";
    const baseLabel = retargetKnowledgeBases.find(
      (base) => base.id === retargetKnowledgeBaseId
    )?.name ?? retargetKnowledgeBaseId;
    if (!window.confirm(
      `确认将已创建的 Ima 笔记关联到“${baseLabel} / ${folderLabel}”吗？\n正文不会重新上传，原笔记不会覆盖。`
    )) {
      return;
    }
    setIsLoadingRetargetTargets(true);
    setCommandError(undefined);
    try {
      const next = await retargetImaKnowledgeAssociation({
        operationId: item.operationId,
        knowledgeBaseId: retargetKnowledgeBaseId,
        knowledgeBaseFolderId: retargetKnowledgeFolderId || undefined,
        confirm: true
      });
      replaceImaResult(next);
      setRetargetingItem(undefined);
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setIsLoadingRetargetTargets(false);
    }
  }

  async function handleResolveIma(
    item: ExportTargetResult,
    action: ImaUnknownResolution
  ) {
    if (!item.operationId || recoveringOperationId) {
      return;
    }
    const actionLabel = action === "confirmSucceeded"
      ? "确认远端已成功"
      : action === "abandon"
        ? "放弃本次恢复"
        : "创建新的完整快照";
    if (!window.confirm(`${actionLabel}？此操作只处理当前 Ima 导出尝试。`)) {
      return;
    }
    setRecoveringOperationId(item.operationId);
    setCommandError(undefined);
    try {
      const next = await resolveImaUnknownAttempt({
        operationId: item.operationId,
        action,
        confirm: true
      });
      replaceImaResult(next ?? {
        ...item,
        status: "skipped",
        operationStage: undefined,
        warning: "已放弃本次 Ima 导出恢复。",
        error: undefined
      });
    } catch (error) {
      setCommandError(getCommandErrorMessage(error));
    } finally {
      setRecoveringOperationId(undefined);
    }
  }

  const failedTargets = result ? getFailedExportTargets(result).filter((target) => {
    const targetResult = result.results.find((item) => item.target === target);
    return target !== "ima" || !targetResult?.operationId;
  }) : [];
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
            <>
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
              {selectedTargets.includes("ima") ? (
                <label className="asset-export-consent">
                  <input
                    type="checkbox"
                    checked={imaBodyExportConfirmed}
                    onChange={(event) => setImaBodyExportConfirmed(event.target.checked)}
                  />
                  <span>
                    {imaConfirmationText ?? "我确认：本次导出的划线、想法和相关元数据将发送到 Ima。"}
                  </span>
                </label>
              ) : null}
            </>
          ) : null}

          {stage === "running" ? (
            <section className="asset-export-progress" aria-live="polite">
              <Loader2 aria-hidden="true" size={28} className="spin" />
              <div>
                <h4>正在导出</h4>
                <p>已提交 {runningTargets.length} 个目标，请稍候。完成前请不要关闭窗口。</p>
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
            <>
              <AssetExportResults
                response={result}
                outcome={outcome!}
                recoveringOperationId={recoveringOperationId}
                isForcingImaSnapshot={isForcingImaSnapshot}
                imaDriftReports={imaDriftReports}
                checkingImaDriftOperationId={checkingImaDriftOperationId}
                onRetryIma={(item) => void handleRetryIma(item)}
                onResolveIma={(item, action) => void handleResolveIma(item, action)}
                onForceImaNewSnapshot={(item) => void handleForceImaNewSnapshot(item)}
                onRetargetIma={(item) => void handleOpenRetarget(item)}
                onCheckImaDrift={(item) => void handleCheckImaDrift(item)}
              />
              {retargetingItem ? (
                <ImaRetargetPanel
                  item={retargetingItem}
                  bases={retargetKnowledgeBases}
                  items={retargetKnowledgeItems}
                  path={retargetKnowledgePath}
                  selectedBaseId={retargetKnowledgeBaseId}
                  selectedFolderId={retargetKnowledgeFolderId}
                  isLoading={isLoadingRetargetTargets}
                  onBaseChange={(value) => void handleRetargetKnowledgeBaseChange(value)}
                  onBrowseFolder={(folderId) => void handleBrowseRetargetFolder(retargetKnowledgeBaseId, folderId)}
                  onSelectFolder={handleRetargetFolderSelect}
                  onCancel={() => setRetargetingItem(undefined)}
                  onConfirm={() => void handleRetarget()}
                />
              ) : null}
            </>
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
  outcome,
  recoveringOperationId,
  isForcingImaSnapshot,
  imaDriftReports,
  checkingImaDriftOperationId,
  onRetryIma,
  onResolveIma,
  onForceImaNewSnapshot,
  onRetargetIma,
  onCheckImaDrift
}: {
  response: MultiTargetExportResponse;
  outcome: ReturnType<typeof summarizeAssetExportOutcome>;
  recoveringOperationId?: string;
  isForcingImaSnapshot: boolean;
  imaDriftReports: Record<string, ImaRemoteDriftReport>;
  checkingImaDriftOperationId?: string;
  onRetryIma: (item: ExportTargetResult) => void;
  onResolveIma: (item: ExportTargetResult, action: ImaUnknownResolution) => void;
  onForceImaNewSnapshot: (item: ExportTargetResult) => void;
  onRetargetIma: (item: ExportTargetResult) => void;
  onCheckImaDrift: (item: ExportTargetResult) => void;
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
        {response.results.map((item) => {
          const driftReport = item.operationId ? imaDriftReports[item.operationId] : undefined;
          const canCreateSnapshotAfterDrift = driftReport?.canCreateNewSnapshot === true;
          return (
            <article className={`asset-export-result asset-export-result--${item.status}`} key={item.target}>
            {item.status === "succeeded" ? (
              <CheckCircle2 aria-hidden="true" size={20} />
            ) : item.status === "failed" || item.status === "partial" || item.status === "unknown" ? (
              <AlertCircle aria-hidden="true" size={20} />
            ) : (
              <CircleSlash2 aria-hidden="true" size={20} />
            )}
            <div>
              <strong>{exportTargetName(item.target)}</strong>
              <span>
                {item.status === "succeeded"
                  ? item.path || item.url || item.title || "导出成功"
                  : item.status === "failed" || item.status === "partial" || item.status === "unknown"
                    ? item.error?.message || "导出失败"
                    : item.warning || "本次未写入内容"}
              </span>
              {item.warning && item.status !== "skipped" ? <small>{item.warning}</small> : null}
              {driftReport ? (
                <small className={`asset-export-drift asset-export-drift--${driftReport.status}`}>
                  {driftReport.message}
                </small>
              ) : null}
            </div>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                <FolderOpen aria-hidden="true" size={15} />
                打开
              </a>
            ) : null}
            {item.target === "ima" && item.operationId && (item.status === "failed" || item.status === "partial") ? (
              <button
                className="text-button"
                type="button"
                disabled={recoveringOperationId === item.operationId}
                onClick={() => onRetryIma(item)}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {recoveringOperationId === item.operationId ? "恢复中" : "精确重试"}
              </button>
            ) : null}
            {item.target === "ima" && item.operationId && item.status === "unknown" ? (
              <div className="asset-export-result-actions">
                <button className="text-button" type="button" onClick={() => onResolveIma(item, "confirmSucceeded")}>确认成功</button>
                <button className="text-button" type="button" onClick={() => onResolveIma(item, "createNewSnapshot")}>创建新版本</button>
                <button className="text-button" type="button" onClick={() => onResolveIma(item, "abandon")}>放弃</button>
              </div>
            ) : null}
            {canCheckImaRemoteDrift(item) ? (
              <button
                className="text-button"
                type="button"
                disabled={Boolean(checkingImaDriftOperationId)}
                onClick={() => onCheckImaDrift(item)}
              >
                <Search aria-hidden="true" size={15} />
                {checkingImaDriftOperationId === item.operationId ? "检查中" : "检查远端"}
              </button>
            ) : null}
            {canForceRepublishImaResult(item) || canCreateSnapshotAfterDrift ? (
              <button
                className="text-button"
                type="button"
                disabled={isForcingImaSnapshot}
                onClick={() => onForceImaNewSnapshot(item)}
              >
                <RefreshCw aria-hidden="true" size={15} />
                {isForcingImaSnapshot
                  ? "重新发布中"
                  : canCreateSnapshotAfterDrift ? "创建新快照" : "强制重新发布"}
              </button>
            ) : null}
            {canRetargetImaKnowledgeAssociation(item) ? (
              <button
                className="text-button"
                type="button"
                disabled={Boolean(recoveringOperationId) || isForcingImaSnapshot}
                onClick={() => onRetargetIma(item)}
              >
                <FolderOpen aria-hidden="true" size={15} />
                更换知识库
              </button>
            ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ImaRetargetPanel({
  item,
  bases,
  items,
  path,
  selectedBaseId,
  selectedFolderId,
  isLoading,
  onBaseChange,
  onBrowseFolder,
  onSelectFolder,
  onCancel,
  onConfirm
}: {
  item: ExportTargetResult;
  bases: ImaKnowledgeBase[];
  items: ImaKnowledgeItem[];
  path: ImaKnowledgePathFolder[];
  selectedBaseId: string;
  selectedFolderId: string;
  isLoading: boolean;
  onBaseChange: (value: string) => void;
  onBrowseFolder: (folderId?: string) => void;
  onSelectFolder: (folderId?: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selectedFolderLabel = selectedFolderId
    ? path[path.length - 1]?.name ?? selectedFolderId
    : "根目录";
  return (
    <section className="asset-export-retarget" aria-label="更换 Ima 知识库">
      <header>
        <div>
          <p className="section-kicker">知识库关联重定向</p>
          <h4>复用已创建笔记</h4>
          <p>
            原操作已创建笔记，但知识库关联失败。正文不会再次上传；本次只会调用一次知识库关联接口。
          </p>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={isLoading}>
          取消
        </button>
      </header>
      <p className="asset-export-retarget-origin">
        {item.warning ?? `原目标：本地导出记录中的知识库关联（操作 ${item.operationId}）`}
      </p>
      <label className="asset-export-retarget-field">
        <span>新知识库</span>
        <select
          value={selectedBaseId}
          onChange={(event) => onBaseChange(event.target.value)}
          disabled={isLoading}
        >
          <option value="">请选择可写知识库</option>
          {bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
        </select>
      </label>
      {selectedBaseId ? (
        <div className="asset-export-retarget-browser">
          <div className="asset-export-retarget-breadcrumbs">
            <button
              className={!selectedFolderId ? "is-current" : ""}
              type="button"
              onClick={() => { onBrowseFolder(); onSelectFolder(); }}
              disabled={isLoading}
            >根目录</button>
            {path.map((folder) => (
              <span key={folder.folderId}>
                <span aria-hidden="true"> / </span>
                <button
                  className={folder.folderId === selectedFolderId ? "is-current" : ""}
                  type="button"
                  onClick={() => { onBrowseFolder(folder.folderId); onSelectFolder(folder.folderId); }}
                  disabled={isLoading}
                >{folder.name}</button>
              </span>
            ))}
          </div>
          <div className="asset-export-retarget-items">
            {items.length === 0 ? <span>当前目录没有子文件夹，可选择 {selectedFolderLabel}。</span> : null}
            {items.map((item) => (
              <button
                key={item.id}
                className="text-button"
                type="button"
                onClick={() => { onBrowseFolder(item.id); onSelectFolder(item.id); }}
                disabled={isLoading}
              >
                <FolderOpen aria-hidden="true" size={15} />
                {item.title}
              </button>
            ))}
          </div>
          <p>当前选择：{selectedFolderLabel}</p>
        </div>
      ) : null}
      <footer>
        <button className="btn-secondary" type="button" onClick={onCancel} disabled={isLoading}>取消</button>
        <button
          className="btn-primary"
          type="button"
          onClick={onConfirm}
          disabled={isLoading || !selectedBaseId}
        >
          {isLoading ? <Loader2 aria-hidden="true" size={16} className="spin" /> : null}
          确认更换关联
        </button>
      </footer>
    </section>
  );
}
