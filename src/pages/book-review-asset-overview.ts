import { calculateTotalNotes } from "../lib/business-rules";
import type { BookAiSummaryListItem, NotebookBook } from "../lib/types";

export type BookReviewAssetOverviewTone = "active" | "complete" | "empty";
export type BookReviewAssetOverviewActionTarget = "candidate" | "summary" | "notes";

export type BookReviewAssetOverview = {
  label: string;
  title: string;
  body: string;
  generatedCount: number;
  pendingCount: number;
  pendingCountLabel?: string;
  feedbackCount: number;
  nextActionLabel: string;
  nextActionTitle: string;
  nextActionReason: string;
  nextActionButtonLabel: string;
  nextActionTarget: BookReviewAssetOverviewActionTarget;
  nextActionBookId?: string;
  tone: BookReviewAssetOverviewTone;
};

export type BookReviewAssetOverviewInput = {
  summaries: BookAiSummaryListItem[];
  candidates: NotebookBook[];
  candidateIndexLoading?: boolean;
};

export function buildBookReviewAssetOverview({
  summaries,
  candidates,
  candidateIndexLoading = false
}: BookReviewAssetOverviewInput): BookReviewAssetOverview {
  const generatedCount = summaries.length;
  const pendingCount = candidates.length;
  const feedbackCount = summaries.filter((item) => item.feedbackCount > 0).length;
  const topCandidate = candidates[0];
  const topSummary = summaries.find((item) => item.feedbackCount > 0) ?? summaries[0];

  if (topCandidate) {
    return {
      label: "复盘进行中",
      title: "还有书可以生成阅读报告",
      body: `已生成 ${generatedCount} 本，待整理 ${pendingCount} 本；先处理信号最强的一本，避免笔记停在列表里。`,
      generatedCount,
      pendingCount,
      feedbackCount,
      nextActionLabel: "优先生成",
      nextActionTitle: `《${topCandidate.title}》`,
      nextActionReason: buildCandidateReason(topCandidate),
      nextActionButtonLabel: "开始复盘",
      nextActionTarget: "candidate",
      nextActionBookId: topCandidate.bookId,
      tone: "active"
    };
  }

  if (candidateIndexLoading && topSummary) {
    return {
      label: "复盘缓存可用",
      title: "正在更新待生成复盘的判断",
      body: `已先展示 ${generatedCount} 本已生成复盘；本地笔记索引读取完成后，会更新待生成书籍数量。`,
      generatedCount,
      pendingCount,
      pendingCountLabel: "判断中",
      feedbackCount,
      nextActionLabel: "先回看",
      nextActionTitle: `回看《${topSummary.title}》`,
      nextActionReason:
        topSummary.feedbackCount > 0
          ? `这本复盘已有 ${topSummary.feedbackCount} 条反馈，可以先确认行动完成情况。`
          : "候选判断还在更新，可以先查看或导出已生成复盘。",
      nextActionButtonLabel: "查看复盘",
      nextActionTarget: "summary",
      nextActionBookId: topSummary.bookId,
      tone: "complete"
    };
  }

  if (candidateIndexLoading) {
    return {
      label: "索引更新中",
      title: "正在读取本地笔记索引",
      body: "正在判断哪些书适合生成复盘；读取完成后会更新待生成书籍数量。",
      generatedCount,
      pendingCount,
      pendingCountLabel: "判断中",
      feedbackCount,
      nextActionLabel: "先同步",
      nextActionTitle: "本地笔记索引",
      nextActionReason: "读取完成后，会显示适合生成复盘的书。",
      nextActionButtonLabel: "去笔记中心",
      nextActionTarget: "notes",
      tone: "empty"
    };
  }

  if (topSummary) {
    return {
      label: "复盘已生成",
      title: "当前没有待生成复盘的书",
      body: `已生成 ${generatedCount} 本复盘，其中 ${feedbackCount} 本有本地反馈；可以回看、导出或继续在单本页更新。`,
      generatedCount,
      pendingCount,
      feedbackCount,
      nextActionLabel: "继续使用",
      nextActionTitle: `回看《${topSummary.title}》`,
      nextActionReason:
        topSummary.feedbackCount > 0
          ? `这本复盘已有 ${topSummary.feedbackCount} 条反馈，适合先确认行动完成情况。`
          : "从已生成复盘里挑一本，确认结论是否仍然可用。",
      nextActionButtonLabel: "查看复盘",
      nextActionTarget: "summary",
      nextActionBookId: topSummary.bookId,
      tone: "complete"
    };
  }

  return {
    label: "待生成",
    title: "还没有可用的书籍复盘",
    body: "先同步笔记或进入一本有笔记的书手动生成复盘，这里才会出现可回看和导出的结果。",
    generatedCount,
    pendingCount,
    feedbackCount,
    nextActionLabel: "先同步",
    nextActionTitle: "去笔记中心积累输入",
    nextActionReason: "没有已生成复盘，也没有候选书时，先补齐本地笔记索引。",
    nextActionButtonLabel: "去笔记中心",
    nextActionTarget: "notes",
    tone: "empty"
  };
}

function buildCandidateReason(book: NotebookBook): string {
  const totalNotes = calculateTotalNotes(book);
  const progress = typeof book.readingProgress === "number" ? ` · 进度 ${book.readingProgress}%` : "";

  return `${book.reviewCount} 条想法 · ${totalNotes} 条笔记${progress}`;
}
