import { describe, expect, it } from "vitest";
import {
  canCheckImaRemoteDrift,
  canForceRepublishImaResult,
  canRetargetImaKnowledgeAssociation,
  canSubmitAssetExportTargets,
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
  it("only checks remote drift for completed Ima records", () => {
    expect(canCheckImaRemoteDrift({
      target: "ima",
      status: "succeeded",
      operationId: "ima-export-1"
    })).toBe(true);
    expect(canCheckImaRemoteDrift({
      target: "ima",
      status: "skipped",
      operationId: "ima-export-1"
    })).toBe(true);
    expect(canCheckImaRemoteDrift({
      target: "ima",
      status: "partial",
      operationId: "ima-export-1"
    })).toBe(false);
  });

  it("only offers forced Ima republish for a successful dedupe result", () => {
    expect(canForceRepublishImaResult({
      target: "ima",
      status: "skipped",
      operationId: "ima-export-1"
    })).toBe(true);
    expect(canForceRepublishImaResult({
      target: "ima",
      status: "skipped"
    })).toBe(false);
    expect(canForceRepublishImaResult({
      target: "ima",
      status: "failed",
      operationId: "ima-export-1"
    })).toBe(false);
  });

  it("only offers knowledge-base retargeting for a confirmed addKnowledge partial", () => {
    expect(canRetargetImaKnowledgeAssociation({
      target: "ima",
      status: "partial",
      operationId: "ima-export-1",
      operationStage: "addKnowledge",
      resourceId: "note-1"
    })).toBe(true);
    expect(canRetargetImaKnowledgeAssociation({
      target: "ima",
      status: "partial",
      operationId: "ima-export-1",
      operationStage: "appendDoc",
      resourceId: "note-1"
    })).toBe(false);
    expect(canRetargetImaKnowledgeAssociation({
      target: "ima",
      status: "unknown",
      operationId: "ima-export-1",
      operationStage: "addKnowledge",
      resourceId: "note-1"
    })).toBe(false);
  });
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

  it("only exposes a ready Ima target to supported note exports", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          knowledgeBaseId: "knowledge-base-1",
          publishToKnowledgeBase: true,
          assetRoutes: {},
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["markdown", "ima"]
    });

    expect(configurations.map((item) => item.target)).toEqual(["markdown", "ima"]);
    expect(configurations[1]).toMatchObject({
      readiness: "ready",
      destinationLabel: "已选择 Ima 知识库"
    });
    expect(toggleExportTarget(["markdown"], "ima", ["markdown"])).toEqual(["markdown"]);
  });

  it("blocks Ima writes until compatibility is confirmed", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          knowledgeBaseId: "knowledge-base-1",
          publishToKnowledgeBase: true,
          assetRoutes: {},
          adapterVersion: "1.1.9",
          compatibilityStatus: "unconfirmed",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["ima"]
    });

    expect(configurations[0]).toMatchObject({
      readiness: "invalid",
      detail: "Ima 适配器兼容性尚未确认，请先刷新版本状态。"
    });
    expect(canSubmitExportTargets(["ima"], configurations)).toBe(false);
  });

  it("blocks Ima writes when compatibility flags are missing", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          knowledgeBaseId: "knowledge-base-1",
          publishToKnowledgeBase: true,
          assetRoutes: {},
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: false,
          isWriteCompatible: false
        }
      },
      platformMode: "native",
      availableTargets: ["ima"]
    });

    expect(configurations[0].readiness).toBe("invalid");
    expect(canSubmitExportTargets(["ima"], configurations)).toBe(false);
  });

  it("resolves the configured Ima route for the exported asset", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          noteFolderId: "global-notes",
          knowledgeBaseId: "global-knowledge-base",
          publishToKnowledgeBase: false,
          assetRoutes: {
            bookReview: {
              noteFolderId: "review-notes",
              knowledgeBaseId: "review-knowledge-base",
              knowledgeBaseFolderId: "review-folder",
              publishToKnowledgeBase: true
            }
          },
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["ima"],
      sourceKind: "bookReview"
    });

    expect(configurations[0]).toMatchObject({
      readiness: "ready",
      destinationLabel: "已选择 Ima 知识库"
    });
  });

  it("resolves the configured Ima route for a completed reading review", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          noteFolderId: "global-notes",
          publishToKnowledgeBase: false,
          assetRoutes: {
            readingStatsReview: {
              knowledgeBaseId: "review-knowledge-base",
              knowledgeBaseFolderId: "review-folder",
              publishToKnowledgeBase: true
            }
          },
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["ima"],
      sourceKind: "readingStatsReview"
    });

    expect(configurations[0]).toMatchObject({
      readiness: "ready",
      destinationLabel: "已选择 Ima 知识库"
    });
  });

  it("keeps a decision as an Ima note unless it has an explicit route", () => {
    const configurations = resolveExportTargetConfigurations({
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          noteFolderId: "global-notes",
          knowledgeBaseId: "global-knowledge-base",
          publishToKnowledgeBase: true,
          assetRoutes: {},
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["ima"],
      sourceKind: "bookDecision"
    });

    expect(configurations[0]).toMatchObject({
      readiness: "ready",
      destinationLabel: "笔记本：global-notes",
      detail: "将创建 Ima 笔记，不关联知识库。"
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

  it("requires explicit confirmation before submitting Ima note bodies", () => {
    const configurations = resolveExportTargetConfigurations({
      exportData: {
        exportDir: "C:/Users/RHZ/exports",
        defaultExportDir: "C:/Users/RHZ/exports",
        isCustomExportDir: false
      },
      integrationData: {
        ...integrationData,
        ima: {
          credential: { hasCredential: true },
          publishToKnowledgeBase: false,
          assetRoutes: {},
          adapterVersion: "1.1.9",
          compatibilityStatus: "compatible",
          canAttemptWrite: true,
          isWriteCompatible: true
        }
      },
      platformMode: "native",
      availableTargets: ["markdown", "ima"]
    });

    expect(
      canSubmitAssetExportTargets(["markdown", "ima"], configurations, false)
    ).toBe(false);
    expect(
      canSubmitAssetExportTargets(["markdown", "ima"], configurations, true)
    ).toBe(true);
    expect(canSubmitAssetExportTargets(["markdown"], configurations, false)).toBe(true);
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
    expect(
      summarizeAssetExportOutcome([
        { target: "ima", status: "unknown", operationId: "ima-export-1" }
      ])
    ).toBe("partial");
  });
});
