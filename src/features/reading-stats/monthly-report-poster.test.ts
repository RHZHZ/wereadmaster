import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStats } from "../../lib/types";
import { buildReadingStatsPeriod } from "../../pages/reading-stats-period";
import {
  buildMonthlyReportPosterData,
  downloadMonthlyReportPoster,
  downloadMonthlyReportStoryPage,
  downloadMonthlyReportStoryPages,
  downloadMonthlyReportWideReport,
  shareMonthlyReportPoster,
  splitMonthlyReportPosterTitle
} from "./monthly-report-poster";

const stats: ReadingStats = {
  mode: "monthly",
  baseTime: 1_712_419_200,
  readDays: 9,
  totalReadTimeSeconds: 18_600,
  dayAverageReadTimeSeconds: 2_066,
  compare: 0.12,
  buckets: [
    { startTime: 1_712_505_600, readTimeSeconds: 6_000 },
    { startTime: 1_712_592_000, readTimeSeconds: 4_200 },
    { startTime: 1_712_678_400, readTimeSeconds: 8_400 }
  ],
  longestItems: [
    {
      id: "book-1",
      title: "历史的温度 1",
      author: "张玮",
      type: "book",
      readTimeSeconds: 7_200,
      tags: ["历史", "人物"]
    },
    {
      id: "book-2",
      title: "明朝那些事儿",
      author: "当年明月",
      type: "book",
      readTimeSeconds: 5_400,
      tags: ["历史"]
    }
  ],
  categories: [
    {
      categoryId: "history",
      title: "历史",
      parentTitle: "人文社科",
      readingTimeSeconds: 9_600,
      readingCount: 2
    },
    {
      categoryId: "literature",
      title: "文学",
      parentTitle: "小说",
      readingTimeSeconds: 4_800,
      readingCount: 1
    }
  ]
};

const mockGradient = {
  addColorStop: vi.fn()
};

const mockCanvasContext = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  clip: vi.fn(),
  closePath: vi.fn(),
  createLinearGradient: vi.fn(() => mockGradient),
  drawImage: vi.fn(),
  ellipse: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  measureText: vi.fn((value: string) => ({ width: value.length * 14 })),
  moveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  stroke: vi.fn()
} as unknown as CanvasRenderingContext2D;

const originalDocument = globalThis.document;
const originalImage = globalThis.Image;
const originalNavigator = globalThis.navigator;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let appendSpy: ReturnType<typeof vi.fn>;
let anchorClickSpy: ReturnType<typeof vi.fn>;
let anchorRemoveSpy: ReturnType<typeof vi.fn>;
let createdAnchor: { download: string; href: string };

describe("buildMonthlyReportPosterData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendSpy = vi.fn();
    anchorClickSpy = vi.fn();
    anchorRemoveSpy = vi.fn();
    createdAnchor = { download: "", href: "" };

    globalThis.document = {
      body: {
        append: appendSpy
      },
      createElement: vi.fn((tagName: string) => {
        if (tagName === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: vi.fn(() => mockCanvasContext),
            toBlob: vi.fn((callback: BlobCallback) =>
              callback(new Blob(["poster"], { type: "image/png" }))
            )
          };
        }

        if (tagName === "a") {
          return {
            get download() {
              return createdAnchor.download;
            },
            set download(value: string) {
              createdAnchor.download = value;
            },
            get href() {
              return createdAnchor.href;
            },
            set href(value: string) {
              createdAnchor.href = value;
            },
            click: anchorClickSpy,
            remove: anchorRemoveSpy
          };
        }

        throw new Error(`Unexpected element request: ${tagName}`);
      })
    } as unknown as Document;

    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;

    URL.createObjectURL = vi.fn(() => "blob:poster");
    URL.revokeObjectURL = vi.fn(() => undefined);
  });

  afterEach(() => {
    if (typeof originalDocument === "undefined") {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      globalThis.document = originalDocument;
    }

    if (typeof originalImage === "undefined") {
      Reflect.deleteProperty(globalThis, "Image");
    } else {
      globalThis.Image = originalImage;
    }

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    if (typeof originalNavigator === "undefined") {
      Reflect.deleteProperty(globalThis, "navigator");
    } else {
      installNavigatorMock(originalNavigator);
    }

    vi.restoreAllMocks();
  });

  it("derives monthly poster content from local stats", () => {
    const result = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    expect(result.title).toContain("阅读报告");
    expect(result.metrics).toHaveLength(3);
    expect(result.books[0]?.label).toBe("历史的温度 1");
    expect(result.categories[0]?.label).toBe("历史");
    expect(result.keywords).toContain("历史");
    expect(result.fileName).toContain("阅读海报");
  });

  it("exposes normalized metadata for the period report contract", () => {
    const result = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    expect(result.reportType).toBe("monthly");
    expect(result.periodAnchor).toBe(result.anchorLabel);
    expect(result.rangeLabel).toBe(result.title.replace(/\s*阅读报告$/, "").trim());
    expect(result.dataCompleteness).toBe("cached");
    expect(result.labels.headline).toBe(result.headline);
    expect(result.labels.summary).toBe(result.summary);
    expect(result.labels.keywords).toEqual(result.keywords);
    expect(result.labels.shareCaption).toContain(result.headline);
  });

  it("uses cached AI review copy when building period report labels", () => {
    const result = buildMonthlyReportPosterData(
      stats,
      buildReadingStatsPeriod("monthly", stats.baseTime),
      {
        aiReview: {
          overview: "AI 认为这一周期更像沿着历史主题持续推进。",
          nextActions: ["下期补一本同主题短书。"],
          readingPersona: {
            summary: "AI 改写后的本期阅读画像。",
            suggestion: "AI 建议把主题笔记沉淀成时间线。"
          }
        }
      }
    );

    expect(result.summary).toBe("AI 改写后的本期阅读画像。");
    expect(result.persona.summary).toBe("AI 改写后的本期阅读画像。");
    expect(result.persona.suggestion).toBe("AI 建议把主题笔记沉淀成时间线。");
    expect(result.labels.suggestions).toEqual([
      "下期补一本同主题短书。",
      "AI 建议把主题笔记沉淀成时间线。"
    ]);
  });

  it("keeps empty and future states explicit in report metadata", () => {
    const emptyStats: ReadingStats = {
      ...stats,
      readDays: undefined,
      totalReadTimeSeconds: undefined,
      dayAverageReadTimeSeconds: undefined,
      buckets: [],
      longestItems: [],
      categories: []
    };
    const futureBaseTime = Math.floor(new Date(2099, 0, 1).getTime() / 1000);

    expect(
      buildMonthlyReportPosterData(emptyStats, buildReadingStatsPeriod("monthly", stats.baseTime))
        .dataCompleteness
    ).toBe("empty");
    expect(
      buildMonthlyReportPosterData(
        emptyStats,
        buildReadingStatsPeriod("monthly", stats.baseTime),
        { dataCompleteness: "unsynced" }
      ).dataCompleteness
    ).toBe("unsynced");
    expect(
      buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", futureBaseTime))
        .dataCompleteness
    ).toBe("future_blocked");
    expect(
      buildMonthlyReportPosterData(emptyStats, buildReadingStatsPeriod("monthly", futureBaseTime))
        .dataCompleteness
    ).toBe("future_blocked");
  });

  it("derives period poster title from the selected stats period", () => {
    const result = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("annually", stats.baseTime));

    expect(result.title).toContain("年度阅读报告");
    expect(result.anchorLabel).toContain("年");
  });

  it("keeps annual report title subject readable after splitting the period anchor", () => {
    expect(splitMonthlyReportPosterTitle("2026 年度阅读报告", "2026 年")).toEqual({
      period: "2026 年",
      subject: "年度阅读报告"
    });
  });

  it("keeps poster keywords as short tags instead of evidence sentences", () => {
    const denseStats: ReadingStats = {
      ...stats,
      totalReadTimeSeconds: 8_580,
      readDays: 4,
      longestItems: [
        {
          id: "book-1",
          title: "崔永元：名师作文课（2册）",
          author: "崔永元等",
          type: "book",
          readTimeSeconds: 3_300,
          tags: ["教育学习"]
        }
      ],
      categories: [
        {
          categoryId: "education",
          title: "教育学习",
          parentTitle: "学习",
          readingTimeSeconds: 3_300,
          readingCount: 1
        }
      ]
    };

    const result = buildMonthlyReportPosterData(denseStats, buildReadingStatsPeriod("monthly", denseStats.baseTime));

    expect(result.keywords).toContain("教育学习");
    expect(result.keywords).toContain("少数主线");
    expect(result.keywords.join(" ")).not.toContain("是当前投入最多的主题");
    expect(result.keywords.join(" ")).not.toContain("占重点内容时长约");
    expect(result.keywords.every((keyword) => keyword.length <= 13)).toBe(true);
  });

  it("exports the poster as a png download", async () => {
    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    await downloadMonthlyReportPoster(data);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(3);
    expect(createdAnchor.download).toBe(`${data.fileName}.png`);
    expect(createdAnchor.href).toBe("blob:poster");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:poster");
  });

  it("shares the poster when the environment supports image sharing", async () => {
    installNavigatorMock({
      share: vi.fn().mockResolvedValue(undefined),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);

    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));
    const result = await shareMonthlyReportPoster(data);

    expect(result).toEqual({
      fileName: `${data.fileName}.png`,
      source: "shareSheet"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it("keeps long poster keywords inside compact chips", async () => {
    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));
    const longKeyword = "《崔永元：名师作文课（2册）》占重点内容时长约 40%";
    data.keywords = ["审美沉浸者", "教育学习 是当前投入最多的主题", longKeyword, "教育学习"];

    await downloadMonthlyReportPoster(data);

    const fillTextCalls = vi.mocked(mockCanvasContext.fillText).mock.calls;
    expect(fillTextCalls.some(([text]) => text === longKeyword)).toBe(false);
    expect(fillTextCalls.some(([text]) => typeof text === "string" && text.endsWith("…"))).toBe(true);
  });

  it("exports the wide report as a png download", async () => {
    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    await downloadMonthlyReportWideReport(data);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(2);
    expect(createdAnchor.download).toBe(`${data.fileName}-16-9报告.png`);
    expect(createdAnchor.href).toBe("blob:poster");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:poster");
  });

  it("exports the active story page as a png download", async () => {
    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    await downloadMonthlyReportStoryPage(data, 4);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(createdAnchor.download).toContain("轮播报告-05-AI-分析");
    expect(createdAnchor.download).toMatch(/\.png$/);
  });

  it("exports all story pages as separate png downloads", async () => {
    const data = buildMonthlyReportPosterData(stats, buildReadingStatsPeriod("monthly", stats.baseTime));

    await downloadMonthlyReportStoryPages(data);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(6);
    expect(anchorClickSpy).toHaveBeenCalledTimes(6);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(6);
    expect(appendSpy).toHaveBeenCalledTimes(6);
    expect(createdAnchor.download).toContain("轮播报告-06-下期行动");
  });
});

function installNavigatorMock(nextNavigator?: Navigator) {
  if (typeof nextNavigator === "undefined") {
    Reflect.deleteProperty(globalThis, "navigator");
    return;
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: nextNavigator,
    writable: true
  });
}
