import { getReadingArtifactLabel } from "../lib/reading-artifacts";

export type WorkbenchActionTone = "green" | "blue" | "gold" | "muted";

export type WorkbenchActionSource =
  | "credential"
  | "shelf"
  | "notes"
  | "review"
  | "route"
  | "decision"
  | "stats"
  | "candidate";

export type WorkbenchActionEffort = "light" | "deep" | "setup";

export type WorkbenchActionInput = {
  title: string;
  description: string;
  tone: WorkbenchActionTone;
  onClick?: () => void;
};

export type DailyWorkbenchAction = WorkbenchActionInput & {
  verb: string;
  reason: string;
  outcome: string;
  effort: WorkbenchActionEffort;
  source: WorkbenchActionSource;
};

export type DailyWorkbenchActions = {
  primaryAction?: DailyWorkbenchAction;
  secondaryActions: DailyWorkbenchAction[];
};

type WorkbenchActionPreset = {
  verb: string;
  reason: string;
  outcome: string;
  effort: WorkbenchActionEffort;
  source: WorkbenchActionSource;
};

export function buildDailyWorkbenchActions(actions: WorkbenchActionInput[]): DailyWorkbenchActions {
  const mappedActions = actions.map(mapWorkbenchAction);

  return {
    primaryAction: mappedActions[0],
    secondaryActions: mappedActions.slice(1, 3)
  };
}

export function mapWorkbenchAction(action: WorkbenchActionInput): DailyWorkbenchAction {
  return {
    ...action,
    ...resolveActionPreset(action)
  };
}

function resolveActionPreset(action: WorkbenchActionInput): WorkbenchActionPreset {
  const { title } = action;

  if (title.startsWith("先连接微信读书")) {
    return {
      verb: "连接",
      reason: "还没有本机阅读数据入口",
      outcome: "连接后可同步书架、笔记和统计",
      effort: "setup",
      source: "credential"
    };
  }

  if (title.startsWith("同步书架缓存")) {
    return {
      verb: "同步",
      reason: "本地还没有可用书架缓存",
      outcome: "获得后续复盘、候选和统计的阅读数据基础",
      effort: "setup",
      source: "shelf"
    };
  }

  if (title.startsWith("继续看《")) {
    return {
      verb: "继续",
      reason: "这是最近推进过的书",
      outcome: "回到当前阅读现场，继续积累可整理内容",
      effort: "light",
      source: "shelf"
    };
  }

  if (title.startsWith("打开《") && title.includes("阅读指南")) {
    return {
      verb: "规划",
      reason: "当前需要先确定这本书的推进方式",
      outcome: `得到${getReadingArtifactLabel("reading-route-markdown")}，明确本书下一步阅读和整理路径`,
      effort: "deep",
      source: "route"
    };
  }

  if (title.startsWith("从书架选一本书")) {
    return {
      verb: "选择",
      reason: "还没有明确的最近阅读入口",
      outcome: "选出一本书作为下一步阅读现场",
      effort: "light",
      source: "shelf"
    };
  }

  if (title.startsWith("复盘《")) {
    return {
      verb: "复盘",
      reason: "这本书已有笔记信号，适合整理成结构化输出",
      outcome: `得到${getReadingArtifactLabel("action-checklist")}、${getReadingArtifactLabel("reflection-questions")}和可导出的${getReadingArtifactLabel("book-review-markdown")}`,
      effort: "deep",
      source: "review"
    };
  }

  if (title.startsWith("去笔记中心同步笔记")) {
    return {
      verb: "同步",
      reason: "当前缺少可复盘的笔记信号",
      outcome: "同步后可以发现最适合整理的书",
      effort: "setup",
      source: "notes"
    };
  }

  if (title.startsWith("执行选书决策")) {
    return {
      verb: "确认",
      reason: "已有生成过的候选取舍结果",
      outcome: `确认下一本书，并生成${getReadingArtifactLabel("book-decision-markdown")}`,
      effort: "light",
      source: "decision"
    };
  }

  if (title.startsWith("查看候选《")) {
    return {
      verb: "查看",
      reason: "候选书需要进入下一步取舍",
      outcome: "确认是否继续保留、阅读或纳入决策",
      effort: "light",
      source: "candidate"
    };
  }

  if (title.startsWith("去发现页保存候选")) {
    return {
      verb: "保存",
      reason: "当前还没有候选书",
      outcome: "保存下一本书的候选池",
      effort: "light",
      source: "candidate"
    };
  }

  if (title.startsWith("配置 AI Provider")) {
    return {
      verb: "配置",
      reason: "生成复盘、指南或决策前需要本机 Provider",
      outcome: "后续可手动生成 AI 阅读成果",
      effort: "setup",
      source: "credential"
    };
  }

  if (title.startsWith("查看书籍复盘")) {
    return {
      verb: "查看",
      reason: "已有或可生成的阅读报告需要处理",
      outcome: "进入复盘中心查看和整理书籍报告",
      effort: "light",
      source: "review"
    };
  }

  if (title.startsWith("执行统计建议")) {
    return {
      verb: "执行",
      reason: "已有周期复盘给出下一步建议",
      outcome: "回到阅读报告核对并执行建议",
      effort: "light",
      source: "stats"
    };
  }

  return fallbackAction(action);
}

function fallbackAction(action: WorkbenchActionInput): WorkbenchActionPreset {
  return {
    verb: "继续处理",
    reason: action.description,
    outcome: "回到对应页面继续处理",
    effort: "light",
    source: "shelf"
  };
}
