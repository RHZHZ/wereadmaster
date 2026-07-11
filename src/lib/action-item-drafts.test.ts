import { describe, expect, test } from "vitest";
import { buildActionItemAssistantDraft } from "./action-item-drafts";

describe("action item assistant draft", () => {
  test("builds an action breakdown draft scoped to the current review", () => {
    const draft = buildActionItemAssistantDraft("整理 3 条气节相关摘录，写成一段个人判断。");

    expect(draft).toContain("下一步行动");
    expect(draft).toContain("当前复盘");
    expect(draft).toContain("阅读洞察");
    expect(draft).toContain("来源摘录");
    expect(draft).toContain("3 个执行步骤");
    expect(draft).toContain("最小可完成版本");
    expect(draft).not.toContain("生成 AI 复盘");
    expect(draft).not.toContain("生成正式复盘");
  });
});
