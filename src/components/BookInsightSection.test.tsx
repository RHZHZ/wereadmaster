import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BookInsightSection, buildInsightDraft, buildInsightQuestionDraft } from "./BookInsightSection";
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
    expect(markup).toContain("围绕洞察追问");
    expect(markup).toContain("问这个问题");
  });

  test("keeps insight actions hidden when handler is omitted", () => {
    const markup = renderToStaticMarkup(<BookInsightSection summary={createSummary()} />);

    expect(markup).toContain("可继续追问");
    expect(markup).toContain("下周最容易失守的干扰是什么？");
    expect(markup).not.toContain("围绕洞察追问");
    expect(markup).not.toContain("问这个问题");
  });

  test("omits follow-up block when no reflection questions exist", () => {
    const markup = renderToStaticMarkup(
      <BookInsightSection
        summary={{
          ...createSummary(),
          reflectionQuestions: []
        }}
        onAskInsight={() => undefined}
      />
    );

    expect(markup).toContain("围绕洞察追问");
    expect(markup).not.toContain("可继续追问");
    expect(markup).not.toContain("问这个问题");
  });

  test("builds separated drafts for insight-level and question-level follow-ups", () => {
    expect(buildInsightDraft("安排阅读时段", "专注需要环境约束")).toBe(
      [
        "围绕这条阅读洞察继续追问：「安排阅读时段」。",
        "洞察说明：专注需要环境约束",
        "请结合当前复盘和来源摘录，说明这条洞察最值得继续展开的方向，并给出 3 个后续问题。"
      ].join("\n")
    );

    expect(
      buildInsightQuestionDraft("下周最容易失守的干扰是什么？", "安排阅读时段", "专注需要环境约束")
    ).toBe(
      [
        "围绕这个复盘问题继续追问：",
        "「下周最容易失守的干扰是什么？」",
        "",
        "关联洞察：「安排阅读时段」",
        "洞察说明：专注需要环境约束",
        "",
        "请结合当前复盘、阅读洞察和来源摘录回答，并给出 1 个最值得继续展开的方向。"
      ].join("\n")
    );
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
