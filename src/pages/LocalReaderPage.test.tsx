import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

import {
  buildLocalReaderOutline,
  resolveLocalReaderProgressLoadWarning,
  resolveLocalReaderProgressSaveErrorNotice,
  shouldIgnoreLocalReaderProgressSaveResult,
  shouldNotifyLocalReaderProgressSaveError
} from "./LocalReaderPage";

describe("local reader progress warning", () => {
  it("打开正文后阅读进度读取失败只作为附带提醒", () => {
    expect(resolveLocalReaderProgressLoadWarning("数据库暂时不可用")).toEqual({
      message: "阅读正文已打开，但阅读进度暂时无法读取：数据库暂时不可用",
      tone: "neutral"
    });
  });

  it("保存进度失败时展示带上下文的错误提示", () => {
    expect(resolveLocalReaderProgressSaveErrorNotice("数据库暂时不可用")).toEqual({
      message: "阅读进度保存失败：数据库暂时不可用",
      tone: "error"
    });
  });

  it("同一条保存错误重复出现时不反复提示", () => {
    expect(shouldNotifyLocalReaderProgressSaveError(undefined, "数据库暂时不可用")).toBe(true);
    expect(shouldNotifyLocalReaderProgressSaveError("数据库暂时不可用", "数据库暂时不可用")).toBe(false);
    expect(shouldNotifyLocalReaderProgressSaveError("数据库暂时不可用", "文件被占用")).toBe(true);
  });

  it("忽略旧书或旧加载轮次返回的保存结果", () => {
    expect(
      shouldIgnoreLocalReaderProgressSaveResult({
        activeBookId: "book-b",
        requestBookId: "book-a",
        activeSaveSessionId: 1,
        requestSaveSessionId: 1
      })
    ).toBe(true);
    expect(
      shouldIgnoreLocalReaderProgressSaveResult({
        activeBookId: "book-a",
        requestBookId: "book-a",
        activeSaveSessionId: 2,
        requestSaveSessionId: 1
      })
    ).toBe(true);
    expect(
      shouldIgnoreLocalReaderProgressSaveResult({
        activeBookId: "book-a",
        requestBookId: "book-a",
        activeSaveSessionId: 1,
        requestSaveSessionId: 1,
        resultBookId: "book-b"
      })
    ).toBe(true);
    expect(
      shouldIgnoreLocalReaderProgressSaveResult({
        activeBookId: "book-a",
        requestBookId: "book-a",
        activeSaveSessionId: 1,
        requestSaveSessionId: 1
      })
    ).toBe(false);
  });

  it("Markdown 目录识别标题并忽略代码块内标题", () => {
    const outline = buildLocalReaderOutline(
      [
        "# 第一章",
        "",
        "正文",
        "```",
        "# 代码里的标题",
        "```",
        "## 第二节"
      ].join("\n"),
      "markdown"
    );

    expect(outline.map((item) => item.title)).toEqual(["第一章", "第二节"]);
  });
});
