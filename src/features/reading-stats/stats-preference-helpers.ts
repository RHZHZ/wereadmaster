import type { PreferenceRankItem } from "../../components/PreferenceRankList";
import { formatDuration } from "../../lib/formatters";
import type { ReadingCategory, ReadingRankItem } from "../../lib/types";

type AuthorPreference = {
  author: string;
  readTimeSeconds: number;
  count: number;
};

export function buildAuthorPreferenceRankItems(items: ReadingRankItem[]): PreferenceRankItem[] {
  const authors = buildAuthorPreferences(items);
  const totalReadTime = authors.reduce((sum, author) => sum + author.readTimeSeconds, 0);
  const maxReadTime = authors[0]?.readTimeSeconds ?? 0;

  return authors.slice(0, 8).map((author) => ({
    key: author.author,
    title: author.author,
    meta: `${author.count} 本`,
    valueText: formatDuration(author.readTimeSeconds),
    shareText: formatPercentLabel(safeRatio(author.readTimeSeconds, totalReadTime)),
    ratio: safeRatio(author.readTimeSeconds, maxReadTime)
  }));
}

export function buildCategoryPreferenceRankItems(
  categories: ReadingCategory[]
): PreferenceRankItem[] {
  const sortedCategories = categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left));
  const totalValue = sortedCategories.reduce((sum, category) => sum + categoryValue(category), 0);
  const maxValue = sortedCategories[0] ? categoryValue(sortedCategories[0]) : 0;

  return sortedCategories.slice(0, 8).map((category) => {
    const value = categoryValue(category);
    const meta =
      category.readingCount !== undefined
        ? `${category.parentTitle ? `${category.parentTitle} · ` : ""}${category.readingCount} 本`
        : category.parentTitle || "分类权重";

    return {
      key: `${category.categoryId ?? category.title}-${category.title}`,
      title: category.title,
      meta,
      valueText:
        category.readingTimeSeconds !== undefined
          ? formatDuration(category.readingTimeSeconds)
          : `${Math.round(value)}`,
      shareText: formatPercentLabel(safeRatio(value, totalValue)),
      ratio: safeRatio(value, maxValue)
    };
  });
}

export function categoryValue(category: ReadingCategory): number {
  return Math.max(0, category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0);
}

function buildAuthorPreferences(items: ReadingRankItem[]): AuthorPreference[] {
  const authorMap = new Map<string, AuthorPreference>();

  for (const item of items) {
    const author = normalizeAuthorName(item.author);
    if (!author) {
      continue;
    }

    const current = authorMap.get(author) ?? { author, readTimeSeconds: 0, count: 0 };
    authorMap.set(author, {
      ...current,
      readTimeSeconds: current.readTimeSeconds + Math.max(0, item.readTimeSeconds),
      count: current.count + 1
    });
  }

  return Array.from(authorMap.values()).sort((left, right) => {
    if (right.readTimeSeconds !== left.readTimeSeconds) {
      return right.readTimeSeconds - left.readTimeSeconds;
    }

    return right.count - left.count;
  });
}

function normalizeAuthorName(author?: string): string | undefined {
  const normalized = author?.trim();
  if (!normalized || normalized === "有声内容" || normalized === "电子书") {
    return undefined;
  }

  return normalized;
}

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return value / total;
}

function formatPercentLabel(value: number): string {
  return `${Math.max(0, Math.round(value * 100))}%`;
}
