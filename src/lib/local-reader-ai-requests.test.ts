import { describe, expect, it } from "vitest";
import { createLocalReaderAiQuestionRequest } from "./local-reader-ai-requests";
import type { LocalBook } from "./local-reader-types";

describe("local reader AI question requests", () => {
  it("只用本地来源、书籍元信息、选中文本和用户问题创建请求", () => {
    const request = createLocalReaderAiQuestionRequest({
      book: makeLocalBook(),
      selectedText: "  选中的这一段正文  ",
      question: "  这段话的核心是什么？  ",
      startOffset: 10,
      endOffset: 20
    });

    expect(request).toEqual({
      sourceItem: { source: "local", sourceId: "local-book-1" },
      book: {
        title: "本地图书",
        author: "作者"
      },
      selection: {
        text: "选中的这一段正文",
        startOffset: 10,
        endOffset: 20
      },
      question: "这段话的核心是什么？"
    });
  });

  it("为短选区附带有限的前后文窗口", () => {
    const content = [
      "前文说明作者第一次听到柴静采访时的紧张。",
      "柴静问了一个看似温和却直指核心的问题。",
      "后文转向受访者沉默后的反应。"
    ].join("\n");
    const selectedText = "柴静";
    const startOffset = content.indexOf(selectedText);
    const request = createLocalReaderAiQuestionRequest({
      book: makeLocalBook(),
      selectedText,
      question: "这里的她是谁？",
      startOffset,
      endOffset: startOffset + selectedText.length,
      content
    });

    expect(request?.selection.context).toEqual({
      beforeText: "前文说明作者第一次听到",
      afterText: "采访时的紧张。\n柴静问了一个看似温和却直指核心的问题。\n后文转向受访者沉默后的反应。"
    });
  });

  it("前后文窗口不会扩大到整本书", () => {
    const distantPrefix = `敏感路径 C:/Books/private.txt ${"前".repeat(1400)}`;
    const content = `${distantPrefix}柴静${"后".repeat(1400)} wx_session`;
    const startOffset = content.indexOf("柴静");
    const request = createLocalReaderAiQuestionRequest({
      book: makeLocalBook(),
      selectedText: "柴静",
      question: "这是谁？",
      startOffset,
      endOffset: startOffset + 2,
      content
    });
    const serialized = JSON.stringify(request);

    expect(request?.selection.context?.beforeText).toHaveLength(1200);
    expect(request?.selection.context?.afterText).toHaveLength(1200);
    expect(serialized).not.toContain("C:/Books/private.txt");
    expect(serialized).not.toContain("wx_session");
  });

  it("不会把整本书、本地路径、hash 或任何密钥字段带入请求体", () => {
    const bookWithSensitiveFields = {
      ...makeLocalBook(),
      content: "整本书正文不应进入请求",
      filePath: "C:/Books/local.txt",
      apiKey: "sk-local-secret",
      wereadCredential: "weread-secret"
    };

    const request = createLocalReaderAiQuestionRequest({
      book: bookWithSensitiveFields,
      selectedText: "只发送选中文本",
      question: "解释这一段",
      startOffset: 0,
      endOffset: 6
    });

    const serialized = JSON.stringify(request);

    expect(serialized).toContain("只发送选中文本");
    expect(serialized).not.toContain("整本书正文");
    expect(serialized).not.toContain("C:/Books/local.txt");
    expect(serialized).not.toContain("local-reader/local-book-1/source.txt");
    expect(serialized).not.toContain("file-hash-1");
    expect(serialized).not.toContain("sk-local-secret");
    expect(serialized).not.toContain("weread-secret");
  });

  it("拒绝空问题、空选区和无效 offset", () => {
    expect(
      createLocalReaderAiQuestionRequest({
        book: makeLocalBook(),
        selectedText: "",
        question: "解释",
        startOffset: 0,
        endOffset: 2
      })
    ).toBeUndefined();

    expect(
      createLocalReaderAiQuestionRequest({
        book: makeLocalBook(),
        selectedText: "选区",
        question: "",
        startOffset: 0,
        endOffset: 2
      })
    ).toBeUndefined();

    expect(
      createLocalReaderAiQuestionRequest({
        book: makeLocalBook(),
        selectedText: "选区",
        question: "解释",
        startOffset: 4,
        endOffset: 2
      })
    ).toBeUndefined();
  });
});

function makeLocalBook(): LocalBook {
  return {
    id: "local-book-1",
    source: "local",
    title: " 本地图书 ",
    author: " 作者 ",
    format: "txt",
    fileHash: "file-hash-1",
    fileSize: 1024,
    storagePath: "local-reader/local-book-1/source.txt",
    importedAt: "2026-05-27T08:00:00.000Z",
    updatedAt: "2026-05-27T08:00:00.000Z"
  };
}
