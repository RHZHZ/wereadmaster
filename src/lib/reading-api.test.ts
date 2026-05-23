import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

import { invoke } from "@tauri-apps/api/core";
import {
  clearAiOutputCache,
  chooseCustomExportDirectory,
  getAiReviewFeedback,
  getAIAssetVersionDetail,
  getAIAssetVersionHistory,
  getSettingsState,
  resetCustomExportDirectory,
  saveAiReviewFeedback,
  saveCustomExportDirectory
} from "./reading-api";

const invokeMock = vi.mocked(invoke);

describe("settings export directory API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("maps export location from settings state", async () => {
    invokeMock.mockResolvedValue({
      credential: { hasCredential: true },
      syncStates: [],
        localData: {
          dataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          defaultDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          databasePath: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/reading-cache.sqlite3",
          databaseSizeBytes: 1024,
          cacheRowCount: 2,
          isCustomDataDir: false,
          lastDataOperationError: "迁移失败：目标目录不可写",
          tableCounts: []
        },
      exportData: {
        exportDir: "D:/ReadingExports",
        defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
        isCustomExportDir: true
      },
      appVersion: "0.1.0"
    });

    const state = await getSettingsState();

    expect(state.exportData).toEqual({
      exportDir: "D:/ReadingExports",
      defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
      isCustomExportDir: true
    });
    expect(state.localData.lastDataOperationError).toBe("迁移失败：目标目录不可写");
  });

  test("choose, save and reset export directory commands keep selection separate from persistence", async () => {
    invokeMock
      .mockResolvedValueOnce({
        path: "D:/ReadingExports",
      })
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {
            exportDir: "D:/ReadingExports",
            defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            isCustomExportDir: true
          }
        }
      })
      .mockResolvedValueOnce({
        state: {
          credential: { hasCredential: true },
          syncStates: [],
          localData: {},
          exportData: {
            exportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
            isCustomExportDir: false
          }
        }
      });

    const chosen = await chooseCustomExportDirectory();
    const saved = await saveCustomExportDirectory("D:/ReadingExports");
    const reset = await resetCustomExportDirectory();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "choose_custom_export_directory");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_custom_export_directory", {
      targetDir: "D:/ReadingExports"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "reset_custom_export_directory");
    expect(chosen.path).toBe("D:/ReadingExports");
    expect(saved.state.exportData.isCustomExportDir).toBe(true);
    expect(reset.state.exportData.isCustomExportDir).toBe(false);
  });

  test("clears only AI output cache through dedicated command", async () => {
    invokeMock.mockResolvedValue({
      deletedRows: 3,
      state: {
        credential: { hasCredential: true },
        syncStates: [],
        localData: {
          dataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          defaultDataDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster",
          databasePath: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/reading-cache.sqlite3",
          databaseSizeBytes: 1024,
          cacheRowCount: 4,
          isCustomDataDir: false,
          tableCounts: [
            { table: "ai_outputs", rowCount: 0 },
            { table: "shelf_entries", rowCount: 4 },
            { table: "reading_item_states", rowCount: 2 }
          ]
        },
        exportData: {
          exportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          defaultExportDir: "C:/Users/RHZ/AppData/Roaming/wxreadmaster/exports",
          isCustomExportDir: false
        },
        appVersion: "0.1.0"
      }
    });

    const result = await clearAiOutputCache(true);

    expect(invokeMock).toHaveBeenCalledWith("clear_ai_output_cache", { confirm: true });
    expect(result.deletedRows).toBe(3);
    expect(result.state.localData.tableCounts).toContainEqual({ table: "ai_outputs", rowCount: 0 });
    expect(result.state.localData.tableCounts).toContainEqual({ table: "shelf_entries", rowCount: 4 });
    expect(result.state.localData.tableCounts).toContainEqual({
      table: "reading_item_states",
      rowCount: 2
    });
  });

  test("reads ai asset version detail with explicit version identity", async () => {
    invokeMock.mockResolvedValue({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash",
      promptVersion: "reading-route-v2.1",
      generatedAt: "140",
      updatedAt: "140",
      source: "cache",
      basisNotice: "基于本地缓存生成。",
      sourceStats: {},
      readingRoute: {
        routeOverview: "先读主书，再整理行动。",
        books: [],
        dependencies: [],
        reviewCheckpoints: [],
        nextActions: [],
        sourceStats: {
          currentBookCount: 1,
          candidateCount: 0,
          summaryCount: 0,
          statsSignalCount: 0,
          localStatusCount: 0
        },
        generatedAt: "140",
        promptVersion: "reading-route-v2.1",
        basisNotice: "基于本地缓存生成。"
      }
    });

    const detail = await getAIAssetVersionDetail({
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });

    expect(invokeMock).toHaveBeenCalledWith("get_ai_asset_version_detail", {
      feature: "reading-route",
      scopeId: "book:book_1",
      inputHash: "route_hash"
    });
    expect(detail?.feature).toBe("reading-route");
    expect(detail?.readingRoute?.routeOverview).toBe("先读主书，再整理行动。");
  });

  test("reads ai asset version history within current book scope", async () => {
    invokeMock.mockResolvedValue([
      {
        feature: "book-review",
        scopeId: "book_1",
        inputHash: "summary_hash_v2",
        promptVersion: "book-notes-summary-v3",
        generatedAt: "220",
        updatedAt: "220",
        source: "cache",
        title: "第二版复盘",
        readingStage: "closing",
        readingStageLabel: "收束整理",
        progress: 100,
        refreshReason: "completed",
        isCurrent: false
      }
    ]);

    const versions = await getAIAssetVersionHistory({
      feature: "book-review",
      scopeId: "book_1"
    });

    expect(invokeMock).toHaveBeenCalledWith("get_ai_asset_version_history", {
      feature: "book-review",
      scopeId: "book_1"
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].inputHash).toBe("summary_hash_v2");
  });

  test("reads and saves ai review feedback through local database commands", async () => {
    const feedback = {
      actionItems: {
        "0:写一页复盘": {
          status: "completed" as const,
          note: "已完成",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      },
      reflectionQuestions: {}
    };
    invokeMock.mockResolvedValueOnce(feedback).mockResolvedValueOnce(feedback);

    const loaded = await getAiReviewFeedback({
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash"
    });
    const saved = await saveAiReviewFeedback({
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash",
      feedback
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_ai_review_feedback", {
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ai_review_feedback", {
      feature: "book-review",
      scopeId: "book_1",
      inputHash: "summary_hash",
      feedback
    });
    expect(loaded.actionItems["0:写一页复盘"].status).toBe("completed");
    expect(saved.actionItems["0:写一页复盘"].note).toBe("已完成");
  });
});
