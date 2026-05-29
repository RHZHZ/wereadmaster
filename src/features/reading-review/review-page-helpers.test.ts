import { describe, expect, it } from "vitest";
import {
  buildReviewTimelineInsights,
  type ReviewTimelineSegment
} from "./review-page-helpers";

describe("buildReviewTimelineInsights", () => {
  it("prefers keyword-aligned AI insights for matching segments", () => {
    const segments: ReviewTimelineSegment[] = [
      { anchorTime: 1, tone: "rise", title: "抬升段", description: "a" },
      { anchorTime: 2, tone: "peak", title: "高峰段", description: "b" },
      { anchorTime: 3, tone: "cooldown", title: "收束段", description: "c" }
    ];

    const result = buildReviewTimelineInsights(segments, [
      "这一段进入高峰，注意力明显集中。",
      "后段开始回落，节奏略有放缓。",
      "前段投入持续抬升。"
    ]);

    expect(result.segments[0]?.aiInsight).toContain("抬升");
    expect(result.segments[1]?.aiInsight).toContain("高峰");
    expect(result.segments[2]?.aiInsight).toContain("回落");
    expect(result.unmatchedInsights).toHaveLength(0);
  });

  it("falls back to sequence for unmatched insights and preserves extras", () => {
    const segments: ReviewTimelineSegment[] = [
      { anchorTime: 1, tone: "steady", title: "稳定段", description: "a" },
      { anchorTime: 2, tone: "steady", title: "稳定段", description: "b" }
    ];

    const result = buildReviewTimelineInsights(segments, [
      "这一段主要是碎片化阅读。",
      "第二段节奏更偏向通勤收听。",
      "还有一次短暂中断。"
    ]);

    expect(result.segments[0]?.aiInsight).toBe("这一段主要是碎片化阅读。");
    expect(result.segments[1]?.aiInsight).toBe("第二段节奏更偏向通勤收听。");
    expect(result.unmatchedInsights).toEqual(["还有一次短暂中断。"]);
  });

  it("uses position words to avoid same-tone segments being mismatched", () => {
    const segments: ReviewTimelineSegment[] = [
      { anchorTime: 1, tone: "steady", title: "稳定段", description: "a" },
      { anchorTime: 2, tone: "steady", title: "稳定段", description: "b" }
    ];

    const result = buildReviewTimelineInsights(segments, [
      "后段整体更平稳，情绪和投入都比较均匀。",
      "前段虽然碎片化，但节奏还算稳定。"
    ]);

    expect(result.segments[0]?.aiInsight).toContain("前段");
    expect(result.segments[1]?.aiInsight).toContain("后段");
    expect(result.unmatchedInsights).toHaveLength(0);
  });

  it("keeps overall observations as unmatched when stronger segment matches exist", () => {
    const segments: ReviewTimelineSegment[] = [
      { anchorTime: 1, tone: "rise", title: "抬升段", description: "a" },
      { anchorTime: 2, tone: "peak", title: "高峰段", description: "b" }
    ];

    const result = buildReviewTimelineInsights(segments, [
      "整体来看，这一周的阅读节奏比上周更集中。",
      "前段投入逐步抬升，进入状态较快。",
      "后段达到高峰，注意力明显集中。"
    ]);

    expect(result.segments[0]?.aiInsight).toContain("抬升");
    expect(result.segments[1]?.aiInsight).toContain("高峰");
    expect(result.unmatchedInsights).toEqual(["整体来看，这一周的阅读节奏比上周更集中。"]);
  });

  it("does not force overall summaries into remaining segments during fallback", () => {
    const segments: ReviewTimelineSegment[] = [
      { anchorTime: 1, tone: "rise", title: "抬升段", description: "a" },
      { anchorTime: 2, tone: "steady", title: "稳定段", description: "b" },
      { anchorTime: 3, tone: "cooldown", title: "收束段", description: "c" }
    ];

    const result = buildReviewTimelineInsights(segments, [
      "前段投入先抬升，进入状态很快。",
      "整体来看，这一阶段的阅读节奏比上期更集中。",
      "后段逐步收束，但整体没有突然掉下去。"
    ]);

    expect(result.segments[0]?.aiInsight).toContain("抬升");
    expect(result.segments[1]?.aiInsight).toBeUndefined();
    expect(result.segments[2]?.aiInsight).toContain("收束");
    expect(result.unmatchedInsights).toEqual(["整体来看，这一阶段的阅读节奏比上期更集中。"]);
  });
});
