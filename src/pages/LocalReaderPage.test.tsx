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
  buildProgressSaveKey,
  buildLocalReaderOutline,
  resolveLocalReaderProgressLoadWarning,
  resolveLocalReaderProgressSaveErrorNotice,
  resolveLocalReaderSaveStateLabel,
  shouldIgnoreLocalReaderProgressSaveResult,
  shouldNotifyLocalReaderProgressSaveError,
  shouldRetryLocalReaderProgressSave
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
      message: "本地阅读进度暂未保存，系统会自动重试：数据库暂时不可用",
      tone: "neutral"
    });
  });

  it("保存状态文案保持阅读场景的非阻塞语气", () => {
    expect(resolveLocalReaderSaveStateLabel("idle")).toBe("本地进度");
    expect(resolveLocalReaderSaveStateLabel("saving")).toBe("保存中");
    expect(resolveLocalReaderSaveStateLabel("saved")).toBe("已保存");
    expect(resolveLocalReaderSaveStateLabel("error")).toBe("暂未保存");
  });

  it("同一条保存错误重复出现时不反复提示", () => {
    expect(shouldNotifyLocalReaderProgressSaveError(undefined, "数据库暂时不可用")).toBe(true);
    expect(shouldNotifyLocalReaderProgressSaveError("数据库暂时不可用", "数据库暂时不可用")).toBe(false);
    expect(shouldNotifyLocalReaderProgressSaveError("数据库暂时不可用", "文件被占用")).toBe(true);
  });

  it("保存进度失败后只自动重试一次", () => {
    expect(shouldRetryLocalReaderProgressSave(undefined)).toBe(true);
    expect(shouldRetryLocalReaderProgressSave(0)).toBe(true);
    expect(shouldRetryLocalReaderProgressSave(1)).toBe(false);
  });

  it("保存进度去重键不受重试次数影响", () => {
    const progressSave = {
      progressPercent: 42,
      locator: "text:120:300",
      readTimeSeconds: 18
    };

    expect(buildProgressSaveKey(progressSave)).toBe(
      buildProgressSaveKey({ ...progressSave, retryAttempt: 1 })
    );
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
