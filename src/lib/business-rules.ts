import type {
  BookshelfSummary,
  ReadingCategory,
  ReadingPersona,
  ReadingPersonaAccentTone,
  ReadingPersonaDimension,
  ReadingPersonaKey,
  ReadingPersonaPaletteGroup,
  ReadingPersonaPatch,
  ReadingRankItem,
  ReadingStats,
  SearchScope,
  ShelfEntry,
} from "./types";
import readingPersonaConfigJson from "../reading-persona.config.json";

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

export function calculateBookshelfTotal({
  books,
  albums,
  mp,
}: RawShelfCounts): number {
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
    secretCount,
  };
}

export function calculateShelfPrivacy({ books, albums, mp }: RawShelfPrivacy) {
  const secretBooks =
    books?.filter((book) => isSecret(book.secret)).length ?? 0;
  const publicBooks = (books?.length ?? 0) - secretBooks;
  const secretAlbums =
    albums?.filter((album) => isSecret(album.albumInfoExtra?.secret)).length ??
    0;
  const publicAlbums = (albums?.length ?? 0) - secretAlbums;
  const mpSecret = mp ? 1 : 0;

  return {
    publicCount: publicBooks + publicAlbums,
    secretCount: secretBooks + secretAlbums + mpSecret,
  };
}

export function calculateTotalNotes({
  reviewCount = 0,
  noteCount = 0,
  bookmarkCount = 0,
}: NoteCountInput): number {
  return (
    safeCount(reviewCount) + safeCount(noteCount) + safeCount(bookmarkCount)
  );
}

export function normalizeProgress({
  progress = 0,
  finishTime,
  isStartReading,
}: ReadingProgressInput) {
  const progressPercent = Math.max(0, Math.min(100, Math.trunc(progress)));

  return {
    progressPercent,
    isStarted: Boolean(isStartReading) || progressPercent > 0,
    isFinished: progressPercent === 100 && Boolean(finishTime),
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
  limit = 6,
): string[] {
  const normalized = keyword.trim();
  if (!normalized) {
    return current;
  }

  const deduped = current.filter((item) => item !== normalized);
  return [normalized, ...deduped].slice(0, limit);
}

export function extractRepresentativeThemes(
  stats?: ReadingStats,
  limit = 5,
): string[] {
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
  const activeBuckets = stats.buckets.filter(
    (bucket) => bucket.readTimeSeconds > 0,
  ).length;

  return (
    totalReadTimeSeconds >= 1_800 ||
    readDays >= 3 ||
    activeBuckets >= 3 ||
    stats.longestItems.length >= 2 ||
    stats.categories.length >= 2
  );
}

export function buildReadingHabitProfile(
  stats?: ReadingStats,
): ReadingHabitProfile | undefined {
  if (!stats || !hasEnoughDataForHabitProfile(stats)) {
    return undefined;
  }

  const totalReadTimeSeconds = stats.totalReadTimeSeconds ?? 0;
  const readDays = stats.readDays ?? 0;
  const averageReadTimeSeconds =
    stats.dayAverageReadTimeSeconds ??
    (readDays > 0
      ? Math.round(totalReadTimeSeconds / Math.max(readDays, 1))
      : 0);
  const topCategory = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left))[0];
  const topCategoryShare = topCategory
    ? safeRatio(
        categoryValue(topCategory),
        stats.categories.reduce((sum, item) => sum + categoryValue(item), 0),
      )
    : 0;
  const topItem = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)[0];
  const topItemShare = topItem
    ? safeRatio(
        topItem.readTimeSeconds,
        stats.longestItems.reduce(
          (sum, item) => sum + Math.max(item.readTimeSeconds, 0),
          0,
        ),
      )
    : 0;
  const activeBuckets = stats.buckets.filter(
    (bucket) => bucket.readTimeSeconds > 0,
  ).length;
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
    longestItemCount: stats.longestItems.length,
  });
  const primaryLabel = contentLabel ?? structuralLabel;
  const secondaryLabels = uniqueLabels(
    [contentLabel, structuralLabel].filter(
      (label): label is ReadingHabitProfileLabel =>
        Boolean(label && label !== primaryLabel),
    ),
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
      themeCount: stats.categories.length,
    }),
    basisNotice: "只基于本地统计做当前周期侧写，不代表固定阅读人格。",
  };
}

type ReadingPersonaSharedConfig = {
  basisNotice: string;
  fallbackLabel: string;
  definitions: Record<
    string,
    {
      label: string;
      paletteGroup: ReadingPersonaPaletteGroup;
      accentTone: ReadingPersonaAccentTone;
    }
  >;
  categoryTokens: {
    practical: string[];
    conceptual: string[];
    analytical: string[];
    resonant: string[];
  };
  thresholds: {
    stableBucketMultiplier: number;
    axisBiasMultiplier: number;
    status: {
      complete: {
        minTotalReadTimeSeconds: number;
        minReadDays: number;
        minActiveBucketCount: number;
        minCategoryCount: number;
      };
      provisional: {
        minTotalReadTimeSeconds: number;
        minReadDays: number;
        minStableDimensionCount: number;
      };
    };
    energy: {
      introverted: {
        minTop3CategoryShare: number;
        minAuthorConcentration: number;
        minTopItemShare: number;
      };
      breadthStrength: {
        strong: {
          maxTop3CategoryShare: number;
          maxAuthorConcentration: number;
          maxTopItemShare: number;
        };
        medium: {
          maxTop3CategoryShare: number;
          maxTopItemShare: number;
        };
      };
    };
    lifestyle: {
      planned: {
        minReadDays: number;
        minStableBucketShare: number;
        minTopItemShare: number;
        minCompare: number;
      };
      exploratory: {
        maxReadDays: number;
        maxActiveBucketCount: number;
      };
      judgingStrength: {
        readDaysScale: number;
      };
      perceivingStrength: {
        strong: {
          maxReadDays: number;
          maxActiveBucketCount: number;
        };
        medium: {
          maxReadDays: number;
          maxActiveBucketCount: number;
        };
      };
    };
    strength: {
      ratio: {
        strong: number;
        medium: number;
      };
      delta: {
        strong: number;
        medium: number;
      };
      confidence: {
        strong: number;
        medium: number;
        light: number;
      };
    };
    evidence: {
      provisionalMaxItems: number;
      defaultMaxItems: number;
    };
    suggestion: {
      introvertedMinTopCategoryShare: number;
    };
  };
};

const READING_PERSONA_CONFIG =
  readingPersonaConfigJson as ReadingPersonaSharedConfig;
const READING_PERSONA_BASIS_NOTICE = READING_PERSONA_CONFIG.basisNotice;
const READING_PERSONA_THRESHOLDS = READING_PERSONA_CONFIG.thresholds;

const READING_PERSONA_DEFINITIONS: Record<
  string,
  {
    label: string;
    paletteGroup: ReadingPersonaPaletteGroup;
    accentTone: ReadingPersonaAccentTone;
  }
> = READING_PERSONA_CONFIG.definitions;

const PRACTICAL_CATEGORY_PATTERN = buildCategoryPattern(
  READING_PERSONA_CONFIG.categoryTokens.practical,
);
const CONCEPTUAL_CATEGORY_PATTERN = buildCategoryPattern(
  READING_PERSONA_CONFIG.categoryTokens.conceptual,
);
const ANALYTICAL_CATEGORY_PATTERN = buildCategoryPattern(
  READING_PERSONA_CONFIG.categoryTokens.analytical,
);
const RESONANT_CATEGORY_PATTERN = buildCategoryPattern(
  READING_PERSONA_CONFIG.categoryTokens.resonant,
);

type PersonaSignals = {
  totalReadTimeSeconds: number;
  readDays: number;
  categoryCount: number;
  activeBucketCount: number;
  stableBucketShare: number;
  topCategoryTitle?: string;
  topCategoryShare: number;
  top3CategoryShare: number;
  topItemTitle?: string;
  topItemShare: number;
  authorConcentration: number;
  compare: number;
  practicalScore: number;
  conceptualScore: number;
  analyticalScore: number;
  resonantScore: number;
  topSignalsText: string;
};

export function buildReadingPersona(stats?: ReadingStats): ReadingPersona {
  if (!stats) {
    return buildInsufficientPersona();
  }

  const signals = summarizePersonaSignals(stats);
  const dimensions = [
    buildEnergyDimension(signals),
    buildInformationDimension(signals),
    buildDecisionDimension(signals),
    buildLifestyleDimension(signals),
  ];
  const stableDimensionCount = dimensions.filter(
    (item) => item.strength !== "light",
  ).length;
  const status = resolveReadingPersonaStatus(signals, stableDimensionCount);

  if (status === "insufficient") {
    return buildInsufficientPersona();
  }

  const code = dimensions.map((item) => item.key).join("");
  const definition = READING_PERSONA_DEFINITIONS[code] ?? {
    label: READING_PERSONA_CONFIG.fallbackLabel,
    paletteGroup: inferPaletteGroup(code),
    accentTone: accentToneForPaletteGroup(inferPaletteGroup(code)),
  };
  const confidence = buildPersonaConfidence(dimensions, status);
  const evidence = buildPersonaEvidence(signals, dimensions, status);

  return {
    status,
    code,
    label: definition.label,
    displayTitle: `${code} 型读者 · ${definition.label}`,
    paletteGroup: definition.paletteGroup,
    accentTone: definition.accentTone,
    basisNotice: READING_PERSONA_BASIS_NOTICE,
    dimensions,
    evidence,
    confidence,
    summary: buildLocalPersonaSummary(signals, definition.label, status),
    suggestion: buildLocalPersonaSuggestion(signals, dimensions, status),
  };
}

export function resolveReadingPersona(
  localPersona: ReadingPersona,
  patch?: ReadingPersonaPatch | null,
): ReadingPersona {
  if (!patch) {
    return localPersona;
  }

  const summary = normalizePersonaText(patch.summary);
  const suggestion = normalizePersonaText(patch.suggestion);

  if (localPersona.status === "insufficient") {
    return {
      ...localPersona,
      summary,
      suggestion: undefined,
    };
  }

  return {
    ...localPersona,
    summary: summary ?? localPersona.summary,
    suggestion: suggestion ?? localPersona.suggestion,
  };
}

function buildInsufficientPersona(): ReadingPersona {
  return {
    status: "insufficient",
    basisNotice: READING_PERSONA_BASIS_NOTICE,
    dimensions: [],
    evidence: [],
    summary: "本期阅读样本较少，继续阅读后再生成阅读人格。",
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function isSecret(value?: number | boolean): boolean {
  return value === true || value === 1;
}

function categoryValue(category: ReadingCategory): number {
  return Math.max(
    0,
    category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0,
  );
}

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return value / total;
}

function detectContentLabel(
  topCategory?: ReadingCategory,
  topItem?: ReadingRankItem,
): ReadingHabitProfileLabel | undefined {
  const contentTokens = [
    topCategory?.title,
    topCategory?.parentTitle,
    topItem?.title,
    ...(topItem?.tags ?? []),
  ]
    .filter((item): item is string => Boolean(item))
    .join("|");

  if (
    /(效率|管理|成长|商业|心理|方法|投资|写作|学习|沟通|产品|运营|思维)/.test(
      contentTokens,
    )
  ) {
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
  longestItemCount,
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

  if (
    readDays >= 10 &&
    activeBuckets >= 3 &&
    averageReadTimeSeconds >= 1_200 &&
    compare >= -0.05
  ) {
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
  topCategoryTitle?: string,
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
  themeCount,
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
    readDays > 0
      ? `本周期活跃阅读 ${readDays} 天，单日平均约 ${Math.max(1, Math.round(averageReadTimeSeconds / 60))} 分钟。`
      : undefined,
    topCategory
      ? `${topCategory.title} 是当前最重投入的主题，约占分类投入的 ${Math.max(1, Math.round(topCategoryShare * 100))}%。`
      : undefined,
    topItem
      ? `《${topItem.title}》占重点内容时长约 ${Math.max(1, Math.round(topItemShare * 100))}%，说明注意力集中在少数主线。`
      : undefined,
    themeCount > 0
      ? `当前周期至少覆盖 ${themeCount} 个主题，结构上更容易判断是聚焦还是扩散。`
      : undefined,
    compare !== 0
      ? `和上一周期相比，整体节奏${compare > 0 ? "抬升" : "回落"}约 ${Math.max(1, Math.round(Math.abs(compare) * 100))}%。`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  if (primaryLabel === "收藏型") {
    return evidence.slice(0, 3);
  }

  return evidence.slice(0, 4);
}

function uniqueLabels(
  labels: ReadingHabitProfileLabel[],
): ReadingHabitProfileLabel[] {
  return labels.filter((label, index) => labels.indexOf(label) === index);
}

function summarizePersonaSignals(stats: ReadingStats): PersonaSignals {
  const totalReadTimeSeconds = Math.max(0, stats.totalReadTimeSeconds ?? 0);
  const readDays = Math.max(0, stats.readDays ?? 0);
  const activeBuckets = stats.buckets.filter(
    (bucket) => (bucket.readTimeSeconds ?? 0) > 0,
  );
  const activeBucketCount = activeBuckets.length;
  const bucketAverage =
    activeBucketCount > 0
      ? activeBuckets.reduce(
          (sum, bucket) => sum + Math.max(bucket.readTimeSeconds ?? 0, 0),
          0,
        ) / activeBucketCount
      : 0;
  const stableBucketCount = activeBuckets.filter(
    (bucket) =>
      Math.max(bucket.readTimeSeconds ?? 0, 0) >=
      bucketAverage * READING_PERSONA_THRESHOLDS.stableBucketMultiplier,
  ).length;
  const stableBucketShare = safeRatio(stableBucketCount, activeBucketCount);

  const categories = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left));
  const categoryTotal = categories.reduce(
    (sum, item) => sum + categoryValue(item),
    0,
  );
  const topCategory = categories[0];
  const topCategoryShare = topCategory
    ? safeRatio(categoryValue(topCategory), categoryTotal)
    : 0;
  const top3CategoryShare =
    categoryTotal > 0
      ? safeRatio(
          categories
            .slice(0, 3)
            .reduce((sum, item) => sum + categoryValue(item), 0),
          categoryTotal,
        )
      : 0;

  const items = stats.longestItems
    .slice()
    .sort(
      (left, right) =>
        Math.max(right.readTimeSeconds, 0) - Math.max(left.readTimeSeconds, 0),
    );
  const itemTotal = items.reduce(
    (sum, item) => sum + Math.max(item.readTimeSeconds, 0),
    0,
  );
  const topItem = items[0];
  const topItemShare = topItem
    ? safeRatio(Math.max(topItem.readTimeSeconds, 0), itemTotal)
    : 0;
  const authorMap = new Map<string, number>();
  items.forEach((item) => {
    const author = item.author?.trim();
    if (!author) {
      return;
    }

    authorMap.set(
      author,
      (authorMap.get(author) ?? 0) + Math.max(item.readTimeSeconds, 0),
    );
  });
  const authorConcentration =
    itemTotal > 0 && authorMap.size > 0
      ? safeRatio(Math.max(...Array.from(authorMap.values())), itemTotal)
      : 0;

  const practicalScore = sumCategorySignalScore(
    stats.categories,
    PRACTICAL_CATEGORY_PATTERN,
  );
  const conceptualScore = sumCategorySignalScore(
    stats.categories,
    CONCEPTUAL_CATEGORY_PATTERN,
  );
  const analyticalScore = sumCategorySignalScore(
    stats.categories,
    ANALYTICAL_CATEGORY_PATTERN,
  );
  const resonantScore = sumCategorySignalScore(
    stats.categories,
    RESONANT_CATEGORY_PATTERN,
  );
  const topSignalsText = [
    topCategory?.title,
    topCategory?.parentTitle,
    topItem?.title,
    ...(topItem?.tags ?? []),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("|");

  return {
    totalReadTimeSeconds,
    readDays,
    categoryCount: stats.categories.length,
    activeBucketCount,
    stableBucketShare,
    topCategoryTitle: topCategory?.title,
    topCategoryShare,
    top3CategoryShare,
    topItemTitle: topItem?.title,
    topItemShare,
    authorConcentration,
    compare: stats.compare ?? 0,
    practicalScore,
    conceptualScore,
    analyticalScore,
    resonantScore,
    topSignalsText,
  };
}

function resolveReadingPersonaStatus(
  signals: PersonaSignals,
  stableDimensionCount: number,
): ReadingPersona["status"] {
  const { complete, provisional } = READING_PERSONA_THRESHOLDS.status;

  if (
    signals.totalReadTimeSeconds >= complete.minTotalReadTimeSeconds &&
    signals.readDays >= complete.minReadDays &&
    signals.activeBucketCount >= complete.minActiveBucketCount &&
    signals.categoryCount >= complete.minCategoryCount
  ) {
    return "complete";
  }

  if (
    signals.totalReadTimeSeconds >= provisional.minTotalReadTimeSeconds &&
    signals.readDays >= provisional.minReadDays &&
    stableDimensionCount >= provisional.minStableDimensionCount
  ) {
    return "provisional";
  }

  return "insufficient";
}

function buildEnergyDimension(
  signals: PersonaSignals,
): ReadingPersonaDimension {
  const { introverted } = READING_PERSONA_THRESHOLDS.energy;
  const isIntroverted =
    signals.top3CategoryShare >= introverted.minTop3CategoryShare ||
    signals.authorConcentration >= introverted.minAuthorConcentration ||
    signals.topItemShare >= introverted.minTopItemShare;
  const key: ReadingPersonaKey = isIntroverted ? "I" : "E";
  const strength = isIntroverted
    ? strengthFromThresholdDelta(
        Math.max(
          signals.top3CategoryShare - introverted.minTop3CategoryShare,
          signals.authorConcentration - introverted.minAuthorConcentration,
          signals.topItemShare - introverted.minTopItemShare,
        ),
      )
    : strengthFromBreadthSignals(signals);

  return {
    axis: "energy",
    key,
    label: key === "I" ? "主题深度" : "探索广度",
    strength,
    basis:
      key === "I"
        ? `投入主要集中在${signals.topCategoryTitle || "少数主题"}与重点书目上，阅读更像围绕主线持续推进。`
        : "主题分布更分散，阅读更像在多个方向之间主动探索和横向扩展。",
  };
}

function buildInformationDimension(
  signals: PersonaSignals,
): ReadingPersonaDimension {
  const axisBiasMultiplier = READING_PERSONA_THRESHOLDS.axisBiasMultiplier;
  const conceptualWins =
    signals.conceptualScore >= signals.practicalScore * axisBiasMultiplier;
  const practicalWins =
    signals.practicalScore >= signals.conceptualScore * axisBiasMultiplier;
  const key = conceptualWins
    ? "N"
    : practicalWins
      ? "S"
      : resolveTextBias(
          signals.topSignalsText,
          CONCEPTUAL_CATEGORY_PATTERN,
          PRACTICAL_CATEGORY_PATTERN,
          "N",
          "S",
        );
  const strength = strengthFromRatio(
    signals.conceptualScore,
    signals.practicalScore,
  );

  return {
    axis: "information",
    key,
    label: key === "N" ? "概念想象" : "实用经验",
    strength,
    basis:
      key === "N"
        ? `这段时间更偏向${signals.topCategoryTitle || "历史、文学或思想性内容"}，阅读重点更接近理解主题与建立联想。`
        : `这段时间更偏向${signals.topCategoryTitle || "工具、管理或方法类内容"}，阅读重点更接近获取可直接使用的方法。`,
  };
}

function buildDecisionDimension(
  signals: PersonaSignals,
): ReadingPersonaDimension {
  const axisBiasMultiplier = READING_PERSONA_THRESHOLDS.axisBiasMultiplier;
  const analyticalWins =
    signals.analyticalScore >= signals.resonantScore * axisBiasMultiplier;
  const resonantWins =
    signals.resonantScore >= signals.analyticalScore * axisBiasMultiplier;
  const key = analyticalWins
    ? "T"
    : resonantWins
      ? "F"
      : resolveTextBias(
          signals.topSignalsText,
          ANALYTICAL_CATEGORY_PATTERN,
          RESONANT_CATEGORY_PATTERN,
          "T",
          "F",
        );
  const strength = strengthFromRatio(
    signals.analyticalScore,
    signals.resonantScore,
  );

  return {
    axis: "decision",
    key,
    label: key === "T" ? "分析取向" : "共鸣取向",
    strength,
    basis:
      key === "T"
        ? "当前更容易被结构、方法和判断框架吸引，阅读时更关注可拆解、可比较的分析线索。"
        : "当前更容易被人物、命运和社会现场吸引，阅读时更关注情绪、关系与经验共鸣。",
  };
}

function buildLifestyleDimension(
  signals: PersonaSignals,
): ReadingPersonaDimension {
  const { planned, exploratory, judgingStrength, perceivingStrength } =
    READING_PERSONA_THRESHOLDS.lifestyle;
  const isPlanned =
    (signals.readDays >= planned.minReadDays &&
      signals.stableBucketShare >= planned.minStableBucketShare) ||
    (signals.topItemShare >= planned.minTopItemShare &&
      signals.compare >= planned.minCompare);
  const clearlyExploratory =
    signals.readDays <= exploratory.maxReadDays ||
    signals.activeBucketCount <= exploratory.maxActiveBucketCount;
  const key: ReadingPersonaKey = clearlyExploratory
    ? "P"
    : isPlanned
      ? "J"
      : "P";
  const strength =
    key === "J"
      ? strengthFromThresholdDelta(
          Math.max(
            signals.stableBucketShare - planned.minStableBucketShare,
            (signals.readDays - planned.minReadDays) /
              judgingStrength.readDaysScale,
          ),
        )
      : signals.readDays <= perceivingStrength.strong.maxReadDays ||
          signals.activeBucketCount <=
            perceivingStrength.strong.maxActiveBucketCount
        ? "strong"
        : signals.readDays <= perceivingStrength.medium.maxReadDays ||
            signals.activeBucketCount <=
              perceivingStrength.medium.maxActiveBucketCount
          ? "medium"
          : "light";

  return {
    axis: "lifestyle",
    key,
    label: key === "J" ? "稳定推进" : "即兴探索",
    strength,
    basis:
      key === "J"
        ? "阅读天数和高活跃分桶更稳定，说明这段时间已经形成相对固定的推进节奏。"
        : "阅读更像阶段性集中或临时切换，说明这一周期更接近按兴趣和时间窗口灵活推进。",
  };
}

function buildPersonaEvidence(
  signals: PersonaSignals,
  dimensions: ReadingPersonaDimension[],
  status: ReadingPersona["status"],
): string[] {
  const evidence = [
    signals.topCategoryTitle
      ? `${signals.topCategoryTitle} 是当前投入最多的主题，约占分类投入的 ${Math.max(
          1,
          Math.round(signals.topCategoryShare * 100),
        )}%。`
      : undefined,
    signals.topItemTitle
      ? `《${signals.topItemTitle}》占重点内容时长约 ${Math.max(1, Math.round(signals.topItemShare * 100))}%，说明注意力仍集中在少数主线。`
      : undefined,
    signals.readDays > 0
      ? `本周期活跃阅读 ${signals.readDays} 天，稳定分布的高活跃时间段约占 ${Math.max(
          1,
          Math.round(signals.stableBucketShare * 100),
        )}%。`
      : undefined,
    dimensions[0]?.key === "E"
      ? `Top 3 分类投入约占 ${Math.max(1, Math.round(signals.top3CategoryShare * 100))}%，说明主题分布更分散。`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return evidence.slice(
    0,
    status === "provisional"
      ? READING_PERSONA_THRESHOLDS.evidence.provisionalMaxItems
      : READING_PERSONA_THRESHOLDS.evidence.defaultMaxItems,
  );
}

function buildLocalPersonaSummary(
  signals: PersonaSignals,
  personaLabel: string,
  status: ReadingPersona["status"],
): string {
  if (status === "provisional") {
    return `这段时间的阅读已经出现 ${personaLabel} 的倾向，但样本还不算充分，先把它当作当前阅读状态更合适。`;
  }

  if (signals.topCategoryTitle) {
    return `这一周期的阅读更像围绕${signals.topCategoryTitle}主线持续推进，整体已经形成较稳定的阅读气质。`;
  }

  return `这一周期的阅读已经形成较清晰的 ${personaLabel} 倾向。`;
}

function buildLocalPersonaSuggestion(
  signals: PersonaSignals,
  dimensions: ReadingPersonaDimension[],
  status: ReadingPersona["status"],
): string | undefined {
  if (status === "insufficient") {
    return undefined;
  }

  if (
    dimensions[0]?.key === "I" &&
    signals.topCategoryShare >=
      READING_PERSONA_THRESHOLDS.suggestion.introvertedMinTopCategoryShare
  ) {
    return "下个周期可以补一本文学或社科短书，给当前主线增加一个横向参照。";
  }

  if (dimensions[0]?.key === "E") {
    return "下个周期可以先锁定一条主线连续推进，避免多个方向同时展开后难以沉淀。";
  }

  if (dimensions[3]?.key === "P") {
    return "可以先固定 1 到 2 个阅读时段，再决定本月只重点推进哪一条主线。";
  }

  return "继续保持当前节奏，并在读完重点内容后补一份短复盘，会更容易沉淀出稳定判断。";
}

function buildPersonaConfidence(
  dimensions: ReadingPersonaDimension[],
  status: ReadingPersona["status"],
): number | undefined {
  if (status === "insufficient" || dimensions.length === 0) {
    return undefined;
  }

  const total = dimensions.reduce(
    (sum, item) => sum + confidenceForStrength(item.strength),
    0,
  );
  return Number((total / dimensions.length).toFixed(2));
}

function sumCategorySignalScore(
  categories: ReadingCategory[],
  pattern: RegExp,
): number {
  return categories.reduce((sum, category) => {
    const text = [category.title, category.parentTitle]
      .filter(Boolean)
      .join("|");
    return pattern.test(text) ? sum + categoryValue(category) : sum;
  }, 0);
}

function resolveTextBias(
  text: string,
  leftPattern: RegExp,
  rightPattern: RegExp,
  leftKey: ReadingPersonaKey,
  rightKey: ReadingPersonaKey,
): ReadingPersonaKey {
  if (leftPattern.test(text)) {
    return leftKey;
  }

  if (rightPattern.test(text)) {
    return rightKey;
  }

  return leftKey;
}

function strengthFromRatio(
  left: number,
  right: number,
): ReadingPersonaDimension["strength"] {
  const max = Math.max(left, right);
  const min = Math.min(left, right);
  const ratio = min <= 0 ? (max > 0 ? 2 : 1) : max / min;
  const { ratio: ratioThresholds } = READING_PERSONA_THRESHOLDS.strength;

  if (ratio >= ratioThresholds.strong) {
    return "strong";
  }

  if (ratio >= ratioThresholds.medium) {
    return "medium";
  }

  return "light";
}

function strengthFromThresholdDelta(
  delta: number,
): ReadingPersonaDimension["strength"] {
  const { delta: deltaThresholds } = READING_PERSONA_THRESHOLDS.strength;

  if (delta >= deltaThresholds.strong) {
    return "strong";
  }

  if (delta >= deltaThresholds.medium) {
    return "medium";
  }

  return "light";
}

function strengthFromBreadthSignals(
  signals: PersonaSignals,
): ReadingPersonaDimension["strength"] {
  const { strong, medium } = READING_PERSONA_THRESHOLDS.energy.breadthStrength;

  if (
    signals.top3CategoryShare <= strong.maxTop3CategoryShare &&
    signals.authorConcentration <= strong.maxAuthorConcentration &&
    signals.topItemShare <= strong.maxTopItemShare
  ) {
    return "strong";
  }

  if (
    signals.top3CategoryShare <= medium.maxTop3CategoryShare &&
    signals.topItemShare <= medium.maxTopItemShare
  ) {
    return "medium";
  }

  return "light";
}

function inferPaletteGroup(code: string): ReadingPersonaPaletteGroup {
  if (code.length < 4) {
    return "NT";
  }

  return code[1] === "N"
    ? (`N${code[2]}` as ReadingPersonaPaletteGroup)
    : (`S${code[3]}` as ReadingPersonaPaletteGroup);
}

function accentToneForPaletteGroup(
  group: ReadingPersonaPaletteGroup,
): ReadingPersonaAccentTone {
  switch (group) {
    case "NF":
      return "rose";
    case "SJ":
      return "moss";
    case "SP":
      return "amber";
    default:
      return "bluegreen";
  }
}

function confidenceForStrength(
  strength: ReadingPersonaDimension["strength"],
): number {
  const { confidence } = READING_PERSONA_THRESHOLDS.strength;

  switch (strength) {
    case "strong":
      return confidence.strong;
    case "medium":
      return confidence.medium;
    default:
      return confidence.light;
  }
}

function normalizePersonaText(value?: string): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function buildCategoryPattern(tokens: readonly string[]): RegExp {
  return new RegExp(tokens.map(escapeRegexToken).join("|"));
}

function escapeRegexToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
