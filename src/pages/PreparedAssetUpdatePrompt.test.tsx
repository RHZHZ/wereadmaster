import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import { BookAiSummaryPage } from "./BookAiSummaryPage";
import { ReadingRoutePage } from "./ReadingRoutePage";
import type { BookNotes, PreparedAssetUpdate } from "../lib/types";

describe("prepared asset update prompt", () => {
  test("book review generation page shows prepared update context without auto generation", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookAiSummaryPage
          book={{
            bookId: "book-1",
            title: "深度工作",
            author: "卡尔·纽波特",
            reviewCount: 0,
            noteCount: 0,
            bookmarkCount: 0,
            totalNoteCount: 0
          }}
          notes={createBookNotes()}
          preparedUpdate={createPreparedUpdate("book-review")}
          onOpenSettings={() => undefined}
          onBack={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("准备更新上一版书籍复盘");
    expect(markup).toContain("将参考你上次记录的阅读成果生成新版");
    expect(markup).toContain("点击“生成复盘”时使用当前书笔记");
    expect(markup).toContain("点击“生成复盘”后，会使用当前书笔记生成书籍复盘");
  });

  test("reading route generation page shows prepared update context without auto generation", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
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
      </ToastProvider>
    );

    expect(markup).toContain("正在准备更新上一版阅读指南");
    expect(markup).toContain("来源版本：当前阅读指南");
    expect(markup).toContain("点击“生成更新版本”后使用当前书上下文生成新版本");
    expect(markup).toContain("将参考你上次记录的阅读成果生成新版");
  });
});

function createBookNotes(): BookNotes {
  return {
    bookId: "book-1",
    highlights: [
      {
        bookmarkId: "highlight-1",
        bookId: "book-1",
        chapterUid: 1,
        chapterTitle: "第一章",
        markText: "专注需要主动保护。",
        createTime: 1
      }
    ],
    thoughts: [],
    chapters: [],
    chapterGroups: [],
    bookmarkCount: 0,
    exportableCount: 1,
    bookmarkContentNotice: "书签正文不可用。"
  };
}

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
