import type { ReadingItemState, ReadingProgress, ShelfEntry } from "../lib/types";

export type BookAssetStatusTone = "organized" | "review" | "candidate" | "finished" | "reading" | "new";

export type BookAssetStatus = {
  label: string;
  title: string;
  body: string;
  progressLabel: string;
  nextActionLabel: string;
  nextActionReason: string;
  tone: BookAssetStatusTone;
};

export type BookAssetStatusInput = {
  shelfEntry: Pick<ShelfEntry, "isFinished">;
  progress: Pick<ReadingProgress, "progressPercent" | "isStarted" | "isFinished">;
  readingState?: Pick<ReadingItemState, "itemType" | "status">;
  canOpenNotes: boolean;
  canOpenAiSummary: boolean;
  canOpenReadingRoute: boolean;
};

type SuggestedAction = {
  nextActionLabel: string;
  nextActionReason: string;
};

export function buildBookAssetStatus(input: BookAssetStatusInput): BookAssetStatus {
  const progressLabel = buildProgressLabel(input);

  if (input.readingState?.status === "organized") {
    return {
      label: "已整理",
      title: "已经整理成阅读成果",
      body: "这本书已完成本地整理，后续首页不会优先催它复盘。",
      progressLabel,
      ...pickOrganizedAction(input),
      tone: "organized"
    };
  }

  if (input.readingState?.status === "reviewing") {
    return {
      label: "待复盘",
      title: "下一步是整理这本书",
      body: "适合先确认笔记范围，再把关键划线和想法整理成复盘文档。",
      progressLabel,
      ...pickReviewAction(input),
      tone: "review"
    };
  }

  if (input.readingState?.itemType === "candidate" && input.readingState.status === "toRead") {
    return {
      label: "本地候选",
      title: "已进入候选池",
      body: "这本书已保存为候选书，可用于选书取舍和阅读路线规划。",
      progressLabel,
      ...pickCandidateAction(input),
      tone: "candidate"
    };
  }

  if (isBookFinished(input)) {
    return {
      label: "已读完",
      title: "适合进入复盘",
      body: "微信进度显示已读完，本地还没有确认整理完成。",
      progressLabel,
      ...pickReviewAction(input),
      tone: "finished"
    };
  }

  if (isBookStarted(input)) {
    return {
      label: "阅读中",
      title: "继续积累可复盘材料",
      body: "先把阅读推进到明确节点，再回到这里整理笔记。",
      progressLabel,
      ...pickReadingAction(input),
      tone: "reading"
    };
  }

  return {
    label: "未开始",
    title: "先确定要不要读",
    body: "这本书还没有本地整理状态，可以先规划阅读路径或加入候选。",
    progressLabel,
    ...pickNewBookAction(input),
    tone: "new"
  };
}

function pickOrganizedAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenAiSummary) {
    return {
      nextActionLabel: "AI 复盘",
      nextActionReason: "回看复盘文档、行动清单和复盘问题。"
    };
  }

  if (input.canOpenNotes) {
    return {
      nextActionLabel: "查看笔记",
      nextActionReason: "回到本书划线和想法，复核已整理依据。"
    };
  }

  return pickReadingRouteAction(input);
}

function pickReviewAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenAiSummary) {
    return {
      nextActionLabel: "AI 复盘",
      nextActionReason: "生成或回看这本书的结构化复盘。"
    };
  }

  if (input.canOpenNotes) {
    return {
      nextActionLabel: "查看笔记",
      nextActionReason: "先确认划线和想法，再决定复盘范围。"
    };
  }

  return {
    nextActionLabel: "标记待复盘",
    nextActionReason: "先把这本书放入本地整理队列。"
  };
}

function pickCandidateAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenReadingRoute) {
    return {
      nextActionLabel: "本书阅读指南",
      nextActionReason: "把候选变成明确的阅读路径和输出目标。"
    };
  }

  return {
    nextActionLabel: "已在候选",
    nextActionReason: "候选状态已保存，可稍后进入选书取舍。"
  };
}

function pickReadingAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenReadingRoute) {
    return {
      nextActionLabel: "本书阅读指南",
      nextActionReason: "确定下一段要读哪里、带什么问题读。"
    };
  }

  if (input.canOpenNotes) {
    return {
      nextActionLabel: "查看笔记",
      nextActionReason: "查看已经积累的划线和想法。"
    };
  }

  return {
    nextActionLabel: "继续阅读",
    nextActionReason: "先推进微信读书进度，给后续复盘积累材料。"
  };
}

function pickNewBookAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenReadingRoute) {
    return pickReadingRouteAction(input);
  }

  return {
    nextActionLabel: "加入候选",
    nextActionReason: "先保存到本地候选，稍后再决定是否开始。"
  };
}

function pickReadingRouteAction(input: BookAssetStatusInput): SuggestedAction {
  if (input.canOpenReadingRoute) {
    return {
      nextActionLabel: "本书阅读指南",
      nextActionReason: "先规划这本书下一步阅读和整理路径。"
    };
  }

  if (input.canOpenNotes) {
    return {
      nextActionLabel: "查看笔记",
      nextActionReason: "先查看已有材料，再决定整理方式。"
    };
  }

  return {
    nextActionLabel: "查看书籍信息",
    nextActionReason: "先确认简介、目录和进度，再决定是否整理。"
  };
}

function buildProgressLabel(input: BookAssetStatusInput): string {
  if (isBookFinished(input)) {
    return "微信进度 已读完";
  }

  if (isBookStarted(input)) {
    return `微信进度 ${clampPercent(input.progress.progressPercent)}%`;
  }

  return "微信进度 未开始";
}

function isBookFinished(input: BookAssetStatusInput): boolean {
  return input.progress.isFinished || input.shelfEntry.isFinished === true || clampPercent(input.progress.progressPercent) >= 100;
}

function isBookStarted(input: BookAssetStatusInput): boolean {
  return input.progress.isStarted || clampPercent(input.progress.progressPercent) > 0;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.trunc(value)));
}
