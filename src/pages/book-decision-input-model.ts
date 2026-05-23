import type {
  BookDecisionGoal,
  BookDecisionResponse,
  SearchResult
} from "../lib/types";
import type { RecentReadingWindowMode } from "./book-decision-context";

export type ReferenceFactor = "recent" | "finished" | "habits";

export type BookDecisionSession = {
  response: BookDecisionResponse;
  candidateBooks: SearchResult[];
  selectedIds: string[];
  selectedFactorIds: ReferenceFactor[];
  decisionGoal: BookDecisionGoal;
  recentReadingWindowMode: RecentReadingWindowMode;
};

export const maxDecisionCandidates = 8;

export const referenceFactorIds: ReferenceFactor[] = ["recent", "finished", "habits"];

export const referenceFactors: Array<{
  id: ReferenceFactor;
  label: string;
  description: string;
  status: "recent" | "stats";
}> = [
  {
    id: "recent",
    label: "近期阅读上下文",
    description: "判断是否延续当前主题，减少突然切换带来的启动成本。",
    status: "recent"
  },
  {
    id: "finished",
    label: "已读偏好与完成记录",
    description: "识别哪些类型更容易读完，不会把已读书重新推荐给你。",
    status: "stats"
  },
  {
    id: "habits",
    label: "阅读节奏与投入能力",
    description: "估算当前适合轻量推进，还是适合投入长期书。",
    status: "stats"
  }
];

export const decisionGoals: Array<{
  id: BookDecisionGoal;
  description: string;
}> = [
  {
    id: "轻松读",
    description: "优先低启动成本，适合恢复阅读节奏。"
  },
  {
    id: "延续当前主题",
    description: "接上最近关注的问题，减少切换损耗。"
  },
  {
    id: "推进长期书",
    description: "优先值得持续投入但容易拖延的书。"
  },
  {
    id: "只有 30 分钟",
    description: "只选择能快速开始并有明确停靠点的书。"
  },
  {
    id: "读完能复盘",
    description: "优先能产出问题、行动或写作素材的书。"
  }
];
