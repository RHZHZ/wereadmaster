import type {
  ExportDataState,
  ExportSourceKind,
  ExportTargetResult,
  ExternalExportTarget,
  IntegrationDataState,
  MultiTargetExportResponse
} from "./types";

export type ExportPlatformMode = "native" | "webReadonly";

type ExportRuntime = {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function resolveExportPlatformMode(
  runtime: ExportRuntime = globalThis as ExportRuntime
): ExportPlatformMode {
  return runtime.__TAURI__ || runtime.__TAURI_INTERNALS__ ? "native" : "webReadonly";
}

export type ExportTargetReadiness =
  | "ready"
  | "missing"
  | "invalid"
  | "readonly"
  | "unsupported";

export type ExportTargetConfiguration = {
  target: ExternalExportTarget;
  label: string;
  readiness: ExportTargetReadiness;
  destinationLabel: string;
  detail: string;
};

export type AssetExportOutcome = "succeeded" | "partial" | "failed" | "skipped";

export const EXPORT_TARGET_ORDER: ExternalExportTarget[] = [
  "markdown",
  "obsidian",
  "notion",
  "ima"
];
export const DEFAULT_AVAILABLE_TARGETS: ExternalExportTarget[] = [
  "markdown",
  "obsidian",
  "notion"
];

export function resolveExportTargetConfigurations({
  exportData,
  integrationData,
  platformMode,
  availableTargets = DEFAULT_AVAILABLE_TARGETS,
  sourceKind
}: {
  exportData?: ExportDataState;
  integrationData?: IntegrationDataState;
  platformMode: ExportPlatformMode;
  availableTargets?: ExternalExportTarget[];
  sourceKind?: ExportSourceKind;
}): ExportTargetConfiguration[] {
  const targetOrder = EXPORT_TARGET_ORDER.filter((target) => availableTargets.includes(target));
  if (platformMode === "webReadonly") {
    return targetOrder.map((target) => ({
      target,
      label: exportTargetName(target),
      readiness: "readonly",
      destinationLabel: "桌面应用可用",
      detail: "当前为 Web 只读预览，不能读取或写入本地导出配置。"
    }));
  }

  const exportDir = exportData?.exportDir.trim();
  const vaultDir = integrationData?.obsidian.vaultDir?.trim();
  const notion = integrationData?.notion;
  const notionDestination = notion?.databaseConnection?.databaseName?.trim();
  const notionDestinationId =
    notion?.databaseConnection?.databaseId?.trim() || notion?.parentId?.trim();
  const ima = integrationData?.ima;
  const imaRoute = resolveImaAssetRoute(ima, sourceKind);
  const imaWriteCompatible =
    ima?.compatibilityStatus === "compatible" &&
    ima.canAttemptWrite &&
    ima.isWriteCompatible;
  const imaDestination = imaRoute.publishToKnowledgeBase
    ? imaRoute.knowledgeBaseId?.trim()
    : imaRoute.noteFolderId?.trim();

  const configurations: ExportTargetConfiguration[] = [
    {
      target: "markdown",
      label: "Markdown",
      readiness: exportDir ? "ready" : "missing",
      destinationLabel: exportDir ? `保存到：${exportDir}` : "尚未读取导出目录",
      detail: exportDir ? "已配置" : "请在设置页配置导出保存位置。"
    },
    {
      target: "obsidian",
      label: "Obsidian",
      readiness:
        integrationData?.obsidian.hasConfiguredVault && vaultDir ? "ready" : "missing",
      destinationLabel: vaultDir ? `Vault：${vaultDir}` : "尚未配置 Obsidian Vault",
      detail:
        integrationData?.obsidian.hasConfiguredVault && vaultDir
          ? "已配置"
          : "请在设置页选择可用的 Obsidian Vault。"
    },
    {
      target: "notion",
      label: "Notion",
      readiness:
        notion?.credential.hasCredential && notionDestinationId ? "ready" : "missing",
      destinationLabel: notionDestinationId
        ? `目标：${notionDestination || notionDestinationId}`
        : "尚未配置 Notion 目标",
      detail:
        notion?.credential.hasCredential && notionDestinationId
          ? "已配置，执行时仍以后端校验为准。"
          : !notion?.credential.hasCredential
            ? "请先在设置页保存 Notion 凭据。"
            : "请在设置页连接数据库或配置父级目标。"
    },
    {
      target: "ima",
      label: "Ima",
      readiness: !ima?.credential.hasCredential
        ? "missing"
        : !imaWriteCompatible
          ? "invalid"
          : imaRoute.publishToKnowledgeBase && !imaRoute.knowledgeBaseId?.trim()
            ? "missing"
            : "ready",
      destinationLabel: imaRoute.publishToKnowledgeBase
        ? imaDestination
          ? "已选择 Ima 知识库"
          : "尚未选择 Ima 知识库"
        : imaDestination
          ? `笔记本：${imaDestination}`
          : "Ima 默认笔记本",
      detail: !ima?.credential.hasCredential
        ? "请先在设置页保存 Ima Client ID 和 API Key。"
        : !imaWriteCompatible
          ? ima.compatibilityStatus === "incompatible"
            ? "Ima 接口版本已变化，请先更新应用。"
            : "Ima 适配器兼容性尚未确认，请先刷新版本状态。"
          : imaRoute.publishToKnowledgeBase
            ? "将创建 Ima 笔记并加入所选知识库。"
            : "将创建 Ima 笔记，不关联知识库。"
    }
  ];
  return targetOrder.flatMap((target) => {
    const configuration = configurations.find((item) => item.target === target);
    return configuration ? [configuration] : [];
  });
}

function resolveImaAssetRoute(
  ima: IntegrationDataState["ima"] | undefined,
  sourceKind: ExportSourceKind | undefined
) {
  const route = sourceKind ? ima?.assetRoutes?.[sourceKind] : undefined;
  const useDecisionSafeDefault = sourceKind === "bookDecision" && !route;
  return {
    noteFolderId: route?.noteFolderId ?? ima?.noteFolderId,
    knowledgeBaseId: useDecisionSafeDefault
      ? undefined
      : route?.knowledgeBaseId ?? ima?.knowledgeBaseId,
    knowledgeBaseFolderId:
      useDecisionSafeDefault
        ? undefined
        : route?.knowledgeBaseFolderId ?? ima?.knowledgeBaseFolderId,
    publishToKnowledgeBase:
      useDecisionSafeDefault
        ? false
        : route?.publishToKnowledgeBase ?? ima?.publishToKnowledgeBase ?? false
  };
}

export function toggleExportTarget(
  targets: ExternalExportTarget[],
  target: ExternalExportTarget,
  availableTargets: ExternalExportTarget[] = EXPORT_TARGET_ORDER
): ExternalExportTarget[] {
  const next = targets.includes(target)
    ? targets.filter((item) => item !== target)
    : [...targets, target];

  return EXPORT_TARGET_ORDER.filter(
    (item) => availableTargets.includes(item) && next.includes(item)
  );
}

export function canSubmitExportTargets(
  targets: ExternalExportTarget[],
  configurations: ExportTargetConfiguration[]
): boolean {
  if (targets.length === 0) {
    return false;
  }

  const readiness = new Map(configurations.map((configuration) => [configuration.target, configuration.readiness]));
  return targets.every((target) => readiness.get(target) === "ready");
}

export function canSubmitAssetExportTargets(
  targets: ExternalExportTarget[],
  configurations: ExportTargetConfiguration[],
  confirmImaBodyExport: boolean
): boolean {
  return (
    canSubmitExportTargets(targets, configurations) &&
    (!targets.includes("ima") || confirmImaBodyExport)
  );
}

export function summarizeAssetExportOutcome(
  results: ExportTargetResult[]
): AssetExportOutcome {
  if (results.length === 0 || results.every((result) => result.status === "skipped")) {
    return "skipped";
  }

  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const incomplete = results.filter(
    (result) => result.status === "partial" || result.status === "unknown"
  ).length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  if (succeeded === results.length) {
    return "succeeded";
  }

  if (incomplete > 0 || (succeeded > 0 && (failed > 0 || skipped > 0))) {
    return "partial";
  }

  return failed > 0 ? "failed" : "skipped";
}

export function getFailedExportTargets(
  response: MultiTargetExportResponse
): ExternalExportTarget[] {
  return EXPORT_TARGET_ORDER.filter((target) =>
    response.results.some(
      (result) =>
        result.target === target &&
        (result.status === "failed" || result.status === "partial")
    )
  );
}

export function canForceRepublishImaResult(result: ExportTargetResult): boolean {
  return (
    result.target === "ima" &&
    result.status === "skipped" &&
    Boolean(result.operationId)
  );
}

export function canRetargetImaKnowledgeAssociation(result: ExportTargetResult): boolean {
  return (
    result.target === "ima" &&
    result.status === "partial" &&
    result.operationStage === "addKnowledge" &&
    Boolean(result.operationId) &&
    Boolean(result.resourceId)
  );
}

export function canCheckImaRemoteDrift(result: ExportTargetResult): boolean {
  return (
    result.target === "ima" &&
    (result.status === "succeeded" || result.status === "skipped") &&
    Boolean(result.operationId)
  );
}

export function exportTargetName(target: ExternalExportTarget): string {
  if (target === "obsidian") {
    return "Obsidian";
  }

  if (target === "notion") {
    return "Notion";
  }

  if (target === "ima") {
    return "Ima";
  }

  return "Markdown";
}
