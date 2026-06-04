import {
  buildReadingPersona,
  extractRepresentativeThemes,
  resolveReadingPersona
} from "../../lib/business-rules";
import monthlyReportArchSceneSrc from "../../assets/generated/monthly-report-arch-scene.png";
import { formatDuration } from "../../lib/formatters";
import {
  getPersonaVisual,
  getPersonaVisualPalette,
  type PersonaVisualPalette
} from "../../lib/persona-visuals";
import type { ReadingPersona, ReadingPersonaPatch, ReadingStats } from "../../lib/types";
import {
  exportCanvasAsReportImage,
  type ReportImageExportResult
} from "./report-image-export";

export type LifetimeReadingReportCompleteness = "cached" | "empty" | "unsynced";

export type LifetimeReadingReportOptions = {
  aiReview?: {
    overview?: string;
    nextActions?: string[];
    readingPersona?: ReadingPersonaPatch;
  };
  dataCompleteness?: LifetimeReadingReportCompleteness;
};

export type LifetimeReadingReportMetric = {
  detail?: string;
  label: string;
  value: string;
};

export type LifetimeReadingReportItem = {
  label: string;
  meta?: string;
};

export type LifetimeReadingReportStrategyItem = {
  label: string;
  text: string;
};

export type LifetimeReadingReportSeriesPoint = {
  label: string;
  meta: string;
  value: number;
};

export type LifetimeReadingReportData = {
  reportType: "overall";
  periodAnchor: "全部历史";
  rangeLabel: "长期阅读成果";
  dataCompleteness: LifetimeReadingReportCompleteness;
  fileName: string;
  title: string;
  headline: string;
  summary: string;
  persona: ReadingPersona;
  metrics: LifetimeReadingReportMetric[];
  books: LifetimeReadingReportItem[];
  categories: LifetimeReadingReportItem[];
  authors: LifetimeReadingReportItem[];
  keywords: string[];
  suggestions: string[];
  yearSeries: LifetimeReadingReportSeriesPoint[];
  peakYear?: string;
};

type AuthorAggregate = {
  name: string;
  readTimeSeconds: number;
  count: number;
};

export function buildLifetimeReadingReportData(
  stats: ReadingStats,
  options: LifetimeReadingReportOptions = {}
): LifetimeReadingReportData {
  const persona = resolveReadingPersona(
    buildReadingPersona(stats),
    options.aiReview?.readingPersona
  );
  const sortedCategories = stats.categories
    .slice()
    .sort((left, right) => categoryValue(right) - categoryValue(left));
  const topCategory = sortedCategories[0];
  const books = stats.longestItems
    .slice()
    .sort((left, right) => right.readTimeSeconds - left.readTimeSeconds)
    .slice(0, 5)
    .map((item) => ({
      label: item.title,
      meta: [item.author, formatDuration(item.readTimeSeconds)].filter(Boolean).join(" · ")
    }));
  const categories = sortedCategories.slice(0, 5).map((item) => ({
    label: item.title,
    meta: formatDuration(categoryValue(item))
  }));
  const authors = buildAuthorAggregates(stats).slice(0, 5).map((item) => ({
    label: item.name,
    meta: `${item.count} 本 · ${formatDuration(item.readTimeSeconds)}`
  }));
  const representativeThemes = extractRepresentativeThemes(stats, 6);
  const yearSeries = buildYearSeries(stats);
  const peakYear = findPeakYear(yearSeries);
  const headline = buildLifetimeHeadline(persona, topCategory?.title);
  const summary = options.aiReview?.overview?.trim() || buildLifetimeSummary(stats, topCategory?.title, peakYear);
  const suggestions = buildLifetimeSuggestions(options.aiReview?.nextActions, persona.suggestion, topCategory?.title);
  const keywords = buildLifetimeKeywords(persona, representativeThemes);
  const dataCompleteness = options.dataCompleteness ?? (hasMeaningfulLifetimeStats(stats) ? "cached" : "empty");

  return {
    reportType: "overall",
    periodAnchor: "全部历史",
    rangeLabel: "长期阅读成果",
    dataCompleteness,
    fileName: sanitizeFileName("全部历史-长期阅读成果报告"),
    title: "长期阅读成果报告",
    headline,
    summary,
    persona,
    metrics: [
      { label: "累计时长", value: formatDuration(stats.totalReadTimeSeconds), detail: "长期投入资产" },
      { label: "阅读天数", value: `${stats.readDays ?? 0}天`, detail: "长期活跃记录" },
      { label: "代表方向", value: topCategory?.title ?? "等待积累", detail: "投入最高分类" },
      { label: "长读书目", value: `${stats.longestItems.length}本`, detail: "高投入内容" }
    ],
    books,
    categories,
    authors,
    keywords,
    suggestions,
    yearSeries,
    peakYear
  };
}

export async function downloadLifetimeReadingReportWide(
  data: LifetimeReadingReportData
): Promise<ReportImageExportResult> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前环境不支持长期复盘绘制。");
  }

  canvas.width = 1920;
  canvas.height = 1080;

  const visual = getPersonaVisual(data.persona);
  const [personaImage, propImage, archSceneImage] = await Promise.all([
    loadCanvasImage(visual.assetSrc),
    visual.propAssetSrc ? loadCanvasImage(visual.propAssetSrc) : Promise.resolve(undefined),
    loadCanvasImage(monthlyReportArchSceneSrc)
  ]);

  drawLifetimeReportCanvas(context, data, { archSceneImage, personaImage, propImage });
  return exportCanvasAsReportImage(canvas, `${data.fileName}-16-9报告`, "生成长期复盘失败。");
}

type LifetimeReportCanvasImages = {
  archSceneImage: CanvasImageSource;
  personaImage: CanvasImageSource;
  propImage?: CanvasImageSource;
};

type LifetimeCanvasTrendPoint = {
  x: number;
  y: number;
  source: LifetimeReadingReportSeriesPoint;
};

function drawLifetimeReportCanvas(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
  images: LifetimeReportCanvasImages
) {
  const visual = getPersonaVisual(data.persona);
  const palette = getPersonaVisualPalette(visual.tone);

  drawLifetimeReportBackground(context, palette);
  drawLifetimeReportCover(context, data, images, palette);
  drawLifetimeReportAnalysis(context, data, palette);
  drawLifetimeReportSidebar(context, data, palette);
}

function drawLifetimeReportBackground(
  context: CanvasRenderingContext2D,
  palette: PersonaVisualPalette
) {
  const gradient = context.createLinearGradient(0, 0, 1920, 1080);
  gradient.addColorStop(0, "#fbf7ec");
  gradient.addColorStop(0.52, palette.surface);
  gradient.addColorStop(1, "#f2eadc");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1920, 1080);

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
    context.lineTo(index * 112 + 280, 1080);
    context.stroke();
  }

  context.strokeStyle = "rgba(63, 78, 70, 0.14)";
  context.lineWidth = 1.5;
  roundRect(context, 46, 46, 1828, 988, 28);
  context.stroke();

  drawReportCorner(context, 70, 70, false);
  drawReportCorner(context, 1850, 1010, true);
}

function drawLifetimeReportCover(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
  images: LifetimeReportCanvasImages,
  palette: PersonaVisualPalette
) {
  const visual = getPersonaVisual(data.persona);
  const x = 82;
  const width = 478;
  const personaTitle = formatLifetimePersonaTitle(
    data.persona.displayTitle ?? data.persona.label,
    visual.typeLabel
  );

  drawWideColumnDivider(context, 590);

  context.fillStyle = palette.accentDeep;
  context.font = "800 30px Georgia, 'Noto Serif SC', 'Songti SC', serif";
  context.fillText("wxreadmaster 长期复盘", x, 132);

  context.fillStyle = "#1f2d33";
  context.font = "700 68px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, data.periodAnchor, x, 220, width - 32, 74, 1);
  context.font = "700 78px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif";
  drawCanvasTextLimited(context, "阅读成果", x, 302, width - 28, 84, 1);

  drawLifetimeArchImagePanel(
    context,
    x + 22,
    340,
    430,
    322,
    images.archSceneImage,
    images.personaImage,
    images.propImage,
    palette
  );

  context.fillStyle = palette.accentDeep;
  context.font = "800 31px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(
    context,
    `${visual.code ? `${visual.code} 型读者 · ` : ""}${personaTitle}`,
    x,
    726,
    width - 18,
    38,
    2
  );

  context.fillStyle = "#68736d";
  context.font = "400 22px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  drawCanvasTextLimited(context, compactLifetimeSummaryForCanvas(data), x, 800, width - 10, 34, 3);

  drawWideChips(context, data.keywords.slice(0, 4), palette, x, 928, width - 10, 30, 18);
}

function drawLifetimeReportAnalysis(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
  palette: PersonaVisualPalette
) {
  const x = 620;
  const width = 720;
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";

  drawWideColumnDivider(context, 1370);
  drawLifetimeMetrics(context, data.metrics.slice(0, 4), palette, x, 104, width);
  drawLifetimeTrendChart(context, data, palette, x, 318, width, 292);
  drawLifetimePreferenceSection(context, data, palette, x, 690, width, topCategory);
}

function drawLifetimeReportSidebar(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
  palette: PersonaVisualPalette
) {
  const x = 1408;
  const width = 424;
  const strategyItems = buildLifetimeReportStrategyItems(data);

  drawWideSectionTitle(context, "长期代表书目", x, 132);
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

  drawAuthorSignals(context, data.authors, palette, x, 548, width);
  drawLifetimeAdviceCard(
    context,
    strategyItems,
    palette,
    x,
    770,
    width,
    232
  );
}

function drawLifetimeMetrics(
  context: CanvasRenderingContext2D,
  metrics: LifetimeReadingReportMetric[],
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
      context.lineTo(x + itemWidth * index, y + 150);
      context.stroke();
    }

    drawMetricIcon(context, palette, centerX, y + 28, index);
    context.fillStyle = "#68736d";
    context.font = "800 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "center";
    context.fillText(metric.label, centerX, y + 78);

    const metricValue = compactCanvasMetricValue(metric.value);
    context.fillStyle = "#1f2d33";
    context.font = `800 ${metricValue.length > 5 ? 31 : 36}px 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif`;
    drawCanvasTextLimited(context, metricValue, centerX, y + 122, itemWidth - 18, 40, 1);

    context.fillStyle = "#68736d";
    context.font = "700 15px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, metric.detail ?? "", centerX, y + 150, itemWidth - 24, 18, 1);
    context.textAlign = "start";
  });

  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.beginPath();
  context.moveTo(x, y + 170);
  context.lineTo(x + width, y + 170);
  context.stroke();
}

function drawLifetimeTrendChart(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  drawWideSectionTitle(context, "年度投入走势", x, y);
  context.fillStyle = "#68736d";
  context.font = "700 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.textAlign = "right";
  context.fillText(data.peakYear ? `峰值 ${data.peakYear}` : "等待历史分布", x + width, y);
  context.textAlign = "start";

  const chartX = x + 4;
  const chartY = y + 48;
  const chartWidth = width - 26;
  const chartHeight = height - 72;
  const points = buildCanvasTrendPoints(data.yearSeries, chartX, chartY, chartWidth, chartHeight);
  const peakPoint = points.reduce<LifetimeCanvasTrendPoint | undefined>((current, point) => {
    if (!current || point.source.value > current.source.value) {
      return point;
    }

    return current;
  }, undefined);

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
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
      return;
    }
    context.lineTo(point.x, point.y);
  });
  context.stroke();

  points.forEach((point) => {
    const isPeak = point === peakPoint;
    context.fillStyle = "#f6f1e4";
    context.beginPath();
    context.ellipse(point.x, point.y, isPeak ? 8 : 5, isPeak ? 8 : 5, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.accentDeep;
    context.lineWidth = 2;
    context.stroke();
  });

  if (peakPoint) {
    context.strokeStyle = "rgba(63, 78, 70, 0.28)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(peakPoint.x, chartY + 12);
    context.lineTo(peakPoint.x, chartY + chartHeight + 8);
    context.stroke();

    drawTrendPeakLabel(
      context,
      `${peakPoint.source.label} · ${compactCanvasDurationText(peakPoint.source.meta)}`,
      peakPoint,
      palette,
      chartX,
      chartY,
      chartWidth,
      chartHeight
    );
  }

  context.fillStyle = "#68736d";
  context.font = "700 16px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  points.forEach((point, index) => {
    const shouldShow = index % 2 === 0 || points.length <= 5 || index === points.length - 1;
    if (shouldShow) {
      context.fillText(point.source.label, Math.max(chartX, point.x - 18), chartY + chartHeight + 36);
    }
  });
}

function drawLifetimePreferenceSection(
  context: CanvasRenderingContext2D,
  data: LifetimeReadingReportData,
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
  drawWideSectionTitle(context, "稳定分类偏好", x + 274, y + 30);

  data.categories.slice(0, 3).forEach((item, index) => {
    const rowY = y + 78 + index * 62;
    const barWidth = [180, 122, 86][index] ?? 72;
    context.fillStyle = "#1f2d33";
    context.font = "800 25px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
    drawCanvasTextLimited(context, item.label, x + 274, rowY, 116, 28, 1);
    context.fillStyle = "rgba(79, 119, 76, 0.15)";
    roundRect(context, x + 420, rowY - 18, 180, 15, 8);
    context.fill();
    context.fillStyle = index === 0 ? palette.accentDeep : palette.accentMid;
    roundRect(context, x + 420, rowY - 18, barWidth, 15, 8);
    context.fill();
    context.fillStyle = "#68736d";
    context.font = "700 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "right";
    context.fillText(compactCanvasDurationText(item.meta ?? ""), x + width, rowY);
    context.textAlign = "start";
  });
}

function drawReportCorner(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  inverted: boolean
) {
  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.3;
  context.beginPath();
  if (inverted) {
    context.moveTo(x - 44, y);
    context.lineTo(x, y);
    context.moveTo(x, y - 44);
    context.lineTo(x, y);
  } else {
    context.moveTo(x, y);
    context.lineTo(x + 44, y);
    context.moveTo(x, y);
    context.lineTo(x, y + 44);
  }
  context.stroke();
}

function drawWideColumnDivider(context: CanvasRenderingContext2D, x: number) {
  context.strokeStyle = "rgba(63, 78, 70, 0.20)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(x, 72);
  context.lineTo(x, 1008);
  context.stroke();
}

function drawWideSectionTitle(context: CanvasRenderingContext2D, title: string, x: number, y: number) {
  context.fillStyle = "#1f2d33";
  context.font = "800 34px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.fillText(title, x, y);
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
  } else if (index === 2) {
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
  } else {
    context.moveTo(centerX - 12, centerY + 8);
    context.lineTo(centerX - 4, centerY - 8);
    context.lineTo(centerX + 4, centerY + 8);
    context.lineTo(centerX + 12, centerY - 8);
  }
  context.stroke();
}

function drawLifetimeArchImagePanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  archSceneImage: CanvasImageSource,
  personaImage: CanvasImageSource,
  propImage: CanvasImageSource | undefined,
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
  context.fillStyle = palette.accentMid;
  context.beginPath();
  context.ellipse(x + width * 0.56, y + height - 34, 132, 38, 0, 0, Math.PI * 2);
  context.fill();
  context.drawImage(personaImage, x + 76, y + 6, 352, 352);
  if (propImage) {
    context.drawImage(propImage, x + 316, y + 214, 118, 118);
  }
  context.restore();

  context.strokeStyle = palette.accentMid;
  context.lineWidth = 2;
  drawArchPanel(context, x, y, width, height);
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

function drawWideBookRow(
  context: CanvasRenderingContext2D,
  item: LifetimeReadingReportItem,
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
  drawCanvasTextLimited(context, compactBookTitleForCanvas(item.label), x + 142, y + 36, width - 150, 30, 1);
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

function drawAuthorSignals(
  context: CanvasRenderingContext2D,
  items: LifetimeReadingReportItem[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number
) {
  drawWideSectionTitle(context, "偏好作者信号", x, y);
  const visibleItems = items.length > 0
    ? items.slice(0, 4)
    : [{ label: "等待作者信号", meta: "同步后生成" }];

  visibleItems.forEach((item, index) => {
    const top = y + 34 + index * 44;
    const text = item.meta ? `${item.label} · ${item.meta}` : item.label;
    context.fillStyle = "rgba(246, 241, 228, 0.66)";
    roundRect(context, x, top, width, 34, 14);
    context.fill();
    context.strokeStyle = palette.accentMid;
    context.lineWidth = 1;
    roundRect(context, x, top, width, 34, 14);
    context.stroke();
    context.fillStyle = palette.accentDeep;
    context.font = "800 18px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(context, text, x + 16, top + 23, width - 32, 20, 1);
  });
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

function drawLifetimeAdviceCard(
  context: CanvasRenderingContext2D,
  strategyItems: LifetimeReadingReportStrategyItem[],
  palette: PersonaVisualPalette,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const rowTop = y + 92;
  const rowGap = 23;
  const visibleItems = strategyItems.slice(0, 6);

  context.fillStyle = "rgba(250, 247, 237, 0.62)";
  roundRect(context, x, y, width, height, 24);
  context.fill();
  context.strokeStyle = "rgba(63, 78, 70, 0.18)";
  context.lineWidth = 1.2;
  roundRect(context, x, y, width, height, 24);
  context.stroke();

  context.fillStyle = palette.accentDeep;
  context.beginPath();
  context.ellipse(x + 42, y + 44, 24, 24, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f6f1e4";
  context.beginPath();
  context.ellipse(x + 42, y + 44, 10, 10, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#1f2d33";
  context.font = "800 28px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.fillText("长期阅读策略", x + 76, y + 50);
  context.fillStyle = "#68736d";
  context.font = "800 15px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.fillText("洞察 + 下一步", x + 76, y + 72);

  visibleItems.forEach((item, index) => {
    const itemY = rowTop + index * rowGap;
    if (itemY > y + height - 18) {
      return;
    }

    context.fillStyle = "rgba(121, 53, 86, 0.11)";
    roundRect(context, x + 28, itemY - 15, 46, 18, 9);
    context.fill();
    context.fillStyle = palette.accentDeep;
    context.font = "800 13px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.textAlign = "center";
    context.fillText(item.label, x + 51, itemY - 1);
    context.textAlign = "start";

    context.fillStyle = "#1f2d33";
    context.font = "800 15px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    drawCanvasTextLimited(
      context,
      compactLifetimeStrategyTextForCanvas(item.text),
      x + 84,
      itemY,
      width - 112,
      18,
      1
    );
  });
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
  context.font = "800 26px 'Noto Serif SC', 'Songti SC', 'SimSun', serif";
  context.textAlign = "center";
  splitDonutLabel(label).forEach((line, index, lines) => {
    const lineY = centerY + (index - (lines.length - 1) / 2) * 28 + 9;
    drawCanvasTextLimited(context, line, centerX, lineY, 76, 28, 1);
  });
  context.textAlign = "start";
}

function buildCanvasTrendPoints(
  series: LifetimeReadingReportSeriesPoint[],
  chartX: number,
  chartY: number,
  chartWidth: number,
  chartHeight: number
) {
  const visibleSeries = series.length > 0
    ? series
    : [{ label: "现在", meta: "等待同步", value: 0 }];
  const maxValue = Math.max(...visibleSeries.map((point) => point.value), 1);
  const denominator = Math.max(visibleSeries.length - 1, 1);

  return visibleSeries.map((point, index): LifetimeCanvasTrendPoint => ({
    x: chartX + (index / denominator) * chartWidth,
    y: chartY + chartHeight - 16 - (point.value / maxValue) * (chartHeight - 32),
    source: point
  }));
}

function drawTrendPeakLabel(
  context: CanvasRenderingContext2D,
  label: string,
  peakPoint: LifetimeCanvasTrendPoint,
  palette: PersonaVisualPalette,
  chartX: number,
  chartY: number,
  chartWidth: number,
  chartHeight: number
) {
  const [rawYear, rawValue] = label.split(" · ");
  const title = rawValue ? `${rawYear} 峰值` : label;
  const value = rawValue ?? "";
  const labelWidth = Math.min(
    Math.max(
      Math.ceil(context.measureText(title).width) + 26,
      value ? Math.ceil(context.measureText(value).width) + 26 : 0,
      112
    ),
    152
  );
  const labelHeight = value ? 46 : 28;
  const shouldPlaceLeft = peakPoint.x + labelWidth + 18 > chartX + chartWidth;
  const labelX = shouldPlaceLeft
    ? Math.max(chartX, peakPoint.x - labelWidth - 16)
    : Math.min(peakPoint.x + 16, chartX + chartWidth - labelWidth);
  const shouldPlaceBelow = peakPoint.y < chartY + chartHeight * 0.38;
  const labelTop = clamp(
    shouldPlaceBelow ? peakPoint.y + 18 : peakPoint.y - labelHeight - 12,
    chartY + 8,
    chartY + chartHeight - labelHeight - 8
  );

  context.fillStyle = "rgba(250, 247, 237, 0.72)";
  roundRect(context, labelX, labelTop, labelWidth, labelHeight, 14);
  context.fill();
  context.strokeStyle = palette.accentMid;
  context.lineWidth = 1;
  roundRect(context, labelX, labelTop, labelWidth, labelHeight, 14);
  context.stroke();

  context.fillStyle = palette.accentDeep;
  context.font = "800 17px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  context.textAlign = "center";
  context.fillText(title, labelX + labelWidth / 2, labelTop + 19);
  if (value) {
    context.fillStyle = "#68736d";
    context.font = "800 15px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    context.fillText(value, labelX + labelWidth / 2, labelTop + 37);
  }
  context.textAlign = "start";
}

function splitDonutLabel(label: string): string[] {
  const normalized = label.trim();
  if (!normalized) {
    return ["阅读"];
  }

  if (normalized.length <= 3) {
    return [normalized];
  }

  const suffixes = ["原著", "小说", "理财", "历史", "艺术", "科技", "文学"];
  const suffix = suffixes.find((item) => normalized.endsWith(item) && normalized.length > item.length);
  if (suffix) {
    return [normalized.slice(0, -suffix.length), suffix].filter(Boolean).slice(0, 2);
  }

  const splitIndex = Math.ceil(normalized.length / 2);
  return [normalized.slice(0, splitIndex), normalized.slice(splitIndex)].filter(Boolean).slice(0, 2);
}

function formatLifetimePersonaTitle(title: string | undefined, fallback: string): string {
  return (title ?? fallback).replace(/^[A-Z]{4}\s*型读者\s*[·:：-]\s*/, "").trim();
}

function compactReportLabel(value: string, maxLength = 12): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function compactCanvasMetricValue(value: string): string {
  return compactCanvasDurationText(value);
}

function compactCanvasDurationText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  return normalized.replace(/(\d+)小时\d+分钟/g, "$1小时");
}

export function buildLifetimeReportStrategyItems(
  data: LifetimeReadingReportData
): LifetimeReadingReportStrategyItem[] {
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const secondCategory = data.categories[1]?.label;
  const focusBook = compactBookTitleForCanvas(data.books[0]?.label ?? "代表书目");
  const topAuthor = data.authors[0]?.label;
  const peakPoint = data.yearSeries.reduce<LifetimeReadingReportSeriesPoint | undefined>(
    (current, point) => {
      if (!current || point.value > current.value) {
        return point;
      }

      return current;
    },
    undefined
  );
  const actionText = data.suggestions
    .map(compactAdviceItemForCanvas)
    .map(stripStrategyLabel)
    .find((item) => item.length > 0);

  return [
    {
      label: "主线",
      text: `「${compactReportLabel(topCategory, 8)}」已是稳定注意力资产。`
    },
    {
      label: "节奏",
      text: peakPoint
        ? `${peakPoint.label} 达到峰值，后续看复盘密度。`
        : "先补齐年度分布，再判断节奏峰谷。"
    },
    {
      label: "副线",
      text: secondCategory
        ? `用「${compactReportLabel(secondCategory, 8)}」做参照，避免主线过窄。`
        : "补 1 个低频主题，给长期偏好留参照。"
    },
    {
      label: "书目",
      text: `从《${compactReportLabel(focusBook, 9)}》提炼可复用笔记。`
    },
    {
      label: "作者",
      text: topAuthor
        ? `${compactReportLabel(topAuthor, 8)}形成作者信号，可延展同主题。`
        : "持续标记作者，识别真正复读信号。"
    },
    {
      label: "行动",
      text: actionText ?? `围绕「${compactReportLabel(topCategory, 6)}」选 1 本深读。`
    }
  ];
}

function compactAdviceItemForCanvas(value: string): string {
  let normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/（[^）]{8,}）/g, "")
    .replace(/\([^)]{8,}\)/g, "");

  if (/三条主线|本季推进目标/.test(normalized)) {
    return "主线：三条主题各选 1 本深读。";
  }

  if (/听前|听后|结构笔记|预习/.test(normalized)) {
    return "方法：听前列问题，听后补笔记。";
  }

  if (/高数量低时长|筛选规则|低时长/.test(normalized)) {
    return "结构：筛掉低沉淀短时长内容。";
  }

  normalized = normalized
    .replace(/，?每条只选\s*1\s*本[^。；;]*/g, "，每条只选 1 本深读")
    .replace(/听前列问题/g, "听前列问题")
    .replace(/听后补\s*3\s*条结构笔记/g, "听后补 3 条结构笔记");

  if (normalized.length > 36 && normalized.includes("，")) {
    const [firstClause] = normalized.split("，");
    if (firstClause.length >= 10) {
      normalized = `${firstClause}。`;
    }
  }

  return compactReportLabel(normalized, 24);
}

function stripStrategyLabel(value: string): string {
  return value.replace(/^(主线|证据|结构|方法|行动)[：:]\s*/, "");
}

function compactLifetimeStrategyTextForCanvas(value: string): string {
  return compactReportLabel(stripStrategyLabel(value), 24);
}

function compactBookTitleForCanvas(title: string): string {
  const normalized = title.trim();
  const bracketIndex = normalized.search(/[（(]/);
  if (bracketIndex > 1) {
    return normalized.slice(0, bracketIndex).trim();
  }

  if (normalized.length <= 18) {
    return normalized;
  }

  return normalized;
}

function compactLifetimeSummaryForCanvas(data: LifetimeReadingReportData): string {
  const duration = compactCanvasDurationText(data.metrics[0]?.value ?? "0分钟");
  const readDays = data.metrics[1]?.value ?? "0天";
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value;
  const parts = [
    `累计阅读 ${duration}，活跃 ${readDays}。`,
    topCategory ? `长期主线偏向「${compactReportLabel(topCategory, 10)}」。` : undefined,
    data.peakYear ? `${data.peakYear} 是目前的投入峰值。` : undefined
  ];

  return parts.filter((part): part is string => Boolean(part)).join("");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildAuthorAggregates(stats: ReadingStats): AuthorAggregate[] {
  const authors = new Map<string, AuthorAggregate>();
  stats.longestItems.forEach((item) => {
    const name = item.author?.trim();
    if (!name) {
      return;
    }

    const current = authors.get(name) ?? { name, readTimeSeconds: 0, count: 0 };
    current.readTimeSeconds += item.readTimeSeconds;
    current.count += 1;
    authors.set(name, current);
  });

  return Array.from(authors.values()).sort(
    (left, right) => right.readTimeSeconds - left.readTimeSeconds
  );
}

function buildYearSeries(stats: ReadingStats): LifetimeReadingReportSeriesPoint[] {
  const yearlyValues = new Map<number, number>();

  stats.buckets.forEach((bucket) => {
    if (bucket.readTimeSeconds <= 0) {
      return;
    }

    const year = new Date(bucket.startTime * 1000).getFullYear();
    yearlyValues.set(year, (yearlyValues.get(year) ?? 0) + bucket.readTimeSeconds);
  });

  return Array.from(yearlyValues.entries())
    .sort(([leftYear], [rightYear]) => leftYear - rightYear)
    .slice(-8)
    .map(([year, value]) => ({
      label: String(year),
      meta: formatDuration(value),
      value
    }));
}

function buildLifetimeHeadline(persona: ReadingPersona, topCategoryTitle?: string): string {
  const personaLabel = persona.displayTitle ?? persona.label;
  if (topCategoryTitle) {
    return `长期主线偏向「${topCategoryTitle}」，更接近${personaLabel}`;
  }

  return `长期阅读信号更接近${personaLabel}`;
}

function buildLifetimeSummary(
  stats: ReadingStats,
  topCategoryTitle: string | undefined,
  peakYear: string | undefined
): string {
  const parts = [
    `累计投入 ${formatDuration(stats.totalReadTimeSeconds)}，记录 ${stats.readDays ?? 0} 个阅读日。`,
    topCategoryTitle ? `长期注意力最明显地落在「${topCategoryTitle}」。` : "长期偏好仍在积累中。",
    peakYear ? `${peakYear} 是目前最突出的投入峰值。` : "年度峰值需要更多历史分布数据确认。"
  ];

  return parts.join("");
}

function buildLifetimeSuggestions(
  nextActions: string[] | undefined,
  personaSuggestion: string | undefined,
  topCategoryTitle: string | undefined
): string[] {
  const fallback = [
    topCategoryTitle ? `围绕「${topCategoryTitle}」整理一份长期主题书单。` : "先补齐长期高投入书目的主题标签。",
    "挑一个低频但重要的主题，作为下一阶段的结构补充。",
    "从长读书目里选 3 本，沉淀可复用笔记或阅读路线。"
  ];
  const values = [...(nextActions ?? []), personaSuggestion, ...fallback]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  return Array.from(new Set(values)).slice(0, 5);
}

function buildLifetimeKeywords(persona: ReadingPersona, themes: string[]): string[] {
  const values = [
    persona.displayTitle ?? persona.label,
    ...themes,
    "长期成果",
    "稳定偏好"
  ];

  return Array.from(
    new Set(
      values
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim())
    )
  ).slice(0, 8);
}

function findPeakYear(yearSeries: LifetimeReadingReportSeriesPoint[]): string | undefined {
  const peak = yearSeries.reduce<LifetimeReadingReportSeriesPoint | undefined>((current, point) => {
    if (!current || point.value > current.value) {
      return point;
    }

    return current;
  }, undefined);

  return peak ? `${peak.label} 年` : undefined;
}

function hasMeaningfulLifetimeStats(stats: ReadingStats): boolean {
  return Boolean(
    (stats.totalReadTimeSeconds ?? 0) > 0 ||
      (stats.readDays ?? 0) > 0 ||
      stats.buckets.length > 0 ||
      stats.longestItems.length > 0 ||
      stats.categories.length > 0
  );
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
      index === maxLines - 1 && lines.length > maxLines ? ellipsizeCanvasText(context, line, maxWidth) : line;
    context.fillText(nextLine, x, y + index * lineHeight);
  });
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];

  let line = "";
  Array.from(text).forEach((char) => {
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

  return lines.length > 0 ? lines : [""];
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

function ellipsizeCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  let result = text;
  while (result.length > 0 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }

  return result ? `${result}…` : "…";
}

function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("加载长期复盘插画失败。"));
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

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "reading-report";
}

function categoryValue(category: ReadingStats["categories"][number]): number {
  return Math.max(
    0,
    category.readingTimeSeconds ?? category.value ?? category.readingCount ?? 0
  );
}
