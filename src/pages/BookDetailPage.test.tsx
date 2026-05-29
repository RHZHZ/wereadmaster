import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import type { LocalBook } from "../lib/local-reader-types";
import type { BookDetailResponse } from "../lib/reading-api";
import { createReadingAssetLinkPair } from "../lib/reading-asset-links";
import type { ShelfEntry } from "../lib/types";
import { BookDetailPage } from "./BookDetailPage";

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
  it("微信书籍详情页只读提示疑似本地版本", () => {
    const markup = renderPage({
      shelfEntry: makeShelfEntry("weread-1", "小王子", "圣埃克苏佩里"),
      detailResponse: makeDetailResponse("weread-1", "《小王子》", "圣埃克苏佩里"),
      localBooks: [makeLocalBook("local-1", "小王子", "圣埃克苏佩里")]
    });

    expect(markup).toContain('aria-label="疑似本地版本"');
    expect(markup).toContain("可能存在本地版本");
    expect(markup).toContain("不会合并微信读书笔记、本地划线、进度或 AI 缓存");
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

function makeDetailResponse(bookId: string, title: string, author?: string): BookDetailResponse {
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
      isFinished: false
    },
    chapters: [],
    deepLink: `weread://reading?bId=${bookId}`
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
