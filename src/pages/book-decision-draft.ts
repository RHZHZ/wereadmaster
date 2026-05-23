import type { BookDecisionGoal } from "../lib/types";
import type { RecentReadingWindowMode } from "./book-decision-context";

export type BookDecisionDraft = {
  selectedIds: string[];
  selectedFactorIds: string[];
  decisionGoal: BookDecisionGoal;
  recentReadingWindowMode: RecentReadingWindowMode;
};

type BookDecisionDraftStorage = Pick<Storage, "getItem" | "setItem">;

const bookDecisionDraftKey = "wxreadmaster.bookDecisionDraft.v1";
const decisionGoals: BookDecisionGoal[] = ["轻松读", "延续当前主题", "推进长期书", "只有 30 分钟", "读完能复盘"];
const recentReadingWindowModes: RecentReadingWindowMode[] = ["auto", 30, 60, 90, 180, 365];

export function readBookDecisionDraft(
  storage: BookDecisionDraftStorage | undefined
): BookDecisionDraft | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(bookDecisionDraftKey);
    const parsed = raw ? JSON.parse(raw) : undefined;

    if (!isRecord(parsed)) {
      return undefined;
    }

    const selectedIds = Array.isArray(parsed.selectedIds)
      ? parsed.selectedIds.filter((item): item is string => typeof item === "string")
      : [];
    const selectedFactorIds = Array.isArray(parsed.selectedFactorIds)
      ? parsed.selectedFactorIds.filter((item): item is string => typeof item === "string")
      : [];
    const decisionGoal = decisionGoals.includes(parsed.decisionGoal as BookDecisionGoal)
      ? (parsed.decisionGoal as BookDecisionGoal)
      : "轻松读";
    const recentReadingWindowMode = recentReadingWindowModes.includes(
      parsed.recentReadingWindowMode as RecentReadingWindowMode
    )
      ? (parsed.recentReadingWindowMode as RecentReadingWindowMode)
      : "auto";

    return {
      selectedIds,
      selectedFactorIds,
      decisionGoal,
      recentReadingWindowMode
    };
  } catch {
    return undefined;
  }
}

export function writeBookDecisionDraft(
  storage: BookDecisionDraftStorage | undefined,
  draft: BookDecisionDraft
): void {
  try {
    storage?.setItem(
      bookDecisionDraftKey,
      JSON.stringify({
        selectedIds: [...new Set(draft.selectedIds)].sort(),
        selectedFactorIds: [...new Set(draft.selectedFactorIds)].sort(),
        decisionGoal: draft.decisionGoal,
        recentReadingWindowMode: draft.recentReadingWindowMode
      })
    );
  } catch {
    // 本地草稿是增强能力，失败不应阻断选书决策。
  }
}

export function getBookDecisionDraftStorage(): BookDecisionDraftStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
