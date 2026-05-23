import type {
  BookshelfSummary,
  ReadingCategory,
  ReadingRankItem,
  ReadingStats,
  SearchScope,
  ShelfEntry
} from "./types";

export type RawShelfCounts = {
  books?: unknown[];
  albums?: unknown[];
  mp?: unknown | null;
};

export type RawShelfPrivacyEntry = {
  secret?: number | boolean;
};

export type RawAlbumPrivacyEntry = {
  albumInfoExtra?: {
    secret?: number | boolean;
  };
};

export type RawShelfPrivacy = {
  books?: RawShelfPrivacyEntry[];
  albums?: RawAlbumPrivacyEntry[];
  mp?: unknown | null;
};

export type NoteCountInput = {
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
};

export type ReadingProgressInput = {
  progress?: number;
  finishTime?: number;
  isStartReading?: boolean | number;
};

export type ReadingHabitProfileLabel =
  | "深潜型"
  | "广谱型"
  | "实用型"
  | "故事型"
  | "收藏型"
  | "复盘型";

export type ReadingHabitProfile = {
  primaryLabel: ReadingHabitProfileLabel;
  secondaryLabels: ReadingHabitProfileLabel[];
  description: string;
  evidence: string[];
  basisNotice: string;
};

export function calculateBookshelfTotal({ books, albums, mp }: RawShelfCounts): number {
  return (books?.length ?? 0) + (albums?.length ?? 0) + (mp ? 1 : 0);
}

export function summarizeBookshelf(entries: ShelfEntry[]): BookshelfSummary {
  const bookCount = entries.filter((entry) => entry.type === "book").length;
  const albumCount = entries.filter((entry) => entry.type === "album").length;
  const mpCount = entries.some((entry) => entry.type === "mp") ? 1 : 0;
  const secretCount = entries.filter((entry) => entry.isSecret).length;

  return {
    totalVisibleEntries: bookCount + albumCount + mpCount,
    bookCount,
    albumCount,
    mpCount,
    publicCount: entries.length - secretCount,
    secretCount
  };
}

export function calculateShelfPrivacy({ books, albums, mp }: RawShelfPrivacy) {
  const secretBooks = books?.filter((book) => isSecret(book.secret)).length ?? 0;
  const publicBooks = (books?.length ?? 0) - secretBooks;
  const secretAlbums =
    albums?.filter((album) => isSecret(album.albumInfoExtra?.secret)).length ?? 0;
  const publicAlbums = (albums?.length ?? 0) - secretAlbums;
  const mpSecret = mp ? 1 : 0;

  return {
    publicCount: publicBooks + publicAlbums,
    secretCount: secretBooks + secretAlbums + mpSecret
  };
}

export function calculateTotalNotes({
  reviewCount = 0,
  noteCount = 0,
  bookmarkCount = 0
}: NoteCountInput): number {
  return safeCount(reviewCount) + safeCount(noteCount) + safeCount(bookmarkCount);
}

export function normalizeProgress({ progress = 0, finishTime, isStartReading }: ReadingProgressInput) {
  const progressPercent = Math.max(0, Math.min(100, Math.trunc(progress)));

  return {
    progressPercent,
    isStarted: Boolean(isStartReading) || progressPercent > 0,
    isFinished: progressPercent === 100 && Boolean(finishTime)
  };
}

export function chooseSearchScope(input: string): SearchScope {
  const text = input.trim();

  if (/(听书|有声书|播客|专辑)/.test(text)) {
    return 14;
  }

  if (/(网文|网络小说)/.test(text)) {
    return 16;
  }

  if (/(作者|作家)/.test(text)) {
    return 6;
  }

  if (/(全文|书里|正文|提到)/.test(text)) {
    return 12;
  }

  if (/(书单|推荐书单)/.test(text)) {
    return 13;
  }

  if (/公众号/.test(text)) {
    return 2;
  }

  if (/文章/.test(text)) {
    return 4;
  }

  if (/(搜书|找书|查书|查.*书|bookId)/i.test(text)) {
    return 10;
  }

  return 0;
}

export function appendRecentSearchKeyword(
  current: string[],
  keyword: string,
  limit = 6
): string[] {
  const normalized = keyword.trim();
  if (!normalized) {
    return current;
  }

  const deduped = current.filter((item) => item !== normalized);
  return [normalized, ...deduped].slice(0, limit);
}

export function extractRepresentativeThemes(stats?: ReadingStats, limit = 5): string[] {
  if (!stats) {
    return [];
  }

  const themes: string[] = [];
  const pushTheme = (value?: string) => {
    const normalized = value?.trim();
    if (!normalized || themes.includes(normalized)) {
      return;
    }

    themes.push(normalized);
  };

  stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))
    .forEach((category) => {
      pushTheme(category.title);
      if (themes.length >= limit) {
        return;
      }

      pushTheme(category.parentTitle);
    });

  stats.longestItems.forEach((item) => {
    item.tags?.forEach((tag) => pushTheme(tag));
  });

  return themes.slice(0, limit);
}

export function hasEnoughDataForHabitProfile(stats?: ReadingStats): boolean {
  if (!stats) {
    return false;
  }

  const totalReadTimeSeconds = stats.totalReadTimeSeconds ?? 0;
  const readDays = stats.readDays ?? 0;
  const activeBuckets = stats.buckets.filter((bucket) => bucket.readTimeSeconds > 0).length;

  return (
    totalReadTimeSeconds >= 1_800 ||
    readDays >= 3 ||
    activeBuckets >= 3 ||
    stats.longestItems.length >= 2 ||
    stats.categories.length >= 2
  );
}

export function buildReadingHabitProfile(stats?: ReadingStats): ReadingHabitProfile | undefined {
  if (!stats || !hasEnoughDataForHabitProfile(stats)) {
    return undefined;
  }

  const totalReadTimeSeconds = stats.totalReadTimeSeconds ?? 0;
  const readDays = stats.readDays ?? 0;
  const averageReadTimeSeconds =
    stats.dayAverageReadTimeSeconds ??
    (readDays > 0 ? Math.round(totalReadTimeSeconds / Math.max(readDays, 1)) : 0);
  const topCategory = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];
  const topCategoryShare = topCategory
    ? safeRatio(categoryValue(topCategory), stats.categories.reduce((sum, item) => sum + categoryValue(item), 0))
    : 0;
  const topItem = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)[0];
  const topItemShare = topItem
    ? safeRatio(
        topItem.readTimeSeconds,
        stats.longestItems.reduce((sum, item) => sum + Math.max(item.readTimeSeconds, 0), 0)
      )
    : 0;
  const activeBuckets = stats.buckets.filter((bucket) => bucket.readTimeSeconds > 0).length;
  const contentLabel = detectContentLabel(topCategory, topItem);
  const structuralLabel = detectStructuralLabel({
    readDays,
    averageReadTimeSeconds,
    categoryCount: stats.categories.length,
    activeBuckets,
    topCategoryShare,
    topItemShare,
    totalReadTimeSeconds,
    compare: stats.compare ?? 0,
    longestItemCount: stats.longestItems.length
  });
  const primaryLabel = contentLabel ?? structuralLabel;
  const secondaryLabels = uniqueLabels(
    [contentLabel, structuralLabel].filter(
      (label): label is ReadingHabitProfileLabel => Boolean(label && label !== primaryLabel)
    )
  );

  return {
    primaryLabel,
    secondaryLabels,
    description: descriptionForProfile(primaryLabel, topCategory?.title),
    evidence: buildProfileEvidence({
      primaryLabel,
      readDays,
      averageReadTimeSeconds,
      topCategory,
      topCategoryShare,
      topItem,
      topItemShare,
      compare: stats.compare ?? 0,
      themeCount: stats.categories.length
    }),
    basisNotice: "只基于本地统计做当前周期侧写，不代表固定阅读人格。"
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function isSecret(value?: number | boolean): boolean {
  return value === true || value === 1;
}

function categoryValue(category: ReadingCategory): number {
  return Math.max(0, category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0);
}

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return value / total;
}

function detectContentLabel(
  topCategory?: ReadingCategory,
  topItem?: ReadingRankItem
): ReadingHabitProfileLabel | undefined {
  const contentTokens = [
    topCategory?.title,
    topCategory?.parentTitle,
    topItem?.title,
    ...(topItem?.tags ?? [])
  ]
    .filter((item): item is string => Boolean(item))
    .join("|");

  if (/(效率|管理|成长|商业|心理|方法|投资|写作|学习|沟通|产品|运营|思维)/.test(contentTokens)) {
    return "实用型";
  }

  if (/(科幻|小说|文学|悬疑|推理|历史|传记|故事|奇幻)/.test(contentTokens)) {
    return "故事型";
  }

  return undefined;
}

function detectStructuralLabel({
  readDays,
  averageReadTimeSeconds,
  categoryCount,
  activeBuckets,
  topCategoryShare,
  topItemShare,
  totalReadTimeSeconds,
  compare,
  longestItemCount
}: {
  readDays: number;
  averageReadTimeSeconds: number;
  categoryCount: number;
  activeBuckets: number;
  topCategoryShare: number;
  topItemShare: number;
  totalReadTimeSeconds: number;
  compare: number;
  longestItemCount: number;
}): ReadingHabitProfileLabel {
  if (
    totalReadTimeSeconds > 0 &&
    readDays <= 2 &&
    averageReadTimeSeconds < 1_500 &&
    (categoryCount >= 2 || longestItemCount >= 2)
  ) {
    return "收藏型";
  }

  if (readDays >= 10 && activeBuckets >= 3 && averageReadTimeSeconds >= 1_200 && compare >= -0.05) {
    return "复盘型";
  }

  if (
    topItemShare >= 0.48 ||
    (categoryCount <= 2 && averageReadTimeSeconds >= 1_500) ||
    topCategoryShare >= 0.58
  ) {
    return "深潜型";
  }

  if (categoryCount >= 4 || (categoryCount >= 3 && topCategoryShare <= 0.4)) {
    return "广谱型";
  }

  return activeBuckets >= 4 ? "广谱型" : "深潜型";
}

function descriptionForProfile(
  label: ReadingHabitProfileLabel,
  topCategoryTitle?: string
): string {
  switch (label) {
    case "深潜型":
      return "阅读时间更像集中压到少数主题或少数重点书上，追求连续深入而不是平均铺开。";
    case "广谱型":
      return "阅读分布更像在多个主题之间横向展开，适合用发现页继续扩展新方向。";
    case "实用型":
      return `当前投入更偏向${topCategoryTitle || "可落地主题"}，阅读目标接近“读完就能用”。`;
    case "故事型":
      return `当前更偏向${topCategoryTitle || "叙事内容"}，阅读动力主要来自情节、世界观或人物线。`;
    case "收藏型":
      return "这段时间更像在建立候选池和轻量试读，适合先缩小主题再决定重点投入。";
    case "复盘型":
      return "阅读节奏相对稳定，已经具备把输入转成阶段复盘和下一步行动的基础。";
    default:
      return "当前周期的阅读特征已经形成可解释的侧写。";
  }
}

function buildProfileEvidence({
  primaryLabel,
  readDays,
  averageReadTimeSeconds,
  topCategory,
  topCategoryShare,
  topItem,
  topItemShare,
  compare,
  themeCount
}: {
  primaryLabel: ReadingHabitProfileLabel;
  readDays: number;
  averageReadTimeSeconds: number;
  topCategory?: ReadingCategory;
  topCategoryShare: number;
  topItem?: ReadingRankItem;
  topItemShare: number;
  compare: number;
  themeCount: number;
}): string[] {
  const evidence = [
    readDays > 0 ? `本周期活跃阅读 ${readDays} 天，单日平均约 ${Math.max(1, Math.round(averageReadTimeSeconds / 60))} 分钟。` : undefined,
    topCategory
      ? `${topCategory.title} 是当前最重投入的主题，约占分类投入的 ${Math.max(1, Math.round(topCategoryShare * 100))}%。`
      : undefined,
    topItem
      ? `《${topItem.title}》占重点内容时长约 ${Math.max(1, Math.round(topItemShare * 100))}%，说明注意力集中在少数主线。`
      : undefined,
    themeCount > 0 ? `当前周期至少覆盖 ${themeCount} 个主题，结构上更容易判断是聚焦还是扩散。` : undefined,
    compare !== 0
      ? `和上一周期相比，整体节奏${compare > 0 ? "抬升" : "回落"}约 ${Math.max(1, Math.round(Math.abs(compare) * 100))}%。`
      : undefined
  ].filter((item): item is string => Boolean(item));

  if (primaryLabel === "收藏型") {
    return evidence.slice(0, 3);
  }

  return evidence.slice(0, 4);
}

function uniqueLabels(labels: ReadingHabitProfileLabel[]): ReadingHabitProfileLabel[] {
  return labels.filter((label, index) => labels.indexOf(label) === index);
}
