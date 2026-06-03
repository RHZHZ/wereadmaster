import { formatAiTimestamp, formatProgress } from "./formatters";
import type {
  LocalReaderAiQuestionDraft,
  LocalReaderAiQuestionRecord
} from "./local-reader-ai-drafts";
import type { LocalReaderHighlight, LocalReaderHighlightTone } from "./local-reader-highlights";
import type { LocalReaderThought } from "./local-reader-thoughts";
import type { LocalBook, LocalReadingProgress } from "./local-reader-types";

export type LocalReaderMarkdownInput = {
  book: LocalBook;
  highlights: LocalReaderHighlight[];
  thoughts: LocalReaderThought[];
  aiQuestionDraft?: LocalReaderAiQuestionDraft;
  aiQuestionRecords?: LocalReaderAiQuestionRecord[];
  progress?: LocalReadingProgress;
  exportedAt?: string;
};

export type LocalReaderMarkdownExport = {
  fileName: string;
  markdown: string;
};

export function buildLocalReaderMarkdownExport(
  input: LocalReaderMarkdownInput
): LocalReaderMarkdownExport {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const fileName = `${sanitizeLocalReaderFileName(input.book.title)}-本地标记.md`;
  const lines = [
    "---",
    "source: local-reader",
    `source_kind: ${input.book.source}`,
    `book_id: ${quoteFrontMatter(input.book.id)}`,
    `title: ${quoteFrontMatter(input.book.title)}`,
    `author: ${quoteFrontMatter(input.book.author || "未知作者")}`,
    `format: ${input.book.format}`,
    `file_hash: ${quoteFrontMatter(input.book.fileHash)}`,
    `progress: ${Math.trunc(input.progress?.progressPercent ?? 0)}`,
    `exported_at: ${quoteFrontMatter(exportedAt)}`,
    "---",
    "",
    `# ${input.book.title}`,
    "",
    "- 来源：本地书库",
    `- 作者：${input.book.author || "未知作者"}`,
    `- 格式：${formatLocalReaderBookFormat(input.book.format)}`,
    `- 阅读进度：${formatProgress(input.progress?.progressPercent ?? 0)}`,
    `- 导出时间：${formatAiTimestamp(exportedAt) || exportedAt}`,
    "- 数据边界：仅包含本地阅读器划线、想法和 AI 提问记录，不读取微信读书笔记，不触发 AI。",
    "",
    buildHighlightSection(input.highlights),
    "",
    buildThoughtSection(input.thoughts),
    "",
    buildAiQuestionRecordSection(input.aiQuestionRecords, input.aiQuestionDraft)
  ];

  return {
    fileName,
    markdown: lines.join("\n")
  };
}

function formatLocalReaderBookFormat(format: LocalBook["format"]): string {
  if (format === "markdown") {
    return "Markdown";
  }

  return format.toUpperCase();
}

export function downloadLocalReaderMarkdownFile(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildHighlightSection(highlights: LocalReaderHighlight[]): string {
  if (highlights.length === 0) {
    return ["## 划线", "", "暂无本地划线。"].join("\n");
  }

  return [
    "## 划线",
    "",
    ...highlights.flatMap((highlight, index) => [
      `### ${index + 1}. ${highlightToneLabel(highlight.tone)}`,
      "",
      blockquote(highlight.text),
      "",
      `- 位置：${highlight.startOffset}-${highlight.endOffset}`,
      `- 时间：${formatAiTimestamp(highlight.createdAt) || highlight.createdAt}`,
      ""
    ])
  ].join("\n").trimEnd();
}

function buildThoughtSection(thoughts: LocalReaderThought[]): string {
  if (thoughts.length === 0) {
    return ["## 想法", "", "暂无本地想法。"].join("\n");
  }

  return [
    "## 想法",
    "",
    ...thoughts.flatMap((thought, index) => [
      `### ${index + 1}. 想法`,
      "",
      "**原文**",
      "",
      blockquote(thought.selectedText),
      "",
      "**想法**",
      "",
      thought.note,
      "",
      `- 位置：${thought.startOffset}-${thought.endOffset}`,
      `- 时间：${formatAiTimestamp(thought.createdAt) || thought.createdAt}`,
      ""
    ])
  ].join("\n").trimEnd();
}

function buildAiQuestionRecordSection(
  aiQuestionRecords: LocalReaderAiQuestionRecord[] | undefined,
  aiQuestionDraft: LocalReaderAiQuestionDraft | undefined
): string {
  const records = aiQuestionRecords?.length ? aiQuestionRecords : [];
  if (records.length === 0 && !aiQuestionDraft) {
    return ["## AI 提问记录", "", "暂无本地 AI 提问记录。"].join("\n");
  }

  return [
    "## AI 提问记录",
    "",
    ...(records.length > 0
      ? records.flatMap((record, index) => buildAiQuestionRecordLines(record, index))
      : buildLegacyAiQuestionDraftLines(aiQuestionDraft))
  ].join("\n").trimEnd();
}

function buildAiQuestionRecordLines(
  record: LocalReaderAiQuestionRecord,
  index: number
): string[] {
  return [
    `### ${index + 1}. ${aiQuestionStatusLabel(record.status)}`,
    "",
    "**选中文本**",
    "",
    blockquote(record.selectedText),
    "",
    "**问题**",
    "",
    record.question,
    "",
    ...(record.answer
      ? [
          "**回答**",
          "",
          record.answer.answer,
          "",
          ...buildAiQuestionKeyPointLines(record),
          ...buildAiQuestionFollowUpLines(record)
        ]
      : []),
    ...(record.errorMessage ? ["**错误**", "", record.errorMessage, ""] : []),
    ...buildAiQuestionThreadLines(record),
    `- 状态：${aiQuestionStatusLabel(record.status)}`,
    `- 位置：${record.startOffset}-${record.endOffset}`,
    `- 时间：${formatAiTimestamp(record.createdAt) || record.createdAt}`,
    ...(record.answer?.basisNotice ? [`- 依据：${record.answer.basisNotice}`] : []),
    "- 边界：仅导出本地 AI 提问记录，不读取微信读书笔记，不触发新的 AI 请求。",
    ""
  ];
}

function buildAiQuestionThreadLines(record: LocalReaderAiQuestionRecord): string[] {
  if (!record.thread?.length) {
    return [];
  }

  return [
    "**追问线程**",
    "",
    ...record.thread.flatMap((turn, index) => [
      `#### 追问 ${index + 1}. ${aiQuestionStatusLabel(turn.status)}`,
      "",
      "**问题**",
      "",
      turn.question,
      "",
      ...(turn.answer ? ["**回答**", "", turn.answer.answer, ""] : []),
      ...(turn.errorMessage ? ["**错误**", "", turn.errorMessage, ""] : []),
      `- 时间：${formatAiTimestamp(turn.updatedAt || turn.createdAt) || turn.updatedAt || turn.createdAt}`,
      ""
    ])
  ];
}

function buildLegacyAiQuestionDraftLines(
  aiQuestionDraft: LocalReaderAiQuestionDraft | undefined
): string[] {
  if (!aiQuestionDraft) {
    return [];
  }

  return [
    "### 1. 草稿",
    "",
    "**选中文本**",
    "",
    blockquote(aiQuestionDraft.selectedText),
    "",
    "**问题**",
    "",
    aiQuestionDraft.question,
    "",
    `- 状态：草稿`,
    `- 位置：${aiQuestionDraft.startOffset}-${aiQuestionDraft.endOffset}`,
    `- 时间：${formatAiTimestamp(aiQuestionDraft.createdAt) || aiQuestionDraft.createdAt}`,
    "- 边界：仅导出本地草稿，不代表模型已回答，也不会触发 AI 请求。"
  ];
}

function buildAiQuestionKeyPointLines(record: LocalReaderAiQuestionRecord): string[] {
  if (!record.answer?.keyPoints.length) {
    return [];
  }

  return [
    "**要点**",
    "",
    ...record.answer.keyPoints.map((point) => `- ${point}`),
    ""
  ];
}

function buildAiQuestionFollowUpLines(record: LocalReaderAiQuestionRecord): string[] {
  if (!record.answer?.followUpQuestions.length) {
    return [];
  }

  return [
    "**追问**",
    "",
    ...record.answer.followUpQuestions.map((question) => `- ${question}`),
    ""
  ];
}

function aiQuestionStatusLabel(status: LocalReaderAiQuestionRecord["status"]): string {
  if (status === "answered") {
    return "已回答";
  }

  if (status === "pending") {
    return "生成中";
  }

  if (status === "failed") {
    return "失败";
  }

  return "草稿";
}

function blockquote(value: string): string {
  const lines = value.trim().split(/\r?\n/);
  return lines.map((line) => `> ${line || " "}`).join("\n");
}

function highlightToneLabel(tone: LocalReaderHighlightTone): string {
  if (tone === "green") {
    return "标记";
  }

  if (tone === "blue") {
    return "疑问";
  }

  return "划线";
}

function quoteFrontMatter(value: string): string {
  return JSON.stringify(value);
}

function sanitizeLocalReaderFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 48) || "local-reader";
}
