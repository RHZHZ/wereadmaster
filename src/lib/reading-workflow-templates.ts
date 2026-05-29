export type ReadingWorkflowTemplateTarget =
  | "notes"
  | "readingAssets"
  | "readingReport"
  | "candidateShelf";

export type ReadingWorkflowTemplate = {
  id: "bookReview" | "currentBookGuide" | "periodReview" | "bookDecision";
  title: string;
  description: string;
  inputScope: string;
  output: string;
  actionLabel: string;
  target: ReadingWorkflowTemplateTarget;
};

export const readingWorkflowTemplates: ReadingWorkflowTemplate[] = [
  {
    id: "bookReview",
    title: "整理一本书",
    description: "把单本划线和想法收束成核心观点、代表摘录、行动项和复盘问题。",
    inputScope: "当前书笔记",
    output: "书籍复盘",
    actionLabel: "去笔记中心",
    target: "notes"
  },
  {
    id: "currentBookGuide",
    title: "规划当前书",
    description: "围绕当前书生成下一步阅读任务、复盘点和是否扩展候选书的判断。",
    inputScope: "当前书和可选候选",
    output: "阅读指南",
    actionLabel: "查看指南库",
    target: "readingAssets"
  },
  {
    id: "periodReview",
    title: "回顾一段时间",
    description: "基于周期统计回看投入节奏、偏好变化和下一步可执行调整。",
    inputScope: "本地统计缓存",
    output: "阅读报告",
    actionLabel: "打开阅读报告",
    target: "readingReport"
  },
  {
    id: "bookDecision",
    title: "决定下一本",
    description: "只基于本地候选和已确认参考因子，解释下一本读什么以及暂缓原因。",
    inputScope: "本地候选书",
    output: "选书决策",
    actionLabel: "去候选书架",
    target: "candidateShelf"
  }
];

