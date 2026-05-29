export type ExportAssetKind = "bookReview" | "bulkNotes";

export type ExportAssetBoundary = {
  kind: ExportAssetKind;
  title: string;
  summary: string;
  source: string;
  includes: string[];
  excludes: string[];
  behavior: string;
};

export const exportAssetBoundaries: Record<ExportAssetKind, ExportAssetBoundary> = {
  bookReview: {
    kind: "bookReview",
    title: "书籍复盘 Markdown",
    summary: "只导出本地已生成的 AI 复盘，不会静默生成、不请求远端笔记。",
    source: "本地 AI 复盘缓存和本地反馈状态",
    includes: ["复盘概览、关键观点、行动项和复盘问题", "可选行动反馈、复盘问题反馈和代表性摘录"],
    excludes: ["未生成复盘的书", "微信读书 API Key、AI API Key、数据库路径和原始接口响应"],
    behavior: "导出不会同步微信读书远端，也不会自动生成新的 AI 复盘。"
  },
  bulkNotes: {
    kind: "bulkNotes",
    title: "笔记与已生成复盘 Markdown",
    summary: "先预检本地缓存，再按用户选择的策略导出笔记和已有复盘。",
    source: "本地笔记概览、单本笔记缓存和已生成复盘缓存",
    includes: ["划线、想法/点评、章节分组和可导出笔记元信息", "本地已生成的书籍复盘缓存"],
    excludes: ["书签正文", "微信读书 API Key、AI API Key、数据库路径和原始接口响应"],
    behavior: "只有选择同步策略时才会按有界队列读取缺失书籍；不会自动生成 AI 复盘。"
  }
};

export function getExportAssetBoundary(kind: ExportAssetKind): ExportAssetBoundary {
  return exportAssetBoundaries[kind];
}
