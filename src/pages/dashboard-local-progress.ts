import type { ReadingItemState } from "../lib/types";

export type DashboardLocalProgressTone = "organized" | "review" | "candidate" | "notes" | "empty";

export type DashboardLocalProgressMetric = {
  label: string;
  value: number;
  detail: string;
  tone: DashboardLocalProgressTone;
};

export type DashboardLocalProgressHighlight = {
  title: string;
  body: string;
  tone: DashboardLocalProgressTone;
};

export type DashboardLocalProgress = {
  title: string;
  subtitle: string;
  badge: string;
  metrics: DashboardLocalProgressMetric[];
  highlight: DashboardLocalProgressHighlight;
};

export type DashboardLocalProgressInput = {
  readingStates: ReadingItemState[];
  reviewQueueCount: number;
  candidateQueueCount: number;
  notesBookCount: number;
};

export function buildDashboardLocalProgress({
  readingStates,
  reviewQueueCount,
  candidateQueueCount,
  notesBookCount
}: DashboardLocalProgressInput): DashboardLocalProgress {
  const organizedStates = filterStates(readingStates, "book", "organized");
  const reviewingStates = filterStates(readingStates, "book", "reviewing");
  const candidateStates = filterStates(readingStates, "candidate", "toRead");
  const organizedCount = organizedStates.length;
  const reviewingCount = Math.max(reviewQueueCount, reviewingStates.length);
  const candidateCount = Math.max(candidateQueueCount, candidateStates.length);

  return {
    title: "阅读进度",
    subtitle: resolveProgressSubtitle(organizedCount, reviewingCount, candidateCount, notesBookCount),
    badge: resolveProgressBadge(organizedCount, reviewingCount, candidateCount),
    metrics: [
      {
        label: "已整理",
        value: organizedCount,
        detail: "确认吸收过的书",
        tone: "organized"
      },
      {
        label: "待复盘",
        value: reviewingCount,
        detail: "可继续整理的书",
        tone: "review"
      },
      {
        label: "本地候选",
        value: candidateCount,
        detail: "下一本书候选",
        tone: "candidate"
      },
      {
        label: "笔记书",
        value: notesBookCount,
        detail: "已同步笔记样本",
        tone: "notes"
      }
    ],
    highlight: resolveProgressHighlight({
      organizedStates,
      reviewingStates,
      reviewQueueCount: reviewingCount,
      candidateStates,
      notesBookCount
    })
  };
}

function filterStates(
  states: ReadingItemState[],
  itemType: ReadingItemState["itemType"],
  status: ReadingItemState["status"]
): ReadingItemState[] {
  return states
    .filter((state) => state.itemType === itemType && state.status === status)
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

function resolveProgressSubtitle(
  organizedCount: number,
  reviewingCount: number,
  candidateCount: number,
  notesBookCount: number
): string {
  if (organizedCount > 0) {
    return `已有 ${organizedCount} 本书完成整理，继续把复盘整理成稳定成果。`;
  }

  if (reviewingCount > 0) {
    return `${reviewingCount} 本书正在等你复盘，先处理最明确的一本。`;
  }

  if (candidateCount > 0) {
    return `${candidateCount} 本候选已经保存，可以进入下一本书取舍。`;
  }

  if (notesBookCount > 0) {
    return `${notesBookCount} 本书已有笔记样本，可以挑一本开始整理。`;
  }

  return "同步书架和笔记后，这里会展示本机阅读进度。";
}

function resolveProgressBadge(
  organizedCount: number,
  reviewingCount: number,
  candidateCount: number
): string {
  if (organizedCount > 0) {
    return "已有成果";
  }

  if (reviewingCount > 0) {
    return "待整理";
  }

  if (candidateCount > 0) {
    return "有候选";
  }

  return "待积累";
}

function resolveProgressHighlight({
  organizedStates,
  reviewingStates,
  reviewQueueCount,
  candidateStates,
  notesBookCount
}: {
  organizedStates: ReadingItemState[];
  reviewingStates: ReadingItemState[];
  reviewQueueCount: number;
  candidateStates: ReadingItemState[];
  notesBookCount: number;
}): DashboardLocalProgressHighlight {
  const latestOrganized = organizedStates[0];
  if (latestOrganized) {
    return {
      title: `最近已整理${formatBookTitle(latestOrganized.title)}`,
      body: "这本书已经从读过推进到已整理，后续总览不会优先催它复盘。",
      tone: "organized"
    };
  }

  const latestReviewing = reviewingStates[0];
  if (latestReviewing) {
    return {
      title: `下一本可整理${formatBookTitle(latestReviewing.title)}`,
      body: latestReviewing.note || "这本书已经被标记为待复盘，可以继续整理行动清单和复盘问题。",
      tone: "review"
    };
  }

  if (reviewQueueCount > 0) {
    return {
      title: `${reviewQueueCount} 本书可整理`,
      body: "笔记概览里已经有可复盘信号，可以先从今日主动作挑一本处理。",
      tone: "review"
    };
  }

  const latestCandidate = candidateStates[0];
  if (latestCandidate) {
    return {
      title: `候选池里有${formatBookTitle(latestCandidate.title)}`,
      body: latestCandidate.note || "候选已经保存在本地，可以进入下一本书取舍。",
      tone: "candidate"
    };
  }

  if (notesBookCount > 0) {
    return {
      title: "已有笔记样本",
      body: "可以从笔记中心挑一本有划线和想法的书，开始做结构化复盘。",
      tone: "notes"
    };
  }

  return {
    title: "还没有本地进展",
    body: "先同步书架、笔记或保存候选，首页才会出现可回看的推进状态。",
    tone: "empty"
  };
}

function formatBookTitle(title?: string): string {
  const normalizedTitle = title?.trim() || "未命名书籍";
  return normalizedTitle.startsWith("《") ? normalizedTitle : `《${normalizedTitle}》`;
}
