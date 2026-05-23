import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import { BookAiSummaryPage } from "./BookAiSummaryPage";
import { ReadingRoutePage } from "./ReadingRoutePage";
import type { PreparedAssetUpdate } from "../lib/types";

describe("prepared asset update prompt", () => {
  test("book review generation page shows prepared update context without auto generation", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookAiSummaryPage
          book={{
            bookId: "book-1",
            title: "深度工作",
            author: "卡尔·纽波特",
            reviewCount: 1,
            noteCount: 1,
            bookmarkCount: 0,
            totalNoteCount: 1
          }}
          preparedUpdate={createPreparedUpdate("book-review")}
          onOpenSettings={() => undefined}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("准备更新上一版书籍复盘");
    expect(markup).toContain("Prompt book-notes-summary-v3");
    expect(markup).toContain("只有点击“生成复盘”才会读取并发送当前书的划线和想法");
    expect(markup).toContain("没有本地缓存时，只有点击“生成复盘”才会读取并发送当前书笔记");
  });

  test("reading route generation page shows prepared update context without auto generation", () => {
    const markup = renderToStaticMarkup(
      <ReadingRoutePage
        shelfEntry={{
          id: "book-1",
          type: "book",
          title: "深度工作",
          author: "卡尔·纽波特",
          isTop: false,
          isSecret: false
        }}
        preparedUpdate={createPreparedUpdate("reading-route")}
        onOpenSettings={() => undefined}
        onOpenDiscovery={() => undefined}
        onBack={() => undefined}
      />
    );

    expect(markup).toContain("正在准备更新上一版阅读指南");
    expect(markup).toContain("Prompt reading-route-v2.1");
    expect(markup).toContain("需要你手动点击“生成更新版本”才会调用 AI");
    expect(markup).toContain("不会自动同步远端或发送完整反馈明细");
  });
});

function createPreparedUpdate(feature: PreparedAssetUpdate["feature"]): PreparedAssetUpdate {
  return {
    feature,
    bookId: "book-1",
    title: "深度工作",
    author: "卡尔·纽波特",
    versionTitle: feature === "book-review" ? "当前书籍复盘" : "当前阅读指南",
    promptVersion: feature === "book-review" ? "book-notes-summary-v3" : "reading-route-v2.1",
    generatedAt: "1709000000",
    scopeId: "book:book-1",
    inputHash: "asset-hash"
  };
}
