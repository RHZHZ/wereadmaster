import type { BookNotes } from "../lib/types";

export type BookNotesReviewStatusTone = "ready" | "partial" | "empty";

export type BookNotesReviewStatus = {
  label: string;
  title: string;
  body: string;
  primaryMetricLabel: string;
  primaryMetricValue: number;
  secondaryMetricLabel: string;
  secondaryMetricValue: number;
  nextActionLabel: string;
  nextActionReason: string;
  tone: BookNotesReviewStatusTone;
};

export type BookNotesReviewStatusInput = Pick<
  BookNotes,
  "highlights" | "thoughts" | "exportableCount" | "chapterGroups"
>;

export function buildBookNotesReviewStatus(notes: BookNotesReviewStatusInput): BookNotesReviewStatus {
  const thoughtCount = notes.thoughts.length;
  const highlightCount = notes.highlights.length;
  const exportableCount = notes.exportableCount;
  const chapterGroupCount = notes.chapterGroups.length;

  if (thoughtCount > 0 && highlightCount > 0) {
    return {
      label: "适合复盘",
      title: "这本书已经有可整理输入",
      body: `已有划线和想法，覆盖 ${chapterGroupCount} 个章节分组，可以进入结构化复盘。`,
      primaryMetricLabel: "想法",
      primaryMetricValue: thoughtCount,
      secondaryMetricLabel: "划线",
      secondaryMetricValue: highlightCount,
      nextActionLabel: "AI 复盘",
      nextActionReason: "先把本书笔记整理成复盘文档，再决定是否标记已整理。",
      tone: "ready"
    };
  }

  if (thoughtCount > 0 || highlightCount > 0 || exportableCount > 0) {
    return {
      label: "可先整理",
      title: "已有材料但还不够丰满",
      body: buildPartialBody({ thoughtCount, highlightCount, exportableCount, chapterGroupCount }),
      primaryMetricLabel: thoughtCount > 0 ? "想法" : "划线",
      primaryMetricValue: thoughtCount > 0 ? thoughtCount : highlightCount,
      secondaryMetricLabel: "可导出",
      secondaryMetricValue: exportableCount,
      nextActionLabel: "查看章节",
      nextActionReason: "先确认哪些章节有材料；需要更完整时再补想法或进入 AI 复盘。",
      tone: "partial"
    };
  }

  return {
    label: "待积累",
    title: "还没有可复盘输入",
    body: "当前没有划线、想法或可导出内容，先继续阅读并留下材料。",
    primaryMetricLabel: "想法",
    primaryMetricValue: 0,
    secondaryMetricLabel: "划线",
    secondaryMetricValue: 0,
    nextActionLabel: "继续阅读",
    nextActionReason: "先在微信读书里积累划线或想法，稍后再回到这里整理。",
    tone: "empty"
  };
}

function buildPartialBody({
  thoughtCount,
  highlightCount,
  exportableCount,
  chapterGroupCount
}: {
  thoughtCount: number;
  highlightCount: number;
  exportableCount: number;
  chapterGroupCount: number;
}): string {
  if (thoughtCount > 0) {
    return `已有 ${thoughtCount} 条想法，覆盖 ${chapterGroupCount} 个章节分组，可以先围绕个人判断整理。`;
  }

  if (highlightCount > 0) {
    return `已有 ${highlightCount} 条划线，覆盖 ${chapterGroupCount} 个章节分组，适合先筛出关键摘录。`;
  }

  return `已有 ${exportableCount} 条可导出内容，可以先归档笔记，再补充复盘判断。`;
}
