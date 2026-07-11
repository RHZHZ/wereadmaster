import { describe, expect, test } from "vitest";
import { buildFeedbackOutcomeAssistantDraft } from "./feedback-outcome-drafts";

describe("feedback outcome assistant draft", () => {
  test("builds a follow-up draft that stays in current review context", () => {
    const draft = buildFeedbackOutcomeAssistantDraft({
      summary: "上一版已完成观点整理，本次改为压缩输出一页复盘。",
      appliedChanges: ["不再重复生成观点整理动作", "保留现实应用相关输出"]
    });

    expect(draft).toContain("当前复盘");
    expect(draft).toContain("反馈沉淀");
    expect(draft).toContain("本次吸收：不再重复生成观点整理动作；保留现实应用相关输出");
    expect(draft).toContain("2 个后续追问");
    expect(draft).toContain("1 个最小下一步行动");
    expect(draft).not.toContain("生成 AI 复盘");
    expect(draft).not.toContain("生成正式复盘");
  });
});
