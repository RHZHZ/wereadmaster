import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStats } from "../../lib/types";
import {
  buildLifetimeReadingReportData,
  downloadLifetimeReadingReportWide,
  shareLifetimeReadingReportWide
} from "./lifetime-reading-report";

const stats: ReadingStats = {
  mode: "overall",
  baseTime: 0,
  readDays: 128,
  totalReadTimeSeconds: 162_000,
  dayAverageReadTimeSeconds: 1_266,
  compare: 0,
  buckets: [
    { startTime: Math.floor(new Date(2022, 0, 1).getTime() / 1000), readTimeSeconds: 18_000 },
    { startTime: Math.floor(new Date(2023, 0, 1).getTime() / 1000), readTimeSeconds: 42_000 },
    { startTime: Math.floor(new Date(2024, 0, 1).getTime() / 1000), readTimeSeconds: 72_000 }
  ],
  longestItems: [
    {
      id: "book-1",
      title: "历史的温度 1",
      author: "张玮",
      type: "book",
      readTimeSeconds: 36_000,
      tags: ["历史", "人物"]
    },
    {
      id: "book-2",
      title: "历史的温度 2",
      author: "张玮",
      type: "book",
      readTimeSeconds: 18_000,
      tags: ["历史"]
    },
    {
      id: "book-3",
      title: "明朝那些事儿",
      author: "当年明月",
      type: "book",
      readTimeSeconds: 12_000,
      tags: ["历史"]
    }
  ],
  categories: [
    {
      categoryId: "history",
      title: "历史",
      parentTitle: "人文社科",
      readingTimeSeconds: 96_000,
      readingCount: 8
    },
    {
      categoryId: "literature",
      title: "文学",
      parentTitle: "小说",
      readingTimeSeconds: 32_000,
      readingCount: 4
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

describe("buildLifetimeReadingReportData", () => {
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
              callback(new Blob(["lifetime-report"], { type: "image/png" }))
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

    URL.createObjectURL = vi.fn(() => "blob:lifetime-report");
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

  it("derives a lifetime asset report from overall stats", () => {
    const result = buildLifetimeReadingReportData(stats);

    expect(result.reportType).toBe("overall");
    expect(result.periodAnchor).toBe("全部历史");
    expect(result.rangeLabel).toBe("长期阅读成果");
    expect(result.dataCompleteness).toBe("cached");
    expect(result.metrics[0]).toEqual({
      label: "累计时长",
      value: "45小时",
      detail: "长期投入资产"
    });
    expect(result.books[0]?.label).toBe("历史的温度 1");
    expect(result.categories[0]?.label).toBe("历史");
    expect(result.authors[0]?.label).toBe("张玮");
    expect(result.authors[0]?.meta).toContain("2 本");
    expect(result.keywords).toContain("长期成果");
    expect(result.yearSeries.map((point) => point.label)).toEqual(["2022", "2023", "2024"]);
    expect(result.peakYear).toBe("2024 年");
  });

  it("keeps AI copy as text enhancement without changing facts", () => {
    const result = buildLifetimeReadingReportData(stats, {
      aiReview: {
        overview: "AI 认为长期阅读已经形成历史主题主线。",
        nextActions: ["把历史书目整理成一条时间线。"],
        readingPersona: {
          summary: "AI 改写后的长期画像。",
          suggestion: "AI 建议补一本横向参照书。"
        }
      }
    });

    expect(result.summary).toBe("AI 认为长期阅读已经形成历史主题主线。");
    expect(result.persona.summary).toBe("AI 改写后的长期画像。");
    expect(result.suggestions).toContain("把历史书目整理成一条时间线。");
    expect(result.metrics[0]?.value).toBe("45小时");
    expect(result.peakYear).toBe("2024 年");
  });

  it("keeps empty lifetime report state explicit", () => {
    const emptyStats: ReadingStats = {
      mode: "overall",
      baseTime: 0,
      buckets: [],
      longestItems: [],
      categories: []
    };

    expect(buildLifetimeReadingReportData(emptyStats).dataCompleteness).toBe("empty");
    expect(
      buildLifetimeReadingReportData(emptyStats, { dataCompleteness: "unsynced" }).dataCompleteness
    ).toBe("unsynced");
  });

  it("exports the wide lifetime report as a png download", async () => {
    const data = buildLifetimeReadingReportData(stats);

    await downloadLifetimeReadingReportWide(data);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(anchorRemoveSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(mockCanvasContext.drawImage).toHaveBeenCalled();
    expect(createdAnchor.download).toBe(`${data.fileName}-16-9报告.png`);
    expect(createdAnchor.href).toBe("blob:lifetime-report");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:lifetime-report");
  });

  it("shares the wide lifetime report when the environment supports image sharing", async () => {
    installNavigatorMock({
      share: vi.fn().mockResolvedValue(undefined),
      canShare: vi.fn(() => true)
    } as unknown as Navigator);

    const data = buildLifetimeReadingReportData(stats);
    const result = await shareLifetimeReadingReportWide(data);

    expect(result).toEqual({
      fileName: `${data.fileName}-16-9报告.png`,
      source: "shareSheet"
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it("keeps dense lifetime report copy in canvas-safe text bounds", async () => {
    const data = buildLifetimeReadingReportData(stats);
    const longSuggestion =
      "为三条主线各设一个本季推进目标，把有声内容利用到预习复盘上，并针对文学的高数量低时长建立一套筛选规则。";
    data.summary =
      "你在「全部历史」累计阅读时长很长，整体呈现长期持续投入。年度节奏从 2019 年开始快速增长，在 2024";
    data.headline =
      "长期主线倾向「影视原著」，更接近 ENFJ 型读者 · 意义连接者，但还需要继续观察不同主题之间的平衡。";
    data.metrics[0] = { ...data.metrics[0], value: "1322小时9分钟" };
    data.categories[0] = { label: "影视原著", meta: "198小时3分钟" };
    data.categories[1] = { label: "计算机", meta: "167小时" };
    data.yearSeries[data.yearSeries.length - 1] = {
      label: "2024",
      meta: "290小时14分钟",
      value: 1_044_840
    };
    data.books[0] = {
      label: "有声内容",
      meta: "238小时54分钟"
    };
    data.books[1] = {
      label: "牧神记（同名国漫原著特别加长典藏版）",
      meta: "宅猪 · 113小时31分钟"
    };
    data.authors[0] = {
      label: "宅猪",
      meta: "1 本 · 113小时31分钟"
    };
    data.authors[2] = {
      label: "埃里克·马瑟斯",
      meta: "1 本 · 63小时15分钟"
    };
    data.suggestions = [
      longSuggestion,
      "把有声内容利用到预习和复盘上：听前列问题，听后补 3 条结构笔记。",
      "针对「文学」的高数量低时长，建立一条筛选规则，减少只打开不沉淀。"
    ];

    await downloadLifetimeReadingReportWide(data);

    const renderedText = vi.mocked(mockCanvasContext.fillText).mock.calls
      .map(([text]) => String(text));
    expect(renderedText).toContain("影视");
    expect(renderedText).toContain("原著");
    expect(renderedText).toContain("1322小时");
    expect(renderedText).toContain("198小时");
    expect(renderedText).toContain("2024 峰值");
    expect(renderedText).toContain("290小时");
    expect(renderedText.some((text) => text.includes("牧神记"))).toBe(true);
    expect(renderedText).not.toContain("牧神记（同名国漫原著特别加长典藏版）");
    expect(renderedText).not.toContain("1322小时9分钟");
    expect(renderedText).not.toContain("198小时3分钟");
    expect(renderedText).toContain("洞察 + 下一步");
    expect(renderedText).toContain("主线");
    expect(renderedText).toContain("节奏");
    expect(renderedText).toContain("副线");
    expect(renderedText).toContain("书目");
    expect(renderedText).toContain("作者");
    expect(renderedText).toContain("行动");
    expect(renderedText).toContain("「影视原著」已是稳定注意力资产。");
    expect(renderedText).toContain("2024 达到峰值，后续看复盘密度。");
    expect(renderedText).toContain("用「计算机」做参照，避免主线过窄。");
    expect(renderedText).toContain("从《有声内容》提炼可复用笔记。");
    expect(renderedText).toContain("宅猪形成作者信号，可延展同主题。");
    expect(renderedText).toContain("三条主题各选 1 本深读。");
    expect(renderedText).not.toContain(longSuggestion);
    expect(renderedText).not.toContain(data.summary);
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
