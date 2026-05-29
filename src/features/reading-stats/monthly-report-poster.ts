import monthlyReportArchSceneSrc from "../../assets/generated/monthly-report-arch-scene.png";
import {
  buildReadingPersona,
  extractRepresentativeThemes,
  resolveReadingPersona
} from "../../lib/business-rules";
import { formatDuration } from "../../lib/formatters";
import {
  getPersonaVisual,
  getPersonaVisualPalette,
  type PersonaVisualPalette
} from "../../lib/persona-visuals";
import type { ReadingPersona, ReadingPersonaPatch, ReadingStats } from "../../lib/types";
import {
  getCurrentReadingStatsAnchor,
  formatReadingStatsPeriodAnchor,
  formatReadingStatsPeriodTitle,
  type ReadingStatsPeriod
} from "../../pages/reading-stats-period";
import {
  exportCanvasAsReportImage,
  type ReportImageExportResult
} from "./report-image-export";

export type PeriodReportCompleteness = "cached" | "empty" | "unsynced" | "future_blocked";

export type PeriodReportLabels = {
  headline?: string;
  summary?: string;
  keywords?: string[];
  shareCaption?: string;
  suggestions?: string[];
};

export type PeriodReport = {
  reportType: ReadingStatsPeriod["mode"];
  periodAnchor: string;
  rangeLabel: string;
  dataCompleteness: PeriodReportCompleteness;
  labels: PeriodReportLabels;
};

export type PeriodReportAiReviewInput = {
  overview?: string;
  nextActions?: string[];
  readingPersona?: ReadingPersonaPatch;
};

export type MonthlyReportPosterOptions = {
  aiReview?: PeriodReportAiReviewInput;
  dataCompleteness?: PeriodReportCompleteness;
};

export type MonthlyReportPosterMetric = {
  label: string;
  value: string;
};

export type MonthlyReportPosterItem = {
  label: string;
  meta?: string;
};

export type MonthlyReportPosterData = PeriodReport & {
  fileName: string;
  title: string;
  anchorLabel: string;
  headline: string;
  summary: string;
  persona: ReadingPersona;
  metrics: MonthlyReportPosterMetric[];
  books: MonthlyReportPosterItem[];
  categories: MonthlyReportPosterItem[];
  keywords: string[];
};

export type MonthlyReportStoryPageId = "cover" | "rhythm" | "themes" | "books" | "insight" | "action";

export type MonthlyReportStoryPage = {
  id: MonthlyReportStoryPageId;
  title: string;
  label: string;
};

export const MONTHLY_REPORT_STORY_PAGES: MonthlyReportStoryPage[] = [
  { id: "cover", title: "本期阅读画像", label: "封面" },
  { id: "rhythm", title: "阅读节奏", label: "投入" },
  { id: "themes", title: "主题结构", label: "偏好" },
  { id: "books", title: "书目证据", label: "证据" },
  { id: "insight", title: "AI 分析", label: "洞察" },
  { id: "action", title: "下期行动", label: "行动" }
];

const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 1440;
const WIDE_REPORT_WIDTH = 1920;
const WIDE_REPORT_HEIGHT = 1080;
const STORY_REPORT_WIDTH = 1080;
const STORY_REPORT_HEIGHT = 1440;
const MAX_POSTER_KEYWORD_LENGTH = 12;
const WIDE_REPORT_TREND_POINTS: Array<[number, number]> = [
  [0, 88],
  [7, 66],
  [14, 74],
  [21, 46],
  [28, 70],
  [36, 36],
  [44, 64],
  [52, 44],
  [60, 58],
  [68, 12],
  [76, 55],
  [84, 34],
  [92, 68],
  [100, 48]
];
const STORY_REPORT_RHYTHM_BARS = [42, 68, 36, 84, 58, 72, 46, 64, 76, 44, 62, 54];

export function splitMonthlyReportPosterTitle(
  title: string,
  anchorLabel: string
): { period: string; subject: string } {
  if (title.startsWith(anchorLabel)) {
    const rawSubject = title.slice(anchorLabel.length).trim();
    const subject =
      rawSubject.startsWith("度") && anchorLabel.endsWith(" 年")
        ? `年${rawSubject}`
        : rawSubject;
    return { period: anchorLabel, subject: subject || "阅读报告" };
  }

  return { period: anchorLabel, subject: title };
}

export function formatMonthlyReportPosterPersonaTitle(
  title: string | undefined,
  fallback: string
): string {
  return (title ?? fallback).replace(/^[A-Z]{4}\s*型读者\s*[·:：-]\s*/, "").trim();
}

function buildPeriodReportRangeLabel(period: ReadingStatsPeriod): string {
  return formatReadingStatsPeriodTitle(period, "stats").replace(/\s*阅读报告$/, "").trim();
}

function buildPeriodReportLabels(params: {
  headline: string;
  keywords: string[];
  rangeLabel: string;
  summary: string;
  suggestions: string[];
  title: string;
}): PeriodReportLabels {
  const labels: PeriodReportLabels = {
    headline: params.headline,
    summary: params.summary,
    keywords: params.keywords,
    shareCaption: `${params.title} · ${params.headline}`.trim()
  };

  if (params.suggestions.length > 0) {
    labels.suggestions = params.suggestions;
  }

  if (params.rangeLabel && !labels.shareCaption) {
    labels.shareCaption = params.rangeLabel;
  }

  return labels;
}

function buildPeriodReportSuggestions(
  nextActions: string[] | undefined,
  personaSuggestion: string | undefined
): string[] {
  const values = [...(nextActions ?? []), personaSuggestion]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  return Array.from(new Set(values)).slice(0, 5);
}

function resolvePeriodReportCompleteness(
  stats: ReadingStats,
  activePeriod: ReadingStatsPeriod,
  override?: PeriodReportCompleteness
): PeriodReportCompleteness {
  if (
    activePeriod.mode !== "overall" &&
    activePeriod.baseTime > getCurrentReadingStatsAnchor(activePeriod.mode)
  ) {
    return "future_blocked";
  }

  if (override) {
    return override;
  }

  if (!hasMeaningfulReadingStats(stats)) {
    return "empty";
  }

  return "cached";
}

function hasMeaningfulReadingStats(stats: ReadingStats): boolean {
  return Boolean(
    (stats.totalReadTimeSeconds ?? 0) > 0 ||
      (stats.readDays ?? 0) > 0 ||
      (stats.dayAverageReadTimeSeconds ?? 0) > 0 ||
      stats.buckets.length > 0 ||
      stats.longestItems.length > 0 ||
      stats.categories.length > 0
  );
}

export function buildMonthlyReportPosterData(
  stats: ReadingStats,
  activePeriod: ReadingStatsPeriod,
  options: MonthlyReportPosterOptions = {}
): MonthlyReportPosterData {
  const persona = resolveReadingPersona(
    buildReadingPersona(stats),
    options.aiReview?.readingPersona
  );
  const sortedCategories = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left));
  const topCategory = sortedCategories[0];
  const topBookItems = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)
    .slice(0, 3);
  const topCategories = sortedCategories.slice(0, 3);
  const representativeThemes = extractRepresentativeThemes(stats, 5);
  const headline = buildPosterHeadline(persona, topCategory?.title);
  const summary = buildPosterSummary(stats, persona, topCategory?.title, options.aiReview?.overview);
  const title = formatReadingStatsPeriodTitle(activePeriod, "stats");
  const anchorLabel = formatReadingStatsPeriodAnchor(activePeriod);
  const rangeLabel = buildPeriodReportRangeLabel(activePeriod);
  const keywords = buildPosterKeywords(persona, representativeThemes);
  const dataCompleteness = resolvePeriodReportCompleteness(
    stats,
    activePeriod,
    options.dataCompleteness
  );
  const suggestions = buildPeriodReportSuggestions(options.aiReview?.nextActions, persona.suggestion);
  const labels = buildPeriodReportLabels({
    headline,
    keywords,
    rangeLabel,
    summary,
    suggestions,
    title
  });
  const metrics: MonthlyReportPosterMetric[] = [
    { label: "总时长", value: formatDuration(stats.totalReadTimeSeconds) },
    { label: "阅读天数", value: `${stats.readDays ?? 0}天` },
    { label: "代表方向", value: topCategory?.title ?? "等待积累" }
  ];

  return {
    reportType: activePeriod.mode,
    periodAnchor: anchorLabel,
    rangeLabel,
    dataCompleteness,
    labels,
    fileName: sanitizeFileName(`${anchorLabel}-阅读海报`),
    title,
    anchorLabel,
    headline,
    summary,
    persona,
    metrics,
    books: topBookItems.map((item) => ({
      label: item.title,
      meta: [item.author, formatDuration(item.readTimeSeconds)].filter(Boolean).join(" · ")
    })),
    categories: topCategories.map((item) => ({
      label: item.title,
      meta: formatDuration(categoryValue(item))
    })),
    keywords
  };
}

export async function downloadMonthlyReportPoster(
  data: MonthlyReportPosterData
): Promise<ReportImageExportResult> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境不支持海报绘制。");
  }

  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;

  const visual = getPersonaVisual(data.persona);
  const [personaImage, propImage, archSceneImage] = await Promise.all([
    loadCanvasImage(visual.assetSrc),
    visual.propAssetSrc ? loadCanvasImage(visual.propAssetSrc) : Promise.resolve(undefined),
    loadCanvasImage(monthlyReportArchSceneSrc)
  ]);

  drawPosterBackground(context, data);
  drawPosterText(context, data);
  drawPosterPersona(context, data, personaImage, archSceneImage, propImage);

  return exportCanvasAsReportImage(canvas, data.fileName, "生成阅读报告失败。");
}

export async function downloadMonthlyReportWideReport(
  data: MonthlyReportPosterData
): Promise<ReportImageExportResult> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境不支持横版报告绘制。");
  }

  canvas.width = WIDE_REPORT_WIDTH;
  canvas.height = WIDE_REPORT_HEIGHT;

  const visual = getPersonaVisual(data.persona);
  const [personaImage, archSceneImage] = await Promise.all([
    loadCanvasImage(visual.assetSrc),
    loadCanvasImage(monthlyReportArchSceneSrc)
  ]);

  drawWideReportBackground(context, data);
  drawWideReportCover(context, data, personaImage, archSceneImage);
  drawWideReportAnalysis(context, data);
  drawWideReportSidebar(context, data);

  return exportCanvasAsReportImage(canvas, `${data.fileName}-16-9报告`, "生成横版报告失败。");
}

export async function downloadMonthlyReportStoryPage(
  data: MonthlyReportPosterData,
  pageIndex: number
): Promise<ReportImageExportResult> {
  const page = MONTHLY_REPORT_STORY_PAGES[pageIndex] ?? MONTHLY_REPORT_STORY_PAGES[0];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境不支持轮播报告绘制。");
  }

  canvas.width = STORY_REPORT_WIDTH;
  canvas.height = STORY_REPORT_HEIGHT;

  const images = await loadMonthlyReportStoryImages(data);
  drawMonthlyReportStoryPage(context, data, page, pageIndex, images);

  return exportCanvasAsReportImage(
    canvas,
    sanitizeFileName(`${data.fileName}-轮播报告-${String(pageIndex + 1).padStart(2, "0")}-${page.title}`),
    "生成轮播报告失败。"
  );
}

export async function downloadMonthlyReportStoryPages(
  data: MonthlyReportPosterData
): Promise<ReportImageExportResult[]> {
  const images = await loadMonthlyReportStoryImages(data);
  const results: ReportImageExportResult[] = [];

  for (let index = 0; index < MONTHLY_REPORT_STORY_PAGES.length; index += 1) {
    const page = MONTHLY_REPORT_STORY_PAGES[index];
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前环境不支持轮播报告绘制。");
    }

    canvas.width = STORY_REPORT_WIDTH;
    canvas.height = STORY_REPORT_HEIGHT;
    drawMonthlyReportStoryPage(context, data, page, index, images);
    results.push(
      await exportCanvasAsReportImage(
        canvas,
        sanitizeFileName(`${data.fileName}-轮播报告-${String(index + 1).padStart(2, "0")}-${page.title}`),
        "生成轮播报告失败。"
      )
    );
  }

  return results;
}

type MonthlyReportStoryImages = {
  archSceneImage: CanvasImageSource;
  personaImage: CanvasImageSource;
  propImage?: CanvasImageSource;
};

type MonthlyReportStoryContext = {
  actionItems: string[];
  evidence: string[];
  focusBook: string;
  personaTitle: string;
  secondCategory: string;
  suggestion: string;
  titleParts: ReturnType<typeof splitMonthlyReportPosterTitle>;
  topCategory: string;
};

async function loadMonthlyReportStoryImages(data: MonthlyReportPosterData): Promise<MonthlyReportStoryImages> {
  const visual = getPersonaVisual(data.persona);
  const [personaImage, propImage, archSceneImage] = await Promise.all([
    loadCanvasImage(visual.assetSrc),
    visual.propAssetSrc ? loadCanvasImage(visual.propAssetSrc) : Promise.resolve(undefined),
    loadCanvasImage(monthlyReportArchSceneSrc)
  ]);

  return { archSceneImage, personaImage, propImage };
}

function drawMonthlyReportStoryPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  page: MonthlyReportStoryPage,
  pageIndex: number,
  images: MonthlyReportStoryImages
) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const storyContext = buildMonthlyReportStoryContext(data);

  drawStoryBackground(context, palette);
  drawStoryHeader(context, page, pageIndex, palette);
  drawStoryFooter(context);

  if (page.id === "cover") {
    drawStoryCoverPage(context, data, storyContext, images, palette);
    return;
  }

  if (page.id === "rhythm") {
    drawStoryRhythmPage(context, data, palette);
    return;
  }

  if (page.id === "themes") {
    drawStoryThemesPage(context, data, storyContext, palette);
    return;
  }

  if (page.id === "books") {
    drawStoryBooksPage(context, data, storyContext, palette);
    return;
  }

  if (page.id === "insight") {
    drawStoryInsightPage(context, data, storyContext, palette);
    return;
  }

  drawStoryActionPage(context, data, storyContext, palette);
}

function buildMonthlyReportStoryContext(data: MonthlyReportPosterData): MonthlyReportStoryContext {
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const secondCategory = data.categories[1]?.label ?? topCategory;
  const focusBook = data.books[0]?.label ?? "本期重点书";
  const suggestion = data.persona.suggestion ?? "下个月可以补一条更稳定的阅读主线，把零散兴趣沉淀成可复用笔记。";

  return {
    actionItems: [
      `围绕「${compactReportLabel(topCategory, 8)}」做一次主题复盘。`,
      `补一本「${compactReportLabel(secondCategory, 8)}」相关书，平衡阅读结构。`,
      `给《${compactReportLabel(focusBook, 10)}》沉淀 3 条可复用笔记。`
    ],
    evidence: data.persona.evidence.length > 0 ? data.persona.evidence : [data.persona.basisNotice],
    focusBook,
    personaTitle: formatMonthlyReportPosterPersonaTitle(
      data.persona.displayTitle ?? data.persona.label,
      "本期阅读倾向"
    ),
    secondCategory,
    suggestion,
    titleParts: splitMonthlyReportPosterTitle(data.title, data.anchorLabel),
    topCategory
  };
}

function drawStoryBackground(context: CanvasRenderingContext2D, palette: PersonaVisualPalette) {
  const gradient = context.createLinearGradient(0, 0, STORY_REPORT_WIDTH, STORY_REPORT_HEIGHT);
  gradient.addColorStop(0, "#fbf7ec");
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, "#f2eadc");
  context.fillStyle = gradient;
  context.fillRect(0, 0, STORY_REPORT_WIDTH, STORY_REPORT_HEIGHT);

  context.fillStyle = palette.accentSoft;
  context.beginPath();
  context.ellipse(932, 140, 300, 220, -0.16, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(202, 170, 104, 0.14)";
  context.beginPath();
  context.ellipse(112, 1298, 330, 190, 0.18, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(36, 49, 58, 0.045)";
  context.lineWidth = 1.4;
  for (let index = -4; index < 13; index += 1) {
    context.beginPath();
    context.moveTo(index * 126, 0);
    context.lineTo(index * 126 + 330, STORY_REPORT_HEIGHT);
    context.stroke();
  }

  context.strokeStyle = "rgba(63, 78, 70, 0.12)";
  context.lineWidth = 1.5;
  roundRect(context, 54, 54, STORY_REPORT_WIDTH - 108, STORY_REPORT_HEIGHT - 108, 42);
  context.stroke();
}

function drawStoryHeader(
  context: CanvasRenderingContext2D,
  page: MonthlyReportStoryPage,
  pageIndex: number,
  palette: PersonaVisualPalette
) {
  context.fillStyle = palette.accentDeep;
  context.font = "800 31px Georgia, 'Noto Serif SC', 'Songti SC', serif";
  context.fillText("wxreadmaster 阅读报告", 100, 132);

  context.strokeStyle = "rgba(63, 78, 70, 0.22)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(386, 126);
  context.lineTo(792, 126);
  context.stroke();

  context.fillStyle = "#68736d";
  context.font = "800 21px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.textAlign = "right";
  context.fillText(`${String(pageIndex + 1).padStart(2, "0")} / ${MONTHLY_REPORT_STORY_PAGES.length}`, 948, 132);
  context.textAlign = "start";

  context.fillStyle = palette.accentDeep;
  context.font = "800 24px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText(page.label, 100, 222);

  context.fillStyle = "#1f2d33";
  context.font = "800 72px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, page.title, 100, 314, 760, 78, 1);
}

function drawStoryFooter(context: CanvasRenderingContext2D) {
  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(330, 1348);
  context.lineTo(750, 1348);
  context.stroke();

  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  context.fillText("由 wxreadmaster 生成", STORY_REPORT_WIDTH / 2, 1388);
  context.textAlign = "start";
}

function drawStoryCoverPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  storyContext: MonthlyReportStoryContext,
  images: MonthlyReportStoryImages,
  palette: PersonaVisualPalette
) {
  const visual = getPersonaVisual(data.persona);

  context.fillStyle = "#1f2d33";
  context.font = "700 88px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, storyContext.titleParts.period, 100, 468, 600, 98, 1);
  context.font = "700 106px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, storyContext.titleParts.subject, 100, 588, 500, 114, 1);

  drawStoryCoverArchImagePanel(context, 528, 570, 456, 500, images.archSceneImage, images.personaImage, palette);
  if (images.propImage) {
    context.drawImage(images.propImage, 842, 932, 132, 132);
  }

  context.strokeStyle = "rgba(63, 78, 70, 0.26)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(100, 778);
  context.lineTo(430, 778);
  context.stroke();

  drawStoryPanel(context, 86, 820, 432, 318, 26);
  context.fillStyle = "#1f2d33";
  context.font = "800 29px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `${visual.code ? `${visual.code} 型读者 · ` : ""}${storyContext.personaTitle}`,
    116,
    900,
    372,
    36,
    1
  );

  context.fillStyle = "#66746e";
  context.font = "400 25px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, data.summary, 116, 978, 372, 38, 4);

  drawStoryCoverMetricStrip(context, data, palette, 100, 1176, 880);
}

function drawStoryRhythmPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  palette: PersonaVisualPalette
) {
  context.fillStyle = "#1f2d33";
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, "先看投入节奏：阅读强度、活跃天数和代表方向共同决定画像底色。", 100, 408, 860, 42, 2);

  const metricWidth = 276;
  data.metrics.forEach((metric, index) => {
    const x = 100 + index * (metricWidth + 28);
    drawStoryPanel(context, x, 520, metricWidth, 180, 26);
    drawMetricIcon(context, palette, x + 48, 574, index);
    context.fillStyle = "#68736d";
    context.font = "800 22px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.fillText(metric.label, x + 86, 584);
    context.fillStyle = "#1f2d33";
    context.font = "800 48px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
    drawCanvasTextLimited(context, metric.value, x + 30, 660, metricWidth - 60, 54, 1);
  });

  drawStoryPanel(context, 100, 760, 880, 390, 30);
  context.fillStyle = "#68736d";
  context.font = "800 22px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("周期阅读节奏示意", 138, 828);
  drawStoryBars(context, palette, 138, 884, 804, 152);

  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, "柱形用于表达这一周期的节奏，帮助快速判断读书投入是否集中。", 138, 1096, 760, 34, 2);
}

function drawStoryCoverMetricStrip(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number
) {
  const metrics = data.metrics.slice(0, 3);
  const itemWidth = width / 3;

  drawStoryPanel(context, x, y, width, 112, 24);
  metrics.forEach((metric, index) => {
    const itemX = x + index * itemWidth;
    if (index > 0) {
      context.strokeStyle = "rgba(63, 78, 70, 0.18)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(itemX, y + 22);
      context.lineTo(itemX, y + 90);
      context.stroke();
    }

    context.fillStyle = palette.accentDeep;
    context.font = "800 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, metric.label, itemX + 28, y + 38, itemWidth - 56, 22, 1);
    context.fillStyle = "#1f2d33";
    context.font = "800 34px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
    drawCanvasTextLimited(context, metric.value, itemX + 28, y + 82, itemWidth - 56, 38, 1);
  });

  drawStoryChips(context, data.keywords.slice(0, 4), palette, x + 16, y + 136, width - 32, 32, 17);
}

function drawStoryCoverArchImagePanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  archSceneImage: CanvasImageSource,
  personaImage: CanvasImageSource,
  palette: PersonaVisualPalette
) {
  context.save();
  drawArchPanel(context, x, y, width, height);
  context.clip();
  context.globalAlpha = 0.84;
  drawImageCover(context, archSceneImage, x, y, width, height);
  context.globalAlpha = 1;
  context.fillStyle = "rgba(246, 241, 228, 0.20)";
  context.fillRect(x, y, width, height);
  drawStoryCoverPersona(context, personaImage, x + 76, y - 8, 340, 525);
  context.restore();

  context.strokeStyle = palette.accentMid;
  context.lineWidth = 2;
  drawArchPanel(context, x, y, width, height);
  context.stroke();
}

function drawStoryCoverPersona(
  context: CanvasRenderingContext2D,
  personaImage: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const image = personaImage as HTMLImageElement;
  const sourceWidth = Number(image.naturalWidth || image.width || 512);
  const sourceHeight = Number(image.naturalHeight || image.height || 512);
  const cropX = sourceWidth * 0.18;
  const cropWidth = sourceWidth * 0.64;

  context.drawImage(
    personaImage,
    cropX,
    0,
    cropWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

function drawStoryThemesPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  storyContext: MonthlyReportStoryContext,
  palette: PersonaVisualPalette
) {
  context.fillStyle = "#1f2d33";
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `本期注意力最明显地落在「${storyContext.topCategory}」，它决定了这份报告的主要阅读气质。`,
    100,
    408,
    860,
    42,
    2
  );

  drawStoryPanel(context, 100, 530, 880, 460, 30);
  drawWideCategoryDonut(context, palette, 292, 756, compactReportLabel(storyContext.topCategory, 6));

  data.categories.slice(0, 3).forEach((item, index) => {
    const y = 650 + index * 88;
    const barWidth = [360, 250, 170][index] ?? 150;
    context.fillStyle = "#1f2d33";
    context.font = "800 32px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
    drawCanvasTextLimited(context, item.label, 470, y, 220, 36, 1);
    context.fillStyle = "rgba(79, 119, 76, 0.14)";
    roundRect(context, 470, y + 28, 380, 18, 9);
    context.fill();
    context.fillStyle = index === 0 ? palette.accentDeep : palette.accentMid;
    roundRect(context, 470, y + 28, barWidth, 18, 9);
    context.fill();
    context.fillStyle = "#68736d";
    context.font = "700 24px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.meta ?? "", 866, y + 45, 84, 28, 1);
  });

  drawStoryChips(context, data.keywords.slice(0, 6), palette, 120, 1048, 840, 38, 22);
  drawStoryPanel(context, 100, 1168, 880, 104, 24);
  context.fillStyle = palette.accentDeep;
  context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("主线判断", 132, 1214);
  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `${storyContext.topCategory} 是当前投入最多的主题，适合作为下一次复盘的入口。`,
    276,
    1214,
    650,
    34,
    1
  );
}

function drawStoryBooksPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  storyContext: MonthlyReportStoryContext,
  palette: PersonaVisualPalette
) {
  context.fillStyle = "#1f2d33";
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `「${compactReportLabel(storyContext.focusBook, 16)}」是本期最能代表注意力流向的书目。`,
    100,
    408,
    860,
    42,
    2
  );

  data.books.slice(0, 4).forEach((item, index) => {
    const y = 512 + index * 142;
    drawBookCover(context, palette, 122, y, index);
    context.fillStyle = "#1f2d33";
    context.font = "800 34px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.label, 228, y + 36, 690, 40, 1);
    context.fillStyle = "#68736d";
    context.font = "400 25px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.meta ?? "", 228, y + 76, 690, 30, 1);
    context.strokeStyle = "rgba(202, 170, 104, 0.38)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(228, y + 106);
    context.lineTo(948, y + 106);
    context.stroke();
  });

  drawStoryPanel(context, 100, 1110, 880, 150, 26);
  context.fillStyle = palette.accentDeep;
  context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("证据摘录", 132, 1160);
  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, storyContext.evidence[0], 132, 1200, 808, 34, 2);
}

function drawStoryInsightPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  storyContext: MonthlyReportStoryContext,
  palette: PersonaVisualPalette
) {
  drawStoryPanel(context, 100, 420, 880, 330, 32);
  context.fillStyle = palette.accentDeep;
  context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("AI 结论", 140, 486);
  context.fillStyle = "#1f2d33";
  context.font = "800 48px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, data.headline, 140, 568, 800, 58, 2);
  context.fillStyle = "#68736d";
  context.font = "400 25px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, data.summary, 140, 690, 800, 34, 2);

  drawStoryPanel(context, 100, 820, 410, 300, 28);
  drawStoryPanel(context, 570, 820, 410, 300, 28);
  context.fillStyle = palette.accentDeep;
  context.font = "800 24px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("优势", 138, 884);
  context.fillText("盲区", 608, 884);

  context.fillStyle = "#68736d";
  context.font = "400 26px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, `你能持续围绕「${compactReportLabel(storyContext.topCategory, 8)}」形成稳定兴趣主线。`, 138, 948, 330, 40, 3);
  drawCanvasTextLimited(context, "如果长期只读同类内容，视角会变窄，需要少量异质主题做校准。", 608, 948, 330, 40, 3);

  drawStoryPanel(context, 100, 1170, 880, 112, 24);
  context.fillStyle = palette.accentDeep;
  context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("建议方向", 132, 1218);
  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, storyContext.suggestion, 276, 1218, 650, 34, 1);
}

function drawStoryActionPage(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  storyContext: MonthlyReportStoryContext,
  palette: PersonaVisualPalette
) {
  drawStoryPanel(context, 100, 408, 880, 180, 28);
  context.fillStyle = "#1f2d33";
  context.font = "800 30px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, storyContext.suggestion, 136, 488, 808, 42, 2);

  storyContext.actionItems.forEach((item, index) => {
    const y = 676 + index * 130;
    context.fillStyle = palette.accentDeep;
    context.beginPath();
    context.ellipse(128, y - 18, 28, 28, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fbf7ec";
    context.font = "800 24px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "center";
    context.fillText(String(index + 1), 128, y - 10);
    context.textAlign = "start";

    context.fillStyle = "#1f2d33";
    context.font = "800 30px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
    drawCanvasTextLimited(context, item, 190, y, 730, 40, 2);
  });

  drawStoryPanel(context, 100, 1066, 880, 150, 26);
  context.fillStyle = palette.accentDeep;
  context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("下期复盘问题", 132, 1118);
  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, "这条阅读主线，是在扩展理解，还是只是在重复熟悉的信息舒适区？", 132, 1160, 808, 34, 2);

  drawStoryChips(context, data.keywords.slice(0, 4), palette, 120, 1260, 840, 34, 20);
}

function drawStoryPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.fillStyle = "rgba(250, 247, 237, 0.58)";
  roundRect(context, x, y, width, height, radius);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.18)";
  context.lineWidth = 1.4;
  roundRect(context, x, y, width, height, radius);
  context.stroke();
}

function drawStoryBars(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.strokeStyle = "rgba(63, 78, 70, 0.12)";
  context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const lineY = y + height * ratio;
    context.beginPath();
    context.moveTo(x, lineY);
    context.lineTo(x + width, lineY);
    context.stroke();
  });

  const gap = 13;
  const barWidth = (width - gap * (STORY_REPORT_RHYTHM_BARS.length - 1)) / STORY_REPORT_RHYTHM_BARS.length;
  STORY_REPORT_RHYTHM_BARS.forEach((value, index) => {
    const barHeight = Math.max(18, (value / 100) * height);
    const barX = x + index * (barWidth + gap);
    context.fillStyle = index === 3 || index === 8 ? palette.accentDeep : palette.accentMid;
    roundRect(context, barX, y + height - barHeight, barWidth, barHeight, 14);
    context.fill();
  });
}

function drawStoryChips(
  context: CanvasRenderingContext2D,
  keywords: string[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  maxWidth: number,
  chipHeight: number,
  fontSize: number
) {
  let offsetX = x;
  let offsetY = y;
  context.font = `800 ${fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;

  keywords.forEach((keyword) => {
    const chipWidth = Math.min(Math.ceil(context.measureText(keyword).width) + 34, maxWidth);
    if (offsetX + chipWidth > x + maxWidth) {
      offsetX = x;
      offsetY += chipHeight + 12;
    }

    context.fillStyle = palette.accentSoft;
    roundRect(context, offsetX, offsetY, chipWidth, chipHeight, chipHeight / 2);
    context.fill();
    context.strokeStyle = palette.accentMid;
    context.lineWidth = 1;
    roundRect(context, offsetX, offsetY, chipWidth, chipHeight, chipHeight / 2);
    context.stroke();
    context.fillStyle = palette.accentDeep;
    drawCanvasTextLimited(context, keyword, offsetX + 17, offsetY + chipHeight - 11, chipWidth - 34, fontSize + 2, 1);
    offsetX += chipWidth + 12;
  });
}

function drawWideReportBackground(context: CanvasRenderingContext2D, data: MonthlyReportPosterData) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const gradient = context.createLinearGradient(0, 0, WIDE_REPORT_WIDTH, WIDE_REPORT_HEIGHT);
  gradient.addColorStop(0, "#fbf7ec");
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, "#f2eadc");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDE_REPORT_WIDTH, WIDE_REPORT_HEIGHT);

  context.fillStyle = palette.accentSoft;
  context.beginPath();
  context.ellipse(1780, 95, 340, 210, -0.16, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(202, 170, 104, 0.14)";
  context.beginPath();
  context.ellipse(120, 950, 360, 180, 0.14, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(36, 49, 58, 0.04)";
  context.lineWidth = 1.2;
  for (let index = -4; index < 24; index += 1) {
    context.beginPath();
    context.moveTo(index * 112, 0);
    context.lineTo(index * 112 + 280, WIDE_REPORT_HEIGHT);
    context.stroke();
  }

  context.strokeStyle = "rgba(63, 78, 70, 0.14)";
  context.lineWidth = 1.5;
  roundRect(context, 46, 46, WIDE_REPORT_WIDTH - 92, WIDE_REPORT_HEIGHT - 92, 28);
  context.stroke();
}

function drawWideReportCover(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  personaImage: CanvasImageSource,
  archSceneImage: CanvasImageSource
) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const titleParts = splitMonthlyReportPosterTitle(data.title, data.anchorLabel);
  const x = 82;
  const width = 478;

  drawWideColumnDivider(context, 590);

  context.fillStyle = palette.accentDeep;
  context.font = "800 30px Georgia, 'Noto Serif SC', 'Songti SC', serif";
  context.fillText("wxreadmaster 阅读报告", x, 132);

  context.fillStyle = "#1f2d33";
  context.font = "700 68px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, titleParts.period, x, 220, width - 32, 74, 1);
  context.font = "700 78px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, titleParts.subject, x, 302, width - 28, 84, 1);

  drawArchImagePanel(context, x + 32, 352, 392, 274, archSceneImage, personaImage, palette);

  const personaTitle = formatMonthlyReportPosterPersonaTitle(
    data.persona.displayTitle ?? data.persona.label,
      "本期阅读倾向"
  );
  context.fillStyle = palette.accentDeep;
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `${visual.code ? `${visual.code} 型读者 · ` : ""}${personaTitle}`,
    x,
    706,
    width - 18,
    38,
    2
  );

  context.fillStyle = "#68736d";
  context.font = "400 22px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, data.summary, x, 776, width - 10, 34, 3);

  drawWideChips(context, data.keywords.slice(0, 3), palette, x, 900, width - 10, 30, 18);
}

function drawWideReportAnalysis(context: CanvasRenderingContext2D, data: MonthlyReportPosterData) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const x = 620;
  const width = 720;
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const metrics = [
    data.metrics[0],
    data.metrics[1],
    { label: "本期峰值", value: "18日" },
    data.metrics[2]
  ].filter((metric): metric is MonthlyReportPosterMetric => Boolean(metric));

  drawWideColumnDivider(context, 1370);
  drawWideMetrics(context, metrics, palette, x, 104, width);
  drawWideTrendChart(context, palette, x, 318, width, 292);
  drawWidePreferenceSection(context, data, palette, x, 690, width, topCategory);
}

function drawWideReportSidebar(context: CanvasRenderingContext2D, data: MonthlyReportPosterData) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const x = 1408;
  const width = 424;
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const secondCategory = data.categories[1]?.label ?? topCategory;
  const focusBook = data.books[0]?.label ?? "本期重点书";
  const suggestion = data.persona.suggestion ?? "下个月可以补一本系统型主题书，把零散兴趣沉淀成稳定路径。";
  const actionItems = [
    `延续「${compactReportLabel(topCategory, 8)}」主线做一次主题复盘。`,
    `补一本「${compactReportLabel(secondCategory, 8)}」相关书，平衡阅读结构。`,
    `围绕《${compactReportLabel(focusBook, 10)}》沉淀 3 条可复用笔记。`
  ];

  drawWideSectionTitle(context, "重点书目", x, 132);
  data.books.slice(0, 3).forEach((item, index) => {
    const top = 174 + index * 112;
    drawWideBookRow(context, item, palette, x, top, width, index);
  });

  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(x, 500);
  context.lineTo(x + width, 500);
  context.stroke();

  drawWideSectionTitle(context, "本期关键词", x, 548);
  const keywordBottom = drawWideChips(context, data.keywords.slice(0, 5), palette, x, 590, width, 32, 19);
  const adviceHeight = 212;
  const safeBottom = WIDE_REPORT_HEIGHT - 86;
  const adviceTop = Math.min(Math.max(746, keywordBottom + 24), safeBottom - adviceHeight);

  drawWideAdviceCard(context, suggestion, actionItems, palette, x, adviceTop, width, adviceHeight);
}

function drawWideColumnDivider(context: CanvasRenderingContext2D, x: number) {
  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(x, 72);
  context.lineTo(x, WIDE_REPORT_HEIGHT - 72);
  context.stroke();
}

function drawWideMetrics(
  context: CanvasRenderingContext2D,
  metrics: MonthlyReportPosterMetric[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number
) {
  const itemWidth = width / 4;

  metrics.forEach((metric, index) => {
    const centerX = x + itemWidth * index + itemWidth / 2;
    if (index > 0) {
      context.strokeStyle = "rgba(63, 78, 70, 0.20)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(x + itemWidth * index, y + 10);
      context.lineTo(x + itemWidth * index, y + 142);
      context.stroke();
    }

    drawMetricIcon(context, palette, centerX, y + 28, index);
    context.fillStyle = "#68736d";
    context.font = "800 19px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "center";
    context.fillText(metric.label, centerX, y + 82);

    context.fillStyle = "#1f2d33";
    context.font = "800 42px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
    drawCanvasTextLimited(context, metric.value, centerX, y + 130, itemWidth - 24, 44, 1);
    context.textAlign = "start";
  });

  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.beginPath();
  context.moveTo(x, y + 162);
  context.lineTo(x + width, y + 162);
  context.stroke();
}

function drawWideTrendChart(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  drawWideSectionTitle(context, "阅读趋势", x, y);
  context.fillStyle = "#68736d";
  context.font = "700 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("阅读时长（分钟）", x + width - 156, y);

  const chartX = x + 4;
  const chartY = y + 48;
  const chartWidth = width - 26;
  const chartHeight = height - 72;

  context.strokeStyle = "rgba(63, 78, 70, 0.13)";
  context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => {
    const lineY = chartY + chartHeight * ratio;
    context.beginPath();
    context.moveTo(chartX, lineY);
    context.lineTo(chartX + chartWidth, lineY);
    context.stroke();
  });

  context.strokeStyle = palette.accentDeep;
  context.lineWidth = 4;
  context.beginPath();
  WIDE_REPORT_TREND_POINTS.forEach(([pointX, pointY], index) => {
    const nextX = chartX + (pointX / 100) * chartWidth;
    const nextY = chartY + (pointY / 100) * chartHeight;
    if (index === 0) {
      context.moveTo(nextX, nextY);
      return;
    }
    context.lineTo(nextX, nextY);
  });
  context.stroke();

  WIDE_REPORT_TREND_POINTS.forEach(([pointX, pointY], index) => {
    const nextX = chartX + (pointX / 100) * chartWidth;
    const nextY = chartY + (pointY / 100) * chartHeight;
    context.fillStyle = "#f6f1e4";
    context.beginPath();
    context.ellipse(nextX, nextY, index === 9 ? 8 : 5, index === 9 ? 8 : 5, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.accentDeep;
    context.lineWidth = 2;
    context.stroke();
  });

  const peakX = chartX + 0.68 * chartWidth;
  context.strokeStyle = "rgba(63, 78, 70, 0.28)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(peakX, chartY + 12);
  context.lineTo(peakX, chartY + chartHeight + 8);
  context.stroke();
  context.fillStyle = palette.accentDeep;
  context.font = "800 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("18日峰值", peakX + 16, chartY + 42);

  context.fillStyle = "#68736d";
  context.font = "700 16px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ["1", "8", "15", "22", "31"].forEach((label, index) => {
    context.fillText(label, chartX + (chartWidth / 4) * index, chartY + chartHeight + 36);
  });
}

function drawWidePreferenceSection(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  topCategory: string
) {
  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(x, y - 34);
  context.lineTo(x + width, y - 34);
  context.stroke();

  drawWideCategoryDonut(context, palette, x + 120, y + 122, topCategory);
  drawWideSectionTitle(context, "分类偏好", x + 274, y + 30);

  data.categories.slice(0, 3).forEach((item, index) => {
    const rowY = y + 78 + index * 62;
    const barWidth = [196, 132, 92][index] ?? 76;
    context.fillStyle = "#1f2d33";
    context.font = "800 25px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
    drawCanvasTextLimited(context, item.label, x + 274, rowY, 116, 28, 1);
    context.fillStyle = "rgba(79, 119, 76, 0.15)";
    roundRect(context, x + 420, rowY - 18, 220, 15, 8);
    context.fill();
    context.fillStyle = index === 0 ? palette.accentDeep : palette.accentMid;
    roundRect(context, x + 420, rowY - 18, barWidth, 15, 8);
    context.fill();
    context.fillStyle = "#68736d";
    context.font = "700 20px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.meta ?? "", x + 662, rowY, 80, 22, 1);
  });
}

function drawWideSectionTitle(context: CanvasRenderingContext2D, title: string, x: number, y: number) {
  context.fillStyle = "#1f2d33";
  context.font = "800 34px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.fillText(title, x, y);
}

function drawWideBookRow(
  context: CanvasRenderingContext2D,
  item: MonthlyReportPosterItem,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  index: number
) {
  context.fillStyle = palette.accentDeep;
  context.beginPath();
  context.ellipse(x + 18, y + 38, 16, 16, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f6f1e4";
  context.font = "800 19px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.textAlign = "center";
  context.fillText(String(index + 1), x + 18, y + 45);
  context.textAlign = "start";

  drawBookCover(context, palette, x + 52, y, index);
  context.fillStyle = "#1f2d33";
  context.font = "800 27px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  drawCanvasTextLimited(context, item.label, x + 142, y + 36, width - 150, 30, 1);
  context.fillStyle = "#68736d";
  context.font = "400 20px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  drawCanvasTextLimited(context, item.meta ?? "", x + 142, y + 66, width - 150, 22, 1);

  context.strokeStyle = "rgba(202, 170, 104, 0.38)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(x + 142, y + 92);
  context.lineTo(x + width, y + 92);
  context.stroke();
}

function drawWideChips(
  context: CanvasRenderingContext2D,
  keywords: string[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  maxWidth: number,
  chipHeight: number,
  fontSize: number
): number {
  let offsetX = x;
  let offsetY = y;
  let bottom = y;
  context.font = `800 ${fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;

  keywords.forEach((keyword) => {
    const chipWidth = Math.min(Math.ceil(context.measureText(keyword).width) + 30, maxWidth);
    if (offsetX + chipWidth > x + maxWidth) {
      offsetX = x;
      offsetY += chipHeight + 12;
    }
    context.fillStyle = palette.accentSoft;
    roundRect(context, offsetX, offsetY, chipWidth, chipHeight, chipHeight / 2);
    context.fill();
    context.strokeStyle = palette.accentMid;
    context.lineWidth = 1;
    roundRect(context, offsetX, offsetY, chipWidth, chipHeight, chipHeight / 2);
    context.stroke();
    context.fillStyle = palette.accentDeep;
    drawCanvasTextLimited(context, keyword, offsetX + 15, offsetY + chipHeight - 10, chipWidth - 28, fontSize + 2, 1);
    bottom = Math.max(bottom, offsetY + chipHeight);
    offsetX += chipWidth + 12;
  });

  return bottom;
}

function drawWideAdviceCard(
  context: CanvasRenderingContext2D,
  suggestion: string,
  actionItems: string[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.fillStyle = "rgba(250, 247, 237, 0.62)";
  roundRect(context, x, y, width, height, 24);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.18)";
  context.lineWidth = 1.2;
  roundRect(context, x, y, width, height, 24);
  context.stroke();

  context.fillStyle = palette.accentDeep;
  context.beginPath();
  context.ellipse(x + 44, y + 50, 30, 30, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f6f1e4";
  context.beginPath();
  context.ellipse(x + 44, y + 50, 12, 12, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#1f2d33";
  context.font = "800 30px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.fillText("AI 阅读建议", x + 90, y + 50);
  context.fillStyle = "#68736d";
  context.font = "400 19px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, suggestion, x + 90, y + 86, width - 112, 26, 2);

  context.fillStyle = "#1f2d33";
  context.font = "800 17px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  actionItems.forEach((item, index) => {
    const itemY = y + 142 + index * 21;
    context.fillStyle = palette.accentDeep;
    context.beginPath();
    context.ellipse(x + 98, itemY - 6, 4, 4, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#1f2d33";
    drawCanvasTextLimited(context, item, x + 112, itemY, width - 130, 20, 1);
  });
}

function drawArchImagePanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  archSceneImage: CanvasImageSource,
  personaImage: CanvasImageSource,
  palette: PersonaVisualPalette
) {
  context.save();
  drawArchPanel(context, x, y, width, height);
  context.clip();
  context.globalAlpha = 0.84;
  drawImageCover(context, archSceneImage, x, y, width, height);
  context.globalAlpha = 1;
  context.fillStyle = "rgba(246, 241, 228, 0.24)";
  context.fillRect(x, y, width, height);
  context.drawImage(personaImage, x + 124, y + 42, 250, 250);
  context.restore();

  context.strokeStyle = palette.accentMid;
  context.lineWidth = 2;
  drawArchPanel(context, x, y, width, height);
  context.stroke();
}

function drawWideCategoryDonut(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  centerX: number,
  centerY: number,
  label: string
) {
  let start = -Math.PI / 2;
  [
    { value: 0.56, color: palette.accentDeep },
    { value: 0.24, color: palette.accentMid },
    { value: 0.20, color: "rgba(79, 119, 76, 0.12)" }
  ].forEach((segment) => {
    const end = start + segment.value * Math.PI * 2;
    context.fillStyle = segment.color;
    context.beginPath();
    context.arc(centerX, centerY, 92, start, end);
    context.arc(centerX, centerY, 48, end, start, true);
    context.closePath();
    context.fill();
    start = end;
  });

  context.fillStyle = "#f6f1e4";
  context.beginPath();
  context.ellipse(centerX, centerY, 46, 46, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#1f2d33";
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  drawCanvasTextLimited(context, label, centerX, centerY + 10, 86, 34, 1);
  context.textAlign = "start";
}

function buildPosterHeadline(persona: ReadingPersona, topCategoryTitle?: string): string {
  if (persona.status !== "insufficient" && persona.displayTitle) {
    return `${persona.displayTitle}，是这一周期最鲜明的阅读气质。`;
  }

  return `${topCategoryTitle ?? "阅读主线"}，是这一周期最明显的投入方向。`;
}

function buildPosterSummary(
  stats: ReadingStats,
  persona: ReadingPersona,
  topCategoryTitle?: string,
  aiOverview?: string
): string {
  if (persona.summary) {
    return persona.summary;
  }

  const normalizedAiOverview = normalizeReportCopy(aiOverview);
  if (normalizedAiOverview) {
    return normalizedAiOverview;
  }

  const readDays = stats.readDays ?? 0;
  const duration = formatDuration(stats.totalReadTimeSeconds);

  if (topCategoryTitle) {
    return `这一周期累计阅读 ${duration}，共活跃 ${readDays} 天，重心主要放在${topCategoryTitle}相关内容上。`;
  }

  return `这一周期累计阅读 ${duration}，共活跃 ${readDays} 天，已经出现比较稳定的阅读投入。`;
}

function normalizeReportCopy(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function buildPosterKeywords(persona: ReadingPersona, themes: string[]): string[] {
  const values = [
    compactPosterKeyword(persona.label ?? persona.displayTitle ?? "阅读状态"),
    ...(persona.evidence ?? []).map(extractKeywordFromEvidence),
    ...themes.map((theme) => compactPosterKeyword(theme))
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim());

  return Array.from(new Set(values)).slice(0, 5);
}

function extractKeywordFromEvidence(evidence: string): string | undefined {
  const normalized = evidence.trim();
  if (!normalized) {
    return undefined;
  }

  const topThemeMatch = normalized.match(/^(.+?)\s+是当前投入最多的主题/);
  if (topThemeMatch?.[1]) {
    return compactPosterKeyword(topThemeMatch[1]);
  }

  if (/^《[^》]+》占重点内容时长约/.test(normalized)) {
    return "少数主线";
  }

  if (normalized.startsWith("本周期活跃阅读")) {
    return "稳定推进";
  }

  if (normalized.startsWith("Top 3 分类投入")) {
    return "主题分布";
  }

  return compactPosterKeyword(normalized.split(/[，。；]/)[0]);
}

function compactPosterKeyword(value: string, maxLength = MAX_POSTER_KEYWORD_LENGTH): string | undefined {
  const normalized = value.trim().replace(/[，。；]+$/g, "");
  if (!normalized) {
    return undefined;
  }

  return compactReportLabel(normalized, maxLength);
}

function compactReportLabel(value: string, maxLength = 14): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function drawPosterBackground(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData
) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const gradient = context.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  gradient.addColorStop(0, "#fbf7ec");
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, "#f2eadc");
  context.fillStyle = gradient;
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  context.fillStyle = palette.accentSoft;
  context.beginPath();
  context.ellipse(940, 92, 280, 210, -0.18, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(202, 170, 104, 0.15)";
  context.beginPath();
  context.ellipse(110, 1300, 300, 170, 0.18, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(31, 45, 51, 0.018)";
  for (let index = 0; index < 180; index += 1) {
    const x = (index * 83) % POSTER_WIDTH;
    const y = (index * 47) % POSTER_HEIGHT;
    context.fillRect(x, y, 1, 1);
  }

  context.strokeStyle = "rgba(36, 49, 58, 0.045)";
  context.lineWidth = 1.4;
  for (let index = -4; index < 13; index += 1) {
    context.beginPath();
    context.moveTo(index * 126, 0);
    context.lineTo(index * 126 + 330, POSTER_HEIGHT);
    context.stroke();
  }

  context.strokeStyle = "rgba(63, 78, 70, 0.12)";
  context.lineWidth = 1.5;
  roundRect(context, 54, 54, POSTER_WIDTH - 108, POSTER_HEIGHT - 108, 34);
  context.stroke();
}

function drawPosterText(context: CanvasRenderingContext2D, data: MonthlyReportPosterData) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const titleParts = splitMonthlyReportPosterTitle(data.title, data.anchorLabel);
  const contentX = 92;

  context.fillStyle = palette.accentDeep;
  context.font = "800 30px Georgia, 'Noto Serif SC', 'Songti SC', serif";
  context.fillText("wxreadmaster 阅读报告", contentX, 138);

  context.strokeStyle = "rgba(63, 78, 70, 0.24)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(380, 132);
  context.lineTo(570, 132);
  context.stroke();

  context.fillStyle = "#1f2d33";
  context.font = "700 84px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, titleParts.period, contentX, 262, 520, 96, 1);
  context.font = "700 96px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, titleParts.subject, contentX, 374, 500, 104, 1);

  context.strokeStyle = "rgba(63, 78, 70, 0.35)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(contentX, 532);
  context.lineTo(455, 532);
  context.stroke();

  context.fillStyle = "#66746e";
  context.font = "400 27px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, data.summary, contentX, 590, 470, 44, 2);

  context.strokeStyle = "rgba(63, 78, 70, 0.25)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(contentX + 24, 638);
  context.lineTo(475, 638);
  context.stroke();

  drawMetrics(context, data.metrics, palette, 78, 688);
  drawBookListSection(context, data.books, palette, 78, 910, 494, 400);
  drawCategorySection(context, data, palette, 572, 910, 430, 400);
  drawPosterFooter(context);
}

function drawSectionTitle(
  context: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number
) {
  context.fillStyle = "#1f2d33";
  context.font = "800 26px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.fillText(title, x, y);
}

function drawMetrics(
  context: CanvasRenderingContext2D,
  metrics: MonthlyReportPosterMetric[],
  palette: PersonaVisualPalette,
  x: number,
  y: number
) {
  const width = 924;
  const height = 178;

  context.fillStyle = "rgba(250, 247, 237, 0.68)";
  roundRect(context, x, y, width, height, 28);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.24)";
  context.lineWidth = 1.5;
  roundRect(context, x, y, width, height, 28);
  context.stroke();

  drawSectionTitle(context, "本期阅读概览", x + 28, y + 48);

  const itemTop = y + 70;
  const itemWidth = width / 3;
  metrics.forEach((metric, index) => {
    const offsetX = x + index * itemWidth;
    if (index > 0) {
      context.strokeStyle = "rgba(63, 78, 70, 0.22)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(offsetX, itemTop + 6);
      context.lineTo(offsetX, y + height - 20);
      context.stroke();
    }

    drawMetricIcon(context, palette, offsetX + itemWidth / 2, itemTop + 20, index);

    context.fillStyle = "#1f2d33";
    context.font = "800 36px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
    context.textAlign = "center";
    drawCanvasTextLimited(context, metric.value, offsetX + itemWidth / 2, itemTop + 70, itemWidth - 40, 42, 1);

    context.fillStyle = "#68736d";
    context.font = "700 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.fillText(metric.label, offsetX + itemWidth / 2, itemTop + 108);
    context.textAlign = "start";
  });
}

function drawMetricIcon(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  centerX: number,
  centerY: number,
  index: number
) {
  context.fillStyle = palette.accentDeep;
  context.beginPath();
  context.ellipse(centerX, centerY, 24, 24, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(250, 247, 237, 0.92)";
  context.lineWidth = 2.4;
  context.beginPath();
  if (index === 0) {
    context.ellipse(centerX, centerY, 10, 10, 0, 0, Math.PI * 2);
    context.moveTo(centerX, centerY - 6);
    context.lineTo(centerX, centerY + 1);
    context.lineTo(centerX + 6, centerY + 5);
  } else if (index === 1) {
    roundRect(context, centerX - 10, centerY - 8, 20, 18, 3);
    context.moveTo(centerX - 10, centerY - 3);
    context.lineTo(centerX + 10, centerY - 3);
    context.moveTo(centerX - 5, centerY - 12);
    context.lineTo(centerX - 5, centerY - 6);
    context.moveTo(centerX + 5, centerY - 12);
    context.lineTo(centerX + 5, centerY - 6);
  } else {
    context.moveTo(centerX - 11, centerY - 10);
    context.lineTo(centerX - 2, centerY - 7);
    context.lineTo(centerX - 2, centerY + 11);
    context.lineTo(centerX - 11, centerY + 8);
    context.closePath();
    context.moveTo(centerX + 11, centerY - 10);
    context.lineTo(centerX + 2, centerY - 7);
    context.lineTo(centerX + 2, centerY + 11);
    context.lineTo(centerX + 11, centerY + 8);
    context.closePath();
  }
  context.stroke();
}

function drawBookListSection(
  context: CanvasRenderingContext2D,
  items: MonthlyReportPosterItem[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  drawPanel(context, x, y, width, height, "left");
  drawSectionTitle(context, "本期重点书目", x + 26, y + 52);
  drawOpenBookWatermark(context, x + 232, y + 280, 210, 70);

  items.forEach((item, index) => {
    const top = y + 82 + index * 98;
    drawBookCover(context, palette, x + 28, top - 5, index);

    context.fillStyle = "#1f2d33";
    context.font = "800 23px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.label, x + 116, top + 24, width - 150, 28, 1);

    if (item.meta) {
      context.fillStyle = "#68736d";
      context.font = "400 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
      drawCanvasTextLimited(context, item.meta, x + 116, top + 56, width - 150, 22, 1);
    }

    context.strokeStyle = "rgba(202, 170, 104, 0.38)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x + 116, top + 76);
    context.lineTo(x + width - 44, top + 76);
    context.stroke();
    context.fillStyle = "rgba(202, 170, 104, 0.72)";
    context.beginPath();
    context.ellipse(x + width - 42, top + 76, 5, 5, 0, 0, Math.PI * 2);
    context.fill();
  });
}

function drawBookCover(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  index: number
) {
  const colors = [palette.accentDeep, "#d6cbb1", "#203c2f"];
  context.fillStyle = colors[index % colors.length] ?? palette.accentDeep;
  roundRect(context, x, y, 66, 78, 4);
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.16)";
  context.fillRect(x + 8, y, 7, 78);
  context.strokeStyle = "rgba(250, 247, 237, 0.44)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 22, y + 24);
  context.lineTo(x + 44, y + 24);
  context.moveTo(x + 22, y + 34);
  context.lineTo(x + 52, y + 34);
  context.stroke();

  context.strokeStyle = index === 1 ? "rgba(47, 83, 51, 0.46)" : "rgba(250, 247, 237, 0.62)";
  context.lineWidth = 1.3;
  context.beginPath();
  const stemX = x + 43;
  context.moveTo(stemX, y + 56);
  context.lineTo(stemX, y + 37);
  context.moveTo(stemX, y + 48);
  context.quadraticCurveTo(stemX - 13, y + 44, stemX - 15, y + 35);
  context.moveTo(stemX, y + 45);
  context.quadraticCurveTo(stemX + 12, y + 39, stemX + 14, y + 31);
  context.stroke();
}

function drawOpenBookWatermark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  context.strokeStyle = "rgba(63, 78, 70, 0.06)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(x, y + height);
  context.quadraticCurveTo(x + width * 0.26, y + 8, x + width / 2, y + height * 0.72);
  context.quadraticCurveTo(x + width * 0.74, y + 8, x + width, y + height);
  context.moveTo(x + width / 2, y + height * 0.72);
  context.lineTo(x + width / 2, y + height);
  context.moveTo(x + 26, y + height - 12);
  context.quadraticCurveTo(x + width * 0.27, y + 28, x + width / 2 - 8, y + height * 0.78);
  context.moveTo(x + width - 26, y + height - 12);
  context.quadraticCurveTo(x + width * 0.73, y + 28, x + width / 2 + 8, y + height * 0.78);
  context.stroke();
}

function drawCategorySection(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  drawPanel(context, x, y, width, height, "right");
  drawSectionTitle(context, "分类偏好", x + 30, y + 52);

  const topCategory = data.categories[0];
  const donutX = x + 132;
  const donutY = y + 160;
  drawCategoryDonut(context, palette, donutX, donutY, topCategory?.label ?? "阅读");

  data.categories.slice(0, 3).forEach((item, index) => {
    const barX = x + 244;
    const barY = y + 118 + index * 48;
    const barWidth = [150, 104, 72][index] ?? 72;
    context.fillStyle = "rgba(79, 119, 76, 0.16)";
    roundRect(context, barX, barY, 152, 14, 7);
    context.fill();
    context.fillStyle = index === 0 ? palette.accentDeep : palette.accentMid;
    roundRect(context, barX, barY, barWidth, 14, 7);
    context.fill();

    context.fillStyle = "#68736d";
    context.font = "400 15px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, item.meta ? `${item.label} · ${item.meta}` : item.label, barX, barY + 30, 154, 18, 1);
  });

  context.strokeStyle = "rgba(63, 78, 70, 0.22)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x + 24, y + 246);
  context.lineTo(x + width - 24, y + 246);
  context.stroke();

  drawSectionTitle(context, "本期关键词", x + 30, y + 296);
  drawKeywords(context, data.keywords, palette, x + 30, y + 318, width - 60);
}

function drawCategoryDonut(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  centerX: number,
  centerY: number,
  label: string
) {
  const segments = [
    { value: 0.62, color: palette.accentDeep },
    { value: 0.24, color: palette.accentMid },
    { value: 0.14, color: "rgba(79, 119, 76, 0.12)" }
  ];
  let start = -Math.PI / 2;

  segments.forEach((segment) => {
    const end = start + segment.value * Math.PI * 2;
    context.fillStyle = segment.color;
    context.beginPath();
    context.arc(centerX, centerY, 84, start, end);
    context.arc(centerX, centerY, 48, end, start, true);
    context.closePath();
    context.fill();
    start = end;
  });

  context.fillStyle = "#f6f1e4";
  context.beginPath();
  context.ellipse(centerX, centerY, 46, 46, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#1f2d33";
  context.font = "800 29px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  drawCanvasTextLimited(context, label, centerX, centerY + 10, 86, 32, 1);
  context.textAlign = "start";

  context.strokeStyle = "rgba(63, 78, 70, 0.10)";
  context.lineWidth = 1.3;
  context.beginPath();
  context.ellipse(centerX, centerY, 84, 84, 0, 0, Math.PI * 2);
  context.stroke();
}

function drawKeywords(
  context: CanvasRenderingContext2D,
  keywords: string[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  maxWidth: number
) {
  const fontSize = 14;
  const chipHeight = 28;
  const chipPaddingX = 11;
  const gapX = 7;
  const gapY = 7;
  const maxRows = 2;
  let offsetX = x;
  let offsetY = y;
  let row = 0;

  context.font = `800 ${fontSize}px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  for (const keyword of keywords.slice(0, 4)) {
    const chipWidth = Math.min(
      Math.ceil(context.measureText(keyword).width) + chipPaddingX * 2,
      maxWidth
    );
    if (offsetX + chipWidth > x + maxWidth) {
      offsetX = x;
      offsetY += chipHeight + gapY;
      row += 1;
    }

    if (row >= maxRows) {
      break;
    }

    context.fillStyle = palette.accentSoft;
    roundRect(context, offsetX, offsetY, chipWidth, chipHeight, chipHeight / 2);
    context.fill();
    context.fillStyle = palette.accentDeep;
    context.fillText(
      truncateCanvasText(context, keyword, chipWidth - chipPaddingX * 2),
      offsetX + chipPaddingX,
      offsetY + 20
    );
    offsetX += chipWidth + gapX;
  }
}

function drawPosterPersona(
  context: CanvasRenderingContext2D,
  data: MonthlyReportPosterData,
  personaImage: CanvasImageSource,
  archSceneImage: CanvasImageSource,
  propImage?: CanvasImageSource
) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);
  const panelX = 594;
  const panelY = 74;
  const panelWidth = 410;
  const panelHeight = 584;

  context.fillStyle = palette.accentSoft;
  drawArchPanel(context, panelX, panelY, panelWidth, panelHeight);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.18)";
  context.lineWidth = 1.5;
  drawArchPanel(context, panelX, panelY, panelWidth, panelHeight);
  context.stroke();

  context.save();
  drawArchPanel(context, panelX, panelY, panelWidth, panelHeight);
  context.clip();
  context.globalAlpha = 0.78;
  drawImageCover(context, archSceneImage, panelX, panelY, panelWidth, panelHeight);
  context.globalAlpha = 1;
  const sceneWash = context.createLinearGradient(panelX, panelY, panelX, panelY + panelHeight);
  sceneWash.addColorStop(0, "rgba(239, 234, 218, 0.58)");
  sceneWash.addColorStop(0.34, "rgba(246, 241, 228, 0.56)");
  sceneWash.addColorStop(0.62, "rgba(246, 241, 228, 0.14)");
  sceneWash.addColorStop(1, "rgba(239, 234, 218, 0.04)");
  context.fillStyle = sceneWash;
  context.fillRect(panelX, panelY, panelWidth, panelHeight);
  context.restore();

  context.fillStyle = "#1f2d33";
  context.font = "700 21px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  context.fillText(visual.code ? `${visual.code} 型读者` : "阅读人格画像", panelX + panelWidth / 2, panelY + 86);
  context.font = "700 48px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    formatMonthlyReportPosterPersonaTitle(data.persona.displayTitle, visual.typeLabel),
    panelX + panelWidth / 2,
    panelY + 148,
    panelWidth - 86,
    52,
    1
  );
  drawPersonaTitleRule(context, palette, panelX + panelWidth / 2, panelY + 172);
  context.fillStyle = "#66746e";
  context.font = "400 22px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    data.persona.suggestion ?? data.persona.basisNotice,
    panelX + panelWidth / 2,
    panelY + 208,
    panelWidth - 96,
    32,
    2
  );
  context.textAlign = "start";

  context.fillStyle = palette.accentMid;
  context.beginPath();
  context.ellipse(panelX + 212, panelY + 492, 132, 38, 0, 0, Math.PI * 2);
  context.fill();

  context.drawImage(personaImage, panelX + 24, panelY + 238, 372, 372);
  if (propImage) {
    context.drawImage(propImage, panelX + 306, panelY + 426, 110, 110);
  }
}

function drawPersonaTitleRule(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette,
  centerX: number,
  y: number
) {
  context.strokeStyle = "rgba(63, 78, 70, 0.22)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(centerX - 108, y);
  context.lineTo(centerX - 22, y);
  context.moveTo(centerX + 22, y);
  context.lineTo(centerX + 108, y);
  context.stroke();

  context.fillStyle = "rgba(202, 170, 104, 0.88)";
  context.beginPath();
  context.ellipse(centerX - 7, y, 4, 4, 0, 0, Math.PI * 2);
  context.ellipse(centerX + 7, y, 4, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.accentDeep;
}

function drawPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  side: "left" | "right"
) {
  context.fillStyle = "rgba(250, 247, 237, 0.54)";
  roundRect(context, x, y, width, height, side === "left" ? 28 : 0);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.24)";
  context.lineWidth = 1.5;
  roundRect(context, x, y, width, height, side === "left" ? 28 : 0);
  context.stroke();
}

function drawArchPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const radius = width / 2;
  context.beginPath();
  context.moveTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - 34);
  context.quadraticCurveTo(x + width, y + height, x + width - 34, y + height);
  context.lineTo(x + 34, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - 34);
  context.closePath();
}

function drawPosterFooter(context: CanvasRenderingContext2D) {
  context.strokeStyle = "rgba(63, 78, 70, 0.24)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(250, 1362);
  context.lineTo(410, 1362);
  context.moveTo(670, 1362);
  context.lineTo(830, 1362);
  context.stroke();

  context.fillStyle = "#68736d";
  context.font = "400 24px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  context.fillText("由 wxreadmaster 生成", POSTER_WIDTH / 2, 1372);
  context.textAlign = "start";
}

function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("加载阅读人格插画失败。"));
    image.src = src;
  });
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  imageSource: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const image = imageSource as HTMLImageElement;
  const sourceWidth = Number(image.naturalWidth || image.width || width);
  const sourceHeight = Number(image.naturalHeight || image.height || height);
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;

  if (sourceRatio > targetRatio) {
    const cropWidth = sourceHeight * targetRatio;
    const cropX = (sourceWidth - cropWidth) / 2;
    context.drawImage(imageSource, cropX, 0, cropWidth, sourceHeight, x, y, width, height);
    return;
  }

  const cropHeight = sourceWidth / targetRatio;
  const cropY = (sourceHeight - cropHeight) / 2;
  context.drawImage(imageSource, 0, cropY, sourceWidth, cropHeight, x, y, width, height);
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  wrapCanvasText(context, text, maxWidth).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function drawCanvasTextLimited(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const lines = wrapCanvasText(context, text, maxWidth);
  lines.slice(0, maxLines).forEach((line, index) => {
    const nextLine =
      index === maxLines - 1 && lines.length > maxLines ? truncateCanvasText(context, line, maxWidth) : line;
    context.fillText(nextLine, x, y + index * lineHeight);
  });
}

function truncateCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let result = text;
  while (result.length > 0 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return result ? `${result}…` : "…";
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];

  text.split("\n").forEach((paragraph) => {
    let line = "";
    Array.from(paragraph).forEach((char) => {
      const nextLine = `${line}${char}`;
      if (line && context.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = char;
        return;
      }

      line = nextLine;
    });

    if (line) {
      lines.push(line);
    }
  });

  return lines.length > 0 ? lines : [""];
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "reading-poster";
}

function categoryValue(category: ReadingStats["categories"][number]): number {
  return Math.max(
    0,
    category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0
  );
}
