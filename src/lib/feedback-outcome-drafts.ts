import type { FeedbackOutcomeSummary } from "./types";

export function buildFeedbackOutcomeAssistantDraft(summary: FeedbackOutcomeSummary): string {
  const changes = summary.appliedChanges?.slice(0, 3) ?? [];

  return [
    "围绕当前复盘中的反馈沉淀继续追问。",
    `反馈沉淀：${summary.summary}`,
    changes.length > 0 ? `本次吸收：${changes.join("；")}` : undefined,
    "请结合当前复盘，说明这次反馈沉淀最值得保留的判断，并给出 2 个后续追问和 1 个最小下一步行动。"
  ]
    .filter(Boolean)
    .join("\n");
}
