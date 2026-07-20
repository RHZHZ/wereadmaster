export type ReadingArtifactKind =
  | "notes-markdown"
  | "note-card-image"
  | "book-review-markdown"
  | "action-checklist"
  | "reflection-questions"
  | "reading-route-markdown"
  | "book-decision-markdown"
  | "period-report-image"
  | "lifetime-report-image";

type ArtifactMessageDetail = {
  fileName?: string;
  path?: string;
  count?: number;
  unit?: string;
};

export const readingArtifactLabels: Record<ReadingArtifactKind, string> = {
  "notes-markdown": "笔记归档",
  "note-card-image": "摘录卡片",
  "book-review-markdown": "复盘文档",
  "action-checklist": "行动清单",
  "reflection-questions": "复盘问题",
  "reading-route-markdown": "阅读处方",
  "book-decision-markdown": "下一本书决策",
  "period-report-image": "周期阅读报告",
  "lifetime-report-image": "长期复盘报告"
};

export function getReadingArtifactLabel(kind: ReadingArtifactKind): string {
  return readingArtifactLabels[kind];
}

export function formatArtifactCreatedMessage(
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  return formatArtifactMessage("已生成", kind, detail);
}

export function formatArtifactCopiedMessage(
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  return formatArtifactMessage("已复制", kind, detail);
}

export function formatArtifactSharedMessage(
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  return formatArtifactMessage("已打开分享", kind, detail);
}

export function formatArtifactSavedMessage(
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  return formatArtifactMessage("已保存到相册", kind, detail);
}

export function formatArtifactExportedMessage(
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  return formatArtifactMessage("已导出", kind, detail);
}

function formatArtifactMessage(
  verb: string,
  kind: ReadingArtifactKind,
  detail?: ArtifactMessageDetail
): string {
  const label = getReadingArtifactLabel(kind);
  const countSuffix = detail?.count ? `（${detail.count}${detail.unit ?? "项"}）` : "";
  const fileSuffix = detail?.fileName ? `（${detail.fileName}）` : "";
  const pathSuffix = detail?.path ? `，路径：${detail.path}` : "";

  return `${verb}：${label}${countSuffix || fileSuffix}${pathSuffix}`;
}
