import type { AIAssetRefreshReason, AIAssetVersionDetail } from "./types";

export type AIAssetVersionChangeSummary = {
  title: string;
  items: string[];
};

export function buildAssetVersionChangeSummary(
  current: AIAssetVersionDetail,
  previous?: AIAssetVersionDetail
): AIAssetVersionChangeSummary | undefined {
  if (!previous || previous.inputHash === current.inputHash) {
    return undefined;
  }

  const items = [
    ...buildMetaChanges(current, previous),
    ...buildContentChanges(current, previous)
  ];

  if (items.length === 0) {
    return {
      title: "与上一版相比",
      items: ["本版与上一版的结构化内容没有明显变化。"]
    };
  }

  return {
    title: "与上一版相比",
    items
  };
}

export function assetRefreshReasonLabel(reason?: AIAssetRefreshReason): string {
  switch (reason) {
    case "completed":
      return "已读完";
    case "notes_changed":
      return "笔记变化";
    case "stalled":
      return "停滞较久";
    case "stage_changed":
      return "阅读阶段变化";
    default:
      return "无需更新";
  }
}

function buildMetaChanges(current: AIAssetVersionDetail, previous: AIAssetVersionDetail): string[] {
  const items: string[] = [];

  if (current.readingStageLabel && previous.readingStageLabel && current.readingStageLabel !== previous.readingStageLabel) {
    items.push(`阅读阶段：${previous.readingStageLabel} -> ${current.readingStageLabel}`);
  }

  if (
    typeof current.progress === "number" &&
    typeof previous.progress === "number" &&
    current.progress !== previous.progress
  ) {
    items.push(`阅读进度：${previous.progress}% -> ${current.progress}%`);
  }

  if (current.refreshReason !== previous.refreshReason) {
    items.push(
      `刷新原因：${assetRefreshReasonLabel(previous.refreshReason)} -> ${assetRefreshReasonLabel(current.refreshReason)}`
    );
  }

  if (current.promptVersion !== previous.promptVersion) {
    items.push(`Prompt：${previous.promptVersion} -> ${current.promptVersion}`);
  }

  return items;
}

function buildContentChanges(current: AIAssetVersionDetail, previous: AIAssetVersionDetail): string[] {
  if (current.feature === "reading-route" && current.readingRoute && previous.readingRoute) {
    return buildReadingRouteChanges(current, previous);
  }

  if (current.feature === "book-review" && current.bookSummary && previous.bookSummary) {
    return buildBookReviewChanges(current, previous);
  }

  return [];
}

function buildReadingRouteChanges(current: AIAssetVersionDetail, previous: AIAssetVersionDetail): string[] {
  const currentRoute = current.readingRoute;
  const previousRoute = previous.readingRoute;

  if (!currentRoute || !previousRoute) {
    return [];
  }

  const items: string[] = [];

  if (normalizeText(currentRoute.routeOverview) !== normalizeText(previousRoute.routeOverview)) {
    items.push("主线结论已更新。");
  }

  items.push(
    summarizeListDelta(
      "复盘点",
      currentRoute.reviewCheckpoints.map((item) => item.question),
      previousRoute.reviewCheckpoints.map((item) => item.question),
      "条"
    )
  );

  items.push(
    summarizeListDelta(
      "下一步行动",
      currentRoute.nextActions,
      previousRoute.nextActions,
      "条"
    )
  );

  return items.filter(Boolean);
}

function buildBookReviewChanges(current: AIAssetVersionDetail, previous: AIAssetVersionDetail): string[] {
  const currentSummary = current.bookSummary;
  const previousSummary = previous.bookSummary;

  if (!currentSummary || !previousSummary) {
    return [];
  }

  const items: string[] = [];

  if (normalizeText(currentSummary.overview) !== normalizeText(previousSummary.overview)) {
    items.push("复盘概览已更新。");
  }

  items.push(summarizeAddedOnlyDelta("主题标签", currentSummary.themeTags, previousSummary.themeTags, "个"));
  items.push(summarizeAddedOnlyDelta("关键观点", currentSummary.keyIdeas, previousSummary.keyIdeas, "条"));
  items.push(summarizeListDelta("下一步行动", currentSummary.actionItems, previousSummary.actionItems, "条"));
  items.push(summarizeListDelta("复盘问题", currentSummary.reflectionQuestions, previousSummary.reflectionQuestions, "条"));

  return items.filter(Boolean);
}

function summarizeListDelta(label: string, current: string[], previous: string[], unit: string): string {
  const currentSet = new Set(current.map(normalizeText).filter(Boolean));
  const previousSet = new Set(previous.map(normalizeText).filter(Boolean));
  const added = Array.from(currentSet).filter((item) => !previousSet.has(item)).length;
  const removed = Array.from(previousSet).filter((item) => !currentSet.has(item)).length;
  return `${label}：新增 ${added} ${unit}，移除 ${removed} ${unit}，当前共 ${currentSet.size} ${unit}。`;
}

function summarizeAddedOnlyDelta(label: string, current: string[], previous: string[], unit: string): string {
  const currentSet = new Set(current.map(normalizeText).filter(Boolean));
  const previousSet = new Set(previous.map(normalizeText).filter(Boolean));
  const added = Array.from(currentSet).filter((item) => !previousSet.has(item)).length;
  return `${label}：新增 ${added} ${unit}，当前共 ${currentSet.size} ${unit}。`;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
