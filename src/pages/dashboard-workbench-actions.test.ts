import { describe, expect, test, vi } from "vitest";
import {
  buildDailyWorkbenchActions,
  mapWorkbenchAction,
  type WorkbenchActionInput
} from "./dashboard-workbench-actions";

describe("dashboard workbench actions", () => {
  test("keeps the first action as primary and limits secondary actions", () => {
    const actions = [
      action("复盘《深度工作》"),
      action("继续看《原则》"),
      action("执行统计建议"),
      action("去发现页保存候选")
    ];

    const result = buildDailyWorkbenchActions(actions);

    expect(result.primaryAction?.title).toBe("复盘《深度工作》");
    expect(result.secondaryActions.map((item) => item.title)).toEqual(["继续看《原则》", "执行统计建议"]);
  });

  test("maps setup actions for credentials and bookshelf cache", () => {
    expect(mapWorkbenchAction(action("先连接微信读书"))).toMatchObject({
      verb: "连接",
      reason: "还没有本机阅读数据入口",
      outcome: "连接后可同步书架、笔记和统计",
      effort: "setup",
      source: "credential"
    });

    expect(mapWorkbenchAction(action("同步书架缓存"))).toMatchObject({
      verb: "同步",
      reason: "本地还没有可用书架缓存",
      outcome: "获得后续复盘、候选和统计的阅读数据基础",
      effort: "setup",
      source: "shelf"
    });
  });

  test("maps review and route actions as deep work", () => {
    expect(mapWorkbenchAction(action("复盘《深度工作》"))).toMatchObject({
      verb: "复盘",
      reason: "这本书已有笔记信号，适合整理成结构化输出",
      outcome: "得到行动清单、复盘问题和可导出的复盘文档",
      effort: "deep",
      source: "review"
    });

    expect(mapWorkbenchAction(action("打开《深度工作》阅读指南"))).toMatchObject({
      verb: "规划",
      reason: "当前需要先确定这本书的推进方式",
      outcome: "得到阅读处方，明确本书下一步阅读和整理路径",
      effort: "deep",
      source: "route"
    });
  });

  test("maps light decision, candidate and stats actions", () => {
    expect(mapWorkbenchAction(action("执行选书决策：月亮与六便士"))).toMatchObject({
      verb: "确认",
      reason: "已有生成过的候选取舍结果",
      outcome: "确认下一本书，并生成下一本书决策",
      effort: "light",
      source: "decision"
    });

    expect(mapWorkbenchAction(action("查看候选《月亮与六便士》"))).toMatchObject({
      verb: "查看",
      reason: "候选书需要进入下一步取舍",
      outcome: "确认是否继续保留、阅读或纳入决策",
      effort: "light",
      source: "candidate"
    });

    expect(mapWorkbenchAction(action("执行统计建议"))).toMatchObject({
      verb: "执行",
      reason: "已有周期复盘给出下一步建议",
      outcome: "回到阅读报告核对并执行建议",
      effort: "light",
      source: "stats"
    });
  });

  test("preserves callback and falls back conservatively for unknown actions", () => {
    const onClick = vi.fn();
    const result = mapWorkbenchAction({
      title: "整理一个新入口",
      description: "来自已有页面的动作说明",
      tone: "muted",
      onClick
    });

    result.onClick?.();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      title: "整理一个新入口",
      description: "来自已有页面的动作说明",
      tone: "muted",
      verb: "继续处理",
      reason: "来自已有页面的动作说明",
      outcome: "回到对应页面继续处理",
      effort: "light",
      source: "shelf"
    });
  });
});

function action(title: string): WorkbenchActionInput {
  return {
    title,
    description: `${title} 的说明`,
    tone: "green"
  };
}
