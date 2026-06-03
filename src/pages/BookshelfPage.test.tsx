import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import type { BookshelfResponse } from "../lib/reading-api";
import type { ShelfArchive, ShelfEntry } from "../lib/types";
import { BookshelfPage } from "./BookshelfPage";
import {
  filterEntries,
  getCategoryEntries,
  getCategoryOptions,
  getParentCategory,
  getUnarchivedBookCount,
  getVisibleArchiveOptions,
  getVisibleCategoryOptions
} from "./bookshelf-filter";

describe("bookshelf filter helpers", () => {
  const entries = [
    makeEntry("book-1", "book", "三体", "刘慈欣", "计算机-前端"),
    makeEntry("book-2", "book", "算法导论", "Thomas", "计算机-后端"),
    makeEntry("album-1", "album", "夜航西飞", "播音", "文学-经典"),
    makeEntry("mp-1", "mp", "公众号文章", "作者甲", "科技-前沿")
  ];

  it("keeps category options on the current shelf type and skips mp entries", () => {
    expect(getCategoryEntries(entries, "all")).toHaveLength(3);
    expect(getCategoryEntries(entries, "book")).toHaveLength(2);
    expect(getCategoryEntries(entries, "album")).toHaveLength(1);
    expect(getCategoryEntries(entries, "mp")).toHaveLength(0);

    expect(getCategoryOptions(getCategoryEntries(entries, "all"))).toEqual([
      { label: "计算机", count: 2 },
      { label: "文学", count: 1 }
    ]);
    expect(getCategoryOptions(getCategoryEntries(entries, "book"))).toEqual([
      { label: "计算机", count: 2 }
    ]);
  });

  it("keeps the active category visible when the preview is collapsed", () => {
    const options = Array.from({ length: 13 }, (_, index) => ({
      label: `分类${index + 1}`,
      count: 1
    }));

    const visible = getVisibleCategoryOptions(options, "分类13", false);

    expect(visible).toHaveLength(12);
    expect(visible.map((item) => item.label)).toContain("分类13");
    expect(visible.map((item) => item.label)).not.toContain("分类12");
  });

  it("filters by type, category, and keyword together", () => {
    expect(filterEntries(entries, "book", "计算机", "算法")).toEqual([
      makeEntry("book-2", "book", "算法导论", "Thomas", "计算机-后端")
    ]);
    expect(filterEntries(entries, "album", "计算机", "")).toEqual([]);
    expect(filterEntries(entries, "all", "文学", "夜航")).toEqual([
      makeEntry("album-1", "album", "夜航西飞", "播音", "文学-经典")
    ]);
  });

  it("filters books by WeRead archive membership", () => {
    const archives = [
      makeArchive("archive-1", "技术栈", ["book-1", "missing"], 1, 1)
    ];

    expect(filterEntries(entries, "all", "all", "", "archive-1", archives)).toEqual([
      makeEntry("book-1", "book", "三体", "刘慈欣", "计算机-前端")
    ]);
    expect(filterEntries(entries, "all", "all", "", "unarchived", archives)).toEqual([
      makeEntry("book-2", "book", "算法导论", "Thomas", "计算机-后端")
    ]);
    expect(getUnarchivedBookCount(entries, archives)).toBe(1);
  });

  it("keeps the active archive visible when archive chips are collapsed", () => {
    const archives = Array.from({ length: 11 }, (_, index) =>
      makeArchive(`archive-${index + 1}`, `书单${index + 1}`, [`book-${index + 1}`], 1, 0)
    );

    const visible = getVisibleArchiveOptions(archives, "archive-11", false);

    expect(visible).toHaveLength(10);
    expect(visible.map((archive) => archive.id)).toContain("archive-11");
    expect(visible.map((archive) => archive.id)).not.toContain("archive-10");
  });

  it("normalizes parent categories from nested labels", () => {
    expect(getParentCategory("  计算机-前端  ")).toBe("计算机");
    expect(getParentCategory("文学")).toBe("文学");
    expect(getParentCategory("   ")).toBeUndefined();
  });
});

describe("bookshelf page structure", () => {
  it("renders separate type and category sections for mixed shelf data", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf([
            makeEntry("book-1", "book", "三体", "刘慈欣", "计算机-前端"),
            makeEntry("book-2", "book", "算法导论", "Thomas", "计算机-后端"),
            makeEntry("album-1", "album", "夜航西飞", "播音", "文学-经典")
          ])}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain('aria-label="书架类型筛选"');
    expect(markup).toContain('aria-label="书架分类筛选"');
    expect(markup).toContain("类型");
    expect(markup).toContain("分类");
    expect(markup).toContain("电子书");
    expect(markup).toContain("有声书");
  });

  it("keeps the category expansion control after the visible category chips", () => {
    const entries = Array.from({ length: 15 }, (_, index) =>
      makeEntry(`book-${index + 1}`, "book", `书籍${index + 1}`, "作者", `分类${index + 1}`)
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf(entries)}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup.indexOf("展开更多 3")).toBeGreaterThan(markup.indexOf("分类12"));
  });

  it("hides the category section for mp-only shelves", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf([
            makeEntry("mp-1", "mp", "公众号文章", "作者甲", "科技-前沿")
          ])}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("文章收藏");
    expect(markup).not.toContain('aria-label="书架分类筛选"');
  });

  it("renders WeRead archive filters inside the shelf page", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf(
            [
              makeEntry("book-1", "book", "三体", "刘慈欣", "计算机-前端"),
              makeEntry("book-2", "book", "算法导论", "Thomas", "计算机-后端")
            ],
            [
              makeArchive("archive-1", "技术栈", ["book-1"], 1, 0),
              makeArchive("archive-2", "待读书单", ["missing"], 0, 1)
            ]
          )}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("微信书单");
    expect(markup).toContain('aria-label="微信书单筛选"');
    expect(markup).toContain("技术栈");
    expect(markup).toContain("待读书单");
    expect(markup).toContain("未归入书单");
  });

  it("limits long shelves to the first visible batch", () => {
    const entries = Array.from({ length: 130 }, (_, index) =>
      makeEntry(`book-${index + 1}`, "book", `长列表书籍${index + 1}`, "作者", "文学")
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf(entries)}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("已显示 96 / 共 130 条");
    expect(markup).toContain("继续显示 34 条");
    expect(markup).toContain("长列表书籍96");
    expect(markup).not.toContain("长列表书籍97");
  });

  it("renders short shelves without the load more control", () => {
    const entries = Array.from({ length: 120 }, (_, index) =>
      makeEntry(`book-${index + 1}`, "book", `短列表书籍${index + 1}`, "作者", "文学")
    );

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <BookshelfPage
          credentialStatus={{ hasCredential: true }}
          bookshelf={buildBookshelf(entries)}
          isLoading={false}
          isSyncing={false}
          onSync={() => undefined}
          onOpenSettings={() => undefined}
          onOpenDetail={() => undefined}
          onSearchInDiscovery={() => undefined}
        />
      </ToastProvider>
    );

    expect(markup).toContain("共 120 条");
    expect(markup).toContain("短列表书籍120");
    expect(markup).not.toContain("加载更多");
    expect(markup).not.toContain("已显示");
  });
});

function buildBookshelf(entries: ShelfEntry[], archives: ShelfArchive[] = []): BookshelfResponse {
  return {
    snapshot: {
      entries,
      archives,
      summary: {
        totalVisibleEntries: entries.length,
        bookCount: entries.filter((entry) => entry.type === "book").length,
        albumCount: entries.filter((entry) => entry.type === "album").length,
        mpCount: entries.filter((entry) => entry.type === "mp").length as 0 | 1,
        publicCount: entries.filter((entry) => !entry.isSecret).length,
        secretCount: entries.filter((entry) => entry.isSecret).length
      }
    }
  };
}

function makeArchive(
  id: string,
  name: string,
  bookIds: string[],
  matchedEntryCount = bookIds.length,
  missingBookCount = 0
): ShelfArchive {
  return {
    id,
    name,
    bookIds,
    matchedEntryCount,
    missingBookCount
  };
}

function makeEntry(
  id: string,
  type: ShelfEntry["type"],
  title: string,
  author: string,
  category?: string
): ShelfEntry {
  return {
    id,
    type,
    title,
    author,
    category,
    isTop: false,
    isSecret: false
  };
}
