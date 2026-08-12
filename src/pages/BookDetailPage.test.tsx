import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import type { LocalBook } from "../lib/local-reader-types";
import type { BookDetailResponse } from "../lib/reading-api";
import { createReadingAssetLinkPair } from "../lib/reading-asset-links";
import type { Chapter, PublicReviewsResult, ReadingProgress, ShelfEntry } from "../lib/types";
import { BookDetailPage, mergePublicReviewPages } from "./BookDetailPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn()
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("book detail local version notice", () => {
  it("展示本书整理状态并指向现有下一步动作", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "深度工作", "卡尔·纽波特"),
      detailResponse: makeDetailResponse("weread-1", "深度工作", "卡尔·纽波特"),
      localBooks: []
    });

    expect(markup).toContain('aria-label="本书整理状态"');
    expect(markup).toContain("阅读中");
    expect(markup).toContain("继续积累可复盘材料");
    expect(markup).toContain("微信进度 12%");
    expect(markup).toContain("本书阅读指南");
  });

  it("微信书籍详情页只读提示疑似本地版本", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子", "圣埃克苏佩里"),
      detailResponse: makeDetailResponse("weread-1", "《小王子》", "圣埃克苏佩里"),
      localBooks: [makeLocalBook("local-1", "小王子", "圣埃克苏佩里")]
    });

    expect(markup).toContain('aria-label="疑似本地版本"');
    expect(markup).toContain("可能存在本地版本");
    expect(markup).toContain("不会自动合并笔记、划线或进度");
  });

  it("作者冲突时不展示本地版本提示", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子", "作者甲"),
      detailResponse: makeDetailResponse("weread-1", "小王子", "作者甲"),
      localBooks: [makeLocalBook("local-1", "小王子", "作者乙")]
    });

    expect(markup).not.toContain('aria-label="疑似本地版本"');
    expect(markup).not.toContain("可能存在本地版本");
  });

  it("同名本地版本存在多个候选时不展示本地版本提示", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子"),
      detailResponse: makeDetailResponse("weread-1", "小王子"),
      localBooks: [makeLocalBook("local-1", "小王子"), makeLocalBook("local-2", "《小王子》")]
    });

    expect(markup).not.toContain('aria-label="疑似本地版本"');
    expect(markup).not.toContain("可能存在本地版本");
  });

  it("同名本地版本存在已知作者冲突时不使用未知作者版本兜底", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子", "作者甲"),
      detailResponse: makeDetailResponse("weread-1", "小王子", "作者甲"),
      localBooks: [makeLocalBook("local-1", "小王子", "作者乙"), makeLocalBook("local-2", "小王子")]
    });

    expect(markup).not.toContain('aria-label="疑似本地版本"');
    expect(markup).not.toContain("可能存在本地版本");
  });

  it("已有手动关联时展示已关联状态和取消入口", () => {
    const storage = createMemoryStorage();
    const link = createReadingAssetLinkPair({
      local: { source: "local", sourceId: "local-1" },
      weread: { source: "weread", sourceId: "weread-1" },
      now: "2026-05-28T10:00:00.000Z"
    });
    storage.setItem("wxreadmaster.readingAssetLinks.v1", JSON.stringify([link]));
    vi.stubGlobal("window", { localStorage: storage });

    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子", "圣埃克苏佩里"),
      detailResponse: makeDetailResponse("weread-1", "《小王子》", "圣埃克苏佩里"),
      localBooks: [makeLocalBook("local-1", "小王子", "圣埃克苏佩里")]
    });

    expect(markup).toContain("已关联本地版本");
    expect(markup).toContain("取消关联");
  });

  it("展示当前阅读章节名", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "深度工作", "卡尔·纽波特"),
      detailResponse: makeDetailResponse(
        "weread-1",
        "深度工作",
        "卡尔·纽波特",
        {
          chapterUid: 12,
          progressPercent: 42
        },
        [
          makeChapter("weread-1", 11, 1, "第一章：专注"),
          makeChapter("weread-1", 12, 2, "第二章：深度工作")
        ]
      ),
      localBooks: []
    });

    expect(markup).toContain("当前章节：第二章：深度工作");
  });

  it("公开点评分页按 reviewId 去重并采用新游标", () => {
    const current = makePublicReviewsResult({
      reviews: [
        { reviewId: "r1", content: "第一页点评" },
        { reviewId: "r2", content: "重复点评" }
      ],
      synckey: 10,
      nextMaxIdx: 2
    });
    const next = makePublicReviewsResult({
      reviews: [
        { reviewId: "r2", content: "重复点评" },
        { reviewId: "r3", content: "第二页点评" }
      ],
      hasMore: false,
      synckey: 20,
      nextMaxIdx: 4
    });

    expect(mergePublicReviewPages(current, next)).toEqual({
      ...next,
      reviews: [current.reviews[0], current.reviews[1], next.reviews[1]]
    });
  });

  it("公开点评筛选变化时不合并旧筛选结果", () => {
    const current = makePublicReviewsResult({
      reviewListType: 0,
      reviews: [{ reviewId: "r1", content: "全部点评" }]
    });
    const next = makePublicReviewsResult({
      reviewListType: 3,
      reviews: [{ reviewId: "r2", content: "最新点评" }]
    });

    expect(mergePublicReviewPages(current, next)).toBe(next);
  });
});

function renderPage(input: {
  shelfEntry: ShelfEntry;
  detailResponse: BookDetailResponse;
  localBooks: LocalBook[];
}) {
  return renderToStaticMarkup(
    <ToastProvider>
      <BookDetailPage
        shelfEntry={input.shelfEntry}
        detailResponse={input.detailResponse}
        localBooks={input.localBooks}
        isLoading={false}
        isOpening={false}
        onBack={() => undefined}
        onRetry={() => undefined}
        onOpenBook={() => undefined}
        onOpenChapter={() => undefined}
        onOpenNotes={() => undefined}
        onOpenAiSummary={() => undefined}
        onOpenReadingRoute={() => undefined}
      />
    </ToastProvider>
  );
}

function makeShelfEntry(id: string, title: string, author?: string): ShelfEntry {
  return {
    id,
    type: "book",
    title,
    author,
    isTop: false,
    isSecret: false
  };
}

function makeDetailResponse(
  bookId: string,
  title: string,
  author?: string,
  progressOverrides: Partial<ReadingProgress> = {},
  chapters: Chapter[] = []
): BookDetailResponse {
  return {
    detail: {
      bookId,
      title,
      author,
      intro: "一本适合复盘的书。"
    },
    progress: {
      bookId,
      progressPercent: 12,
      isStarted: true,
      isFinished: false,
      ...progressOverrides
    },
    chapters,
    deepLink: ""
  };
}

function makePublicReviewsResult(
  overrides: Partial<PublicReviewsResult> = {}
): PublicReviewsResult {
  return {
    bookId: "weread-1",
    reviewListType: 0,
    hasMore: true,
    has5Star: true,
    has1Star: true,
    hasRecent: true,
    reviews: [],
    ...overrides
  };
}

function makeChapter(bookId: string, chapterUid: number, chapterIdx: number, title: string): Chapter {
  return {
    bookId,
    chapterUid,
    chapterIdx,
    title,
    level: 1
  };
}

function makeLocalBook(id: string, title: string, author?: string): LocalBook {
  return {
    id,
    source: "local",
    title,
    author,
    format: "txt",
    fileHash: `${id}-hash`,
    fileSize: 1024,
    storagePath: `local-reader/${id}.txt`,
    importedAt: "2026-05-27T08:00:00.000Z",
    updatedAt: "2026-05-27T08:00:00.000Z"
  };
}

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}
