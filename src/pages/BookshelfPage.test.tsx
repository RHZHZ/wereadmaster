import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../components/ToastProvider";
import type { BookshelfResponse } from "../lib/reading-api";
import type { ShelfEntry } from "../lib/types";
import { BookshelfPage } from "./BookshelfPage";
import {
  filterEntries,
  getCategoryEntries,
  getCategoryOptions,
  getParentCategory,
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
});

function buildBookshelf(entries: ShelfEntry[]): BookshelfResponse {
  return {
    snapshot: {
      entries,
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
