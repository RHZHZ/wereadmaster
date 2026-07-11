import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BookInsightSection } from "./BookInsightSection";
import type { BookAiSummary } from "../lib/types";

describe("BookInsightSection", () => {
  test("renders insight cards and ask action when handler is provided", () => {
    const markup = renderToStaticMarkup(
      <BookInsightSection summary={createSummary()} onAskInsight={() => undefined} />
    );

    expect(markup).toContain("阅读洞察");
    expect(markup).toContain("安排阅读时段");
    expect(markup).toContain("来源摘录");
    expect(markup).toContain("可继续追问");
    expect(markup).toContain("追问");
  });

  test("renders nothing when summary cannot form insights", () => {
    const markup = renderToStaticMarkup(
      <BookInsightSection
        summary={{
          ...createSummary(),
          keyIdeas: [],
          myFocus: []
        }}
      />
    );

    expect(markup).toBe("");
  });
});

function createSummary(): BookAiSummary {
  return {
    overview: "这份复盘基于当前书本地笔记生成。",
    keyIdeas: ["专注需要环境约束"],
    myFocus: ["安排阅读时段"],
    actionItems: [],
    themeTags: [],
    representativeQuotes: [
      {
        quote: "没有边界的工作会吞掉深度时间。",
        reason: "说明用户关注环境约束。",
        chapter: "第一章",
        noteType: "划线"
      }
    ],
    reflectionQuestions: ["下周最容易失守的干扰是什么？"],
    sourceStats: {
      highlightCount: 1,
      thoughtCount: 0,
      bookmarkCount: 0,
      chapterCount: 1,
      includedHighlightCount: 1,
      includedThoughtCount: 0
    },
    generatedAt: "2026-07-11T00:00:00.000Z",
    promptVersion: "book-notes-summary-v3",
    basisNotice: "基于本地笔记生成。"
  };
}

