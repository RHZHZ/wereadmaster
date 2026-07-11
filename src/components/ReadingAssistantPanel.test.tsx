import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ReadingAssistantBookReviewAction,
  ReadingAssistantCategoryBooksAction
} from "./ReadingAssistantPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

describe("ReadingAssistantBookReviewAction", () => {
  it("renders the AI review target and action button", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantBookReviewAction
        action={{
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          author: "罗伯特·清崎",
          message: "这类笔记总结应进入单本 AI 复盘，不走阅读指南。",
          ctaLabel: "生成 AI 复盘"
        }}
        onOpenBookReview={() => undefined}
      />
    );

    expect(markup).toContain("这类笔记总结应进入单本 AI 复盘，不走阅读指南。");
    expect(markup).toContain("富爸爸穷爸爸");
    expect(markup).toContain("罗伯特·清崎");
    expect(markup).toContain("生成 AI 复盘");
    expect(markup).toContain("reading-assistant-book-review-button");
  });

  it("keeps the target visible when navigation is unavailable", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantBookReviewAction
        action={{
          bookId: "book_1",
          title: "富爸爸穷爸爸",
          message: "这类笔记总结应进入单本 AI 复盘，不走阅读指南。",
          ctaLabel: "生成 AI 复盘"
        }}
      />
    );

    expect(markup).toContain("富爸爸穷爸爸");
    expect(markup).not.toContain("reading-assistant-book-review-button");
  });
});

describe("ReadingAssistantCategoryBooksAction", () => {
  it("renders local category books with separate stats count", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 4,
          totalStatReadingTimeText: "3小时28分钟",
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book_money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              readingTimeText: "1小时",
              source: "书架"
            }
          ]
        }}
      />
    );

    expect(markup).toContain("经济理财 · 本地可列 1 本 / 统计 4 本");
    expect(markup).toContain("小狗钱钱");
    expect(markup).toContain("博多·舍费尔");
    expect(markup).toContain("已读完");
    expect(markup).toContain("统计阅读时长 3小时28分钟");
  });

  it("renders openable local books as buttons", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "found",
          totalStatCount: 1,
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book-money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              source: "书架"
            }
          ]
        }}
        onOpenBookDetail={() => undefined}
        canOpenBookDetail={() => true}
      />
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("reading-assistant-category-book is-clickable");
    expect(markup).toContain("小狗钱钱");
  });

  it("keeps category books static when the book is not available in the shelf", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 1,
          listedCount: 1,
          message: "当前本地明细可验证到 1 本。",
          books: [
            {
              bookId: "book-money",
              title: "小狗钱钱",
              author: "博多·舍费尔",
              category: "经济理财",
              progressPercent: 100,
              isFinished: true,
              source: "统计缓存"
            }
          ]
        }}
        onOpenBookDetail={() => undefined}
        canOpenBookDetail={() => false}
      />
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("is-clickable");
    expect(markup).toContain("小狗钱钱");
  });

  it("keeps the missing-details boundary visible", () => {
    const markup = renderToStaticMarkup(
      <ReadingAssistantCategoryBooksAction
        action={{
          categoryLabel: "经济理财",
          matchedCategoryTitles: ["经济理财"],
          queryStatus: "partial",
          totalStatCount: 34,
          listedCount: 0,
          message: "统计有聚合，但本地无明细。",
          books: []
        }}
      />
    );

    expect(markup).toContain("经济理财 · 本地可列 0 本 / 统计 34 本");
    expect(markup).toContain("统计总数不会被展开成伪书名");
  });
});
