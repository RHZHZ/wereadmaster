import type {
  ExportDataState,
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

export const EXPORT_TARGET_ORDER: ExternalExportTarget[] = ["markdown", "obsidian", "notion"];

export function resolveExportTargetConfigurations({
  exportData,
  integrationData,
  platformMode
}: {
  exportData?: ExportDataState;
  integrationData?: IntegrationDataState;
  platformMode: ExportPlatformMode;
}): ExportTargetConfiguration[] {
  if (platformMode === "webReadonly") {
    return EXPORT_TARGET_ORDER.map((target) => ({
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

  return [
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
    }
  ];
}

export function toggleExportTarget(
  targets: ExternalExportTarget[],
  target: ExternalExportTarget
): ExternalExportTarget[] {
  const next = targets.includes(target)
    ? targets.filter((item) => item !== target)
    : [...targets, target];

  return EXPORT_TARGET_ORDER.filter((item) => next.includes(item));
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

export function summarizeAssetExportOutcome(
  results: ExportTargetResult[]
): AssetExportOutcome {
  if (results.length === 0 || results.every((result) => result.status === "skipped")) {
    return "skipped";
  }

  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  if (succeeded === results.length) {
    return "succeeded";
  }

  if (succeeded > 0 && (failed > 0 || skipped > 0)) {
    return "partial";
  }

  return failed > 0 ? "failed" : "skipped";
}

export function getFailedExportTargets(
  response: MultiTargetExportResponse
): ExternalExportTarget[] {
  return EXPORT_TARGET_ORDER.filter((target) =>
    response.results.some((result) => result.target === target && result.status === "failed")
  );
}

export function exportTargetName(target: ExternalExportTarget): string {
  if (target === "obsidian") {
    return "Obsidian";
  }

  if (target === "notion") {
    return "Notion";
  }

  return "Markdown";
}
