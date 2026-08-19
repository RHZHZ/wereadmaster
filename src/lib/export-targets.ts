import type {
  ExternalExportTarget,
  MultiTargetExportRequest,
  MultiTargetExportResponse
} from "./types";

export type ExportDestination = "markdown" | "obsidian" | "notion" | "ima" | "obsidianNotion";

export function exportTargetsFromDestination(destination: ExportDestination): ExternalExportTarget[] {
  return destination === "obsidianNotion" ? ["obsidian", "notion"] : [destination];
}

export function buildMultiTargetExportRequest(
  targets: ExternalExportTarget[],
  confirmImaBodyExport = false,
  forceImaNewSnapshot = false
): MultiTargetExportRequest {
  if (!targets.includes("ima")) {
    return { targets };
  }

  return {
    targets,
    ima: {
      confirmBodyExport: confirmImaBodyExport,
      forceNewSnapshot: forceImaNewSnapshot
    }
  };
}

export function exportTargetLabel(target: ExternalExportTarget) {
  if (target === "obsidian") return "Obsidian";
  if (target === "notion") return "Notion";
  if (target === "ima") return "Ima";
  return "Markdown";
}

export function formatMultiTargetExportToast(response: MultiTargetExportResponse) {
  const succeeded = response.results.filter((result) => result.status === "succeeded").length;

  return {
    message:
      succeeded === response.results.length
        ? `已完成 ${succeeded} 个导出目标。`
        : `已完成 ${succeeded}/${response.results.length} 个导出目标，请查看结果。`,
    tone: succeeded > 0 ? ("success" as const) : ("error" as const)
  };
}
