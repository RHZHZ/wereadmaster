import type { ShelfEntry, ShelfEntryType } from "../lib/types";

export type ShelfFilter = "all" | ShelfEntryType;

export type CategoryOption = {
  label: string;
  count: number;
};

export const filterLabels: Record<ShelfFilter, string> = {
  all: "全部",
  book: "电子书",
  album: "有声书",
  mp: "文章收藏"
};

export const CATEGORY_PREVIEW_LIMIT = 12;

export function filterEntries(
  entries: ShelfEntry[],
  filter: ShelfFilter,
  categoryFilter: string,
  query: string
): ShelfEntry[] {
  const keyword = query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filter !== "all" && entry.type !== filter) {
      return false;
    }

    if (categoryFilter !== "all" && getParentCategory(entry.category) !== categoryFilter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const title = entry.title.toLowerCase();
    const author = entry.author?.toLowerCase() ?? "";
    const category = entry.category?.toLowerCase() ?? "";

    return title.includes(keyword) || author.includes(keyword) || category.includes(keyword);
  });
}

export function getCategoryEntries(entries: ShelfEntry[], filter: ShelfFilter): ShelfEntry[] {
  return entries.filter((entry) => entry.type !== "mp" && (filter === "all" || entry.type === filter));
}

export function getCategoryOptions(entries: ShelfEntry[]): CategoryOption[] {
  const counts = new Map<string, { count: number; index: number }>();

  entries.forEach((entry) => {
    const category = getParentCategory(entry.category);
    if (!category) {
      return;
    }

    const current = counts.get(category);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(category, { count: 1, index: counts.size });
  });

  return Array.from(counts, ([label, value]) => ({ label, count: value.count, index: value.index }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ label, count }) => ({ label, count }));
}

export function getVisibleCategoryOptions(
  options: CategoryOption[],
  activeCategory: string,
  isExpanded: boolean
): CategoryOption[] {
  if (isExpanded || options.length <= CATEGORY_PREVIEW_LIMIT) {
    return options;
  }

  const preview = options.slice(0, CATEGORY_PREVIEW_LIMIT);
  if (activeCategory === "all" || preview.some((category) => category.label === activeCategory)) {
    return preview;
  }

  const activeOption = options.find((category) => category.label === activeCategory);
  return activeOption ? [...preview.slice(0, CATEGORY_PREVIEW_LIMIT - 1), activeOption] : preview;
}

export function getParentCategory(category?: string): string | undefined {
  const normalized = category?.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.split("-")[0]?.trim() || normalized;
}
