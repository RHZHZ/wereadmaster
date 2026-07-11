import { describe, expect, test } from "vitest";
import { buildBookInsightViewModels } from "./book-insights";
import type { BookAiSummary } from "./types";

describe("book insights", () => {
  test("builds insight cards from focus, key ideas, quotes, and questions", () => {
    const insights = buildBookInsightViewModels(
      createSummary({
        keyIdeas: ["专注需要环境约束", "输出能反向强化理解"],
        myFocus: ["安排阅读时段", "把方法迁移到日常排期"],
        representativeQuotes: [
          quote("没有边界的工作会吞掉深度时间。", "说明用户关注环境约束。"),
          quote("输出会迫使理解变得具体。", "说明用户关注行动转化。")
        ],
        reflectionQuestions: ["下周最容易失守的干扰是什么？", "哪条规则值得继续执行？"]
      })
    );

    expect(insights).toHaveLength(2);
    expect(insights[0]).toMatchObject({
      id: "book-insight-1",
      title: "安排阅读时段",
      description: "专注需要环境约束"
    });
    expect(insights[0].sourceQuotes[0].quote).toBe("没有边界的工作会吞掉深度时间。");
    expect(insights[0].followUpQuestions).toContain("下周最容易失守的干扰是什么？");
  });

  test("falls back to key ideas when focus items are missing", () => {
    const insights = buildBookInsightViewModels(
      createSummary({
        keyIdeas: ["选择意味着放弃", "长期主义需要稳定反馈"],
        myFocus: [],
        representativeQuotes: [],
        reflectionQuestions: []
      })
    );

    expect(insights.map((insight) => insight.title)).toEqual([
      "选择意味着放弃",
      "长期主义需要稳定反馈"
    ]);
    expect(insights[0].description).toBe("长期主义需要稳定反馈");
  });

  test("deduplicates empty values and limits card count", () => {
    const insights = buildBookInsightViewModels(
      createSummary({
        keyIdeas: ["观点一", "观点二", "观点三", "观点四", "观点五"],
        myFocus: ["关注点", " ", "关注点", "另一个关注点"],
        representativeQuotes: [],
        reflectionQuestions: []
      }),
      1
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].title).toBe("关注点");
  });

  test("returns empty list without focus or key ideas", () => {
    const insights = buildBookInsightViewModels(
      createSummary({
        keyIdeas: [],
        myFocus: [],
        representativeQuotes: [quote("摘录", "理由")],
        reflectionQuestions: ["问题"]
      })
    );

    expect(insights).toEqual([]);
  });
});

function createSummary(
  overrides: Partial<Pick<BookAiSummary, "keyIdeas" | "myFocus" | "representativeQuotes" | "reflectionQuestions">>
): BookAiSummary {
  return {
    overview: "这份复盘基于当前书本地笔记生成。",
    keyIdeas: overrides.keyIdeas ?? [],
    myFocus: overrides.myFocus ?? [],
    actionItems: [],
    themeTags: [],
    representativeQuotes: overrides.representativeQuotes ?? [],
    reflectionQuestions: overrides.reflectionQuestions ?? [],
    sourceStats: {
      highlightCount: 0,
      thoughtCount: 0,
      bookmarkCount: 0,
      chapterCount: 0,
      includedHighlightCount: 0,
      includedThoughtCount: 0
    },
    generatedAt: "2026-07-11T00:00:00.000Z",
    promptVersion: "book-notes-summary-v3",
    basisNotice: "基于本地笔记生成。"
  };
}

function quote(text: string, reason: string) {
  return {
    quote: text,
    reason,
    chapter: "第一章",
    noteType: "划线"
  };
}

