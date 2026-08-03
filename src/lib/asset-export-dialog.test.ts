import { describe, expect, it } from "vitest";
import {
  canSubmitExportTargets,
  getFailedExportTargets,
  resolveExportPlatformMode,
  resolveExportTargetConfigurations,
  summarizeAssetExportOutcome,
  toggleExportTarget
} from "./asset-export-dialog";
import type { IntegrationDataState, MultiTargetExportResponse } from "./types";

const integrationData: IntegrationDataState = {
  obsidian: {
    vaultDir: "D:/Notes/Reading",
    hasConfiguredVault: true,
    attachmentMode: "siblingAssets",
    openAfterExport: false
  },
  notion: {
    credential: { hasCredential: true },
    parentId: "notion-parent",
    parentType: "database",
    coverMode: "pageCover",
    databaseConnection: {
      databaseId: "notion-database",
      databaseName: "阅读成果库",
      titlePropertyId: "title",
      titlePropertyNameSnapshot: "名称",
      mappings: [],
      schemaCheckedAt: "1785680000"
    }
  }
};

function response(
  results: MultiTargetExportResponse["results"]
): MultiTargetExportResponse {
  return {
    exportId: "export-1",
    sourceKind: "readingStatsReview",
    sourceId: "monthly-2026-07",
    exportedAt: "2026-08-03T12:00:00+08:00",
    results
  };
}

describe("asset export dialog helpers", () => {
  it("resolves native and web readonly platform modes from the runtime", () => {
    expect(resolveExportPlatformMode({ __TAURI__: {} })).toBe("native");
    expect(resolveExportPlatformMode({ __TAURI_INTERNALS__: {} })).toBe("native");
    expect(resolveExportPlatformMode({})).toBe("webReadonly");
  });

  it("resolves configured destinations without inventing a combined target", () => {
    const configurations = resolveExportTargetConfigurations({
      exportData: {
        exportDir: "C:/Users/RHZ/exports",
        defaultExportDir: "C:/Users/RHZ/exports",
        isCustomExportDir: false
      },
      integrationData,
      platformMode: "native"
    });

    expect(configurations.map((item) => item.target)).toEqual([
      "markdown",
      "obsidian",
      "notion"
    ]);
    expect(configurations[0]).toMatchObject({
      readiness: "ready",
      destinationLabel: "保存到：C:/Users/RHZ/exports"
    });
    expect(configurations[1]).toMatchObject({
      readiness: "ready",
      destinationLabel: "Vault：D:/Notes/Reading"
    });
    expect(configurations[2]).toMatchObject({
      readiness: "ready",
      destinationLabel: "目标：阅读成果库"
    });
  });

  it("marks missing settings and readonly web targets honestly", () => {
    const missing = resolveExportTargetConfigurations({
      exportData: { exportDir: "", defaultExportDir: "", isCustomExportDir: false },
      integrationData: {
        obsidian: {
          hasConfiguredVault: false,
          attachmentMode: "siblingAssets",
          openAfterExport: false
        },
        notion: {
          credential: { hasCredential: false },
          coverMode: "pageCover"
        }
      },
      platformMode: "native"
    });
    const readonly = resolveExportTargetConfigurations({
      platformMode: "webReadonly"
    });

    expect(missing.every((item) => item.readiness === "missing")).toBe(true);
    expect(readonly.every((item) => item.readiness === "readonly")).toBe(true);
    expect(readonly.every((item) => item.destinationLabel === "桌面应用可用")).toBe(true);
  });

  it("keeps selected targets ordered and only submits ready targets", () => {
    const configurations = resolveExportTargetConfigurations({
      exportData: {
        exportDir: "C:/Users/RHZ/exports",
        defaultExportDir: "C:/Users/RHZ/exports",
        isCustomExportDir: false
      },
      integrationData,
      platformMode: "native"
    });
    const selected = toggleExportTarget(["markdown"], "notion");

    expect(selected).toEqual(["markdown", "notion"]);
    expect(canSubmitExportTargets(selected, configurations)).toBe(true);
    expect(canSubmitExportTargets([], configurations)).toBe(false);
    expect(toggleExportTarget(selected, "markdown")).toEqual(["notion"]);
  });

  it("summarizes target-level outcomes and extracts only failed targets", () => {
    const partial = response([
      { target: "markdown", status: "succeeded", path: "review.md" },
      {
        target: "notion",
        status: "failed",
        error: { code: "notion_export_failed", message: "连接失效" }
      }
    ]);

    expect(summarizeAssetExportOutcome(partial.results)).toBe("partial");
    expect(getFailedExportTargets(partial)).toEqual(["notion"]);
    expect(
      summarizeAssetExportOutcome([
        { target: "markdown", status: "succeeded" },
        { target: "obsidian", status: "succeeded" }
      ])
    ).toBe("succeeded");
    expect(
      summarizeAssetExportOutcome([
        { target: "markdown", status: "failed" }
      ])
    ).toBe("failed");
    expect(
      summarizeAssetExportOutcome([
        { target: "markdown", status: "skipped" }
      ])
    ).toBe("skipped");
  });
});
