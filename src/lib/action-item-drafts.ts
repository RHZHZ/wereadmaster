export function buildActionItemAssistantDraft(actionItem: string): string {
  const trimmedAction = actionItem.trim();

  return [
    `围绕这条下一步行动继续拆解：「${trimmedAction}」。`,
    "请结合当前复盘、阅读洞察和来源摘录，给出 3 个执行步骤，并说明最小可完成版本。"
  ].join("\n");
}
