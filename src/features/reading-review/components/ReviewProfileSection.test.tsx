import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingPersona } from "../../../lib/types";
import { ReviewProfileSection } from "./ReviewProfileSection";

describe("ReviewProfileSection", () => {
  it("renders a complete persona with dimensions, evidence, and suggestion", () => {
    const persona: ReadingPersona = {
      status: "complete",
      code: "INFJ",
      label: "历史共情者",
      displayTitle: "INFJ 型读者 · 历史共情者",
      paletteGroup: "NF",
      accentTone: "rose",
      basisNotice: "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。",
      dimensions: [
        {
          axis: "energy",
          key: "I",
          label: "主题深度",
          strength: "strong",
          basis: "分类和长读书目更集中。"
        },
        {
          axis: "information",
          key: "N",
          label: "概念想象",
          strength: "medium",
          basis: "历史和思想性内容占比较高。"
        }
      ],
      evidence: ["历史类投入最高。", "长读书目集中。"],
      summary: "这一周期的阅读更像围绕历史主线持续推进。",
      suggestion: "下个周期可以补一本文学短书做横向对照。"
    };

    const markup = renderToStaticMarkup(<ReviewProfileSection persona={persona} />);

    expect(markup).toContain("阅读人格 MBTI");
    expect(markup).toContain("INFJ 型读者 · 历史共情者");
    expect(markup).toContain("persona-illustration is-nf is-infj");
    expect(markup).toContain("INFJ · 档案地图");
    expect(markup).toContain("review-profile-dimensions");
    expect(markup).toContain("下个周期可以补一本文学短书做横向对照。");
  });

  it("renders insufficient personas as an empty state", () => {
    const persona: ReadingPersona = {
      status: "insufficient",
      basisNotice: "基于本周期阅读记录生成的阅读风格隐喻，不代表真实心理人格。",
      dimensions: [],
      evidence: [],
      summary: "本期阅读样本较少，继续阅读后再生成阅读人格。"
    };

    const markup = renderToStaticMarkup(<ReviewProfileSection persona={persona} />);

    expect(markup).toContain("本期阅读样本较少");
    expect(markup).not.toContain("INFJ");
  });
});
