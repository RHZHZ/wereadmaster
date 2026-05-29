import { describe, expect, it, vi } from "vitest";
import {
  resolveLocalBookCoverTitle,
  resolveLocalBookCoverTone,
  resolveLocalLibraryProgressLoadState,
  resolveLocalBookImportNotice,
  resolveLocalBookImportProgressWarning
} from "./LocalLibraryPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

describe("local library import notice", () => {
  it("提示新导入图书", () => {
    expect(resolveLocalBookImportNotice({ title: "小王子" }, false)).toEqual({
      message: "已导入《小王子》",
      tone: "success"
    });
  });

  it("重复导入时提示打开现有记录", () => {
    expect(resolveLocalBookImportNotice({ title: "小王子" }, true)).toEqual({
      message: "《小王子》已在本地书库，可直接打开现有记录。",
      tone: "neutral"
    });
  });

  it("导入成功但阅读进度读取失败时只给附带提醒", () => {
    expect(resolveLocalBookImportProgressWarning("数据库暂时不可用")).toEqual({
      message: "图书已导入，但阅读进度暂时无法读取：数据库暂时不可用",
      tone: "neutral"
    });
  });

  it("书库加载时单本阅读进度失败不会阻塞其余进度", () => {
    expect(
      resolveLocalLibraryProgressLoadState([
        [
          "local-ok",
          {
            progress: {
              bookId: "local-ok",
              locator: "offset:10",
              progressPercent: 35,
              readTimeSeconds: 120,
              updatedAt: "2026-05-28T10:00:00+08:00"
            }
          }
        ],
        ["local-missing", { error: "源文件暂时不可读" }]
      ])
    ).toEqual({
      progressByBookId: {
        "local-ok": {
          bookId: "local-ok",
          locator: "offset:10",
          progressPercent: 35,
          readTimeSeconds: 120,
          updatedAt: "2026-05-28T10:00:00+08:00"
        }
      },
      warning: "部分阅读进度暂时无法读取，书库已按图书信息展示。"
    });
  });

  it("生成稳定且短小的本地封面标题", () => {
    expect(resolveLocalBookCoverTitle("  月亮与六便士  ")).toBe("月亮与六");
    expect(resolveLocalBookCoverTitle("")).toBe("未命名");
  });

  it("根据图书信息生成稳定封面色板编号", () => {
    const book = {
      id: "local-1",
      title: "月亮与六便士",
      author: "毛姆",
      format: "epub" as const
    };

    expect(resolveLocalBookCoverTone(book)).toBe(resolveLocalBookCoverTone(book));
    expect(resolveLocalBookCoverTone(book)).toBeGreaterThanOrEqual(1);
    expect(resolveLocalBookCoverTone(book)).toBeLessThanOrEqual(5);
  });
});
