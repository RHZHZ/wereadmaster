import { describe, expect, it } from "vitest";
import { buildGuideDetailSections, buildGuidePrescriptionItems, buildSingleBookGuideNodes } from "./guide-prescription";
import type { ReadingRoute } from "../../lib/types";

describe("reading guide prescription", () => {
  const baseRoute: ReadingRoute = {
    routeOverview: "先围绕《深度工作》完成一轮问题驱动阅读，再用一页复盘判断哪些方法值得执行。",
    books: [
      {
        bookId: "book-deep-work",
        title: "深度工作",
        author: "卡尔·纽波特",
        order: 1,
        role: "当前书",
        readingPurpose:
          "建立稳定长读习惯并完成整书复盘沉淀，避免碎片化阅读影响专注力训练。",
        estimatedEffort: "2 个 45 分钟阅读时段",
        localStatus: "待复盘",
        basis: "当前进度 42%，优先完成第 2 章到第 3 章的核心方法阅读。"
      }
    ],
    dependencies: [],
    reviewCheckpoints: [
      {
        timing: "读完第 3 章后",
        question: "哪些干扰最常打断你的深度工作？",
        suggestedOutput: "写 3 条干扰清单，并为每条补 1 个阻断动作。"
      }
    ],
    nextActions: [
      "今天安排 45 分钟读完第 2 章，并标出 3 条可以直接实践的专注规则。"
    ],
    sourceStats: {
      currentBookCount: 1,
      candidateCount: 0,
      summaryCount: 1,
      statsSignalCount: 1,
      localStatusCount: 1
    },
    generatedAt: "2026-05-20T00:00:00Z",
    promptVersion: "reading-route-v2.1",
    basisNotice: "基于当前书和本地状态生成。"
  };

  it("turns single-book route data into concrete reading prescription cards", () => {
    const items = buildGuidePrescriptionItems(baseRoute, false);

    expect(items.map((item) => item.label)).toEqual(["先读哪里", "带什么问题读", "读完产出什么"]);
    expect(items[0].title).toBe("读完第 2 章到第 3 章");
    expect(items[0].body).toBe("用 2 个 45 分钟阅读时段推进；只记录会改变行动的段落。");
    expect(items[1].title).toBe("哪些干扰最常打断你的深度工作？");
    expect(items[1].body).toBe("读到相关段落时，把答案先写成 3 条可验证判断。");
    expect(items[2].title).toBe("3 条干扰清单");
    expect(items[2].body).toBe("读完第 3 章后完成，并为每条补 1 个阻断动作。");
  });

  it("does not expose generic AI planning language as the card headline", () => {
    const items = buildGuidePrescriptionItems(baseRoute, false);
    const visibleText = items.flatMap((item) => [item.label, item.title, item.body]).join("\n");

    expect(visibleText).not.toContain("建立稳定长读习惯");
    expect(visibleText).not.toContain("整书复盘沉淀");
  });

  it("uses the same prescription logic for the single-book guide map", () => {
    const nodes = buildSingleBookGuideNodes(
      {
        bookId: "book-deep-work",
        title: "深度工作",
        author: "卡尔·纽波特",
        localStatus: "待复盘"
      },
      baseRoute
    );

    expect(nodes.map((node) => node.eyebrow)).toEqual(["当前书", "先读哪里", "带问题读", "交付物", "延伸判断"]);
    expect(nodes[1].label).toBe("读完第 2 章到第 3 章");
    expect(nodes[2].label).toBe("哪些干扰最常打断你的深度工作？");
    expect(nodes[3].label).toBe("3 条干扰清单");
    expect(nodes[4].detail).toBe("完成本书复盘后，只有主题需要横向比较时再加入候选书。");
  });

  it("turns verbose AI fields into scannable detail sections", () => {
    const sections = buildGuideDetailSections(baseRoute, false);

    expect(sections.steps).toEqual([
      {
        index: 1,
        title: "深度工作",
        meta: "卡尔·纽波特 · 待复盘",
        taskLabel: "阅读任务",
        task: "读完第 2 章到第 3 章",
        effort: "2 个 45 分钟阅读时段",
        evidence: "当前进度 42%；优先完成第 2 章到第 3 章的核心方法阅读"
      }
    ]);
    expect(sections.checkpoints).toEqual([
      {
        timing: "读完第 3 章后",
        question: "哪些干扰最常打断你的深度工作？",
        output: "3 条干扰清单，并为每条补 1 个阻断动作",
        acceptance: "为每条补 1 个阻断动作。"
      }
    ]);
    expect(sections.actions[0]).toEqual({
      title: "今天安排 45 分钟读完第 2 章",
      done: "标出 3 条可以直接实践的专注规则。"
    });
  });

  it("keeps detail card content complete instead of adding ellipsis", () => {
    const route: ReadingRoute = {
      ...baseRoute,
      reviewCheckpoints: [
        {
          timing: "第2次阅读结束（当周内）",
          question: "你能否把“按照自己的方式度过人生”的成功定义落成一句话，并列出3条不随他人评价波动的衡量标准？",
          suggestedOutput: "输出 1句成功定义（不超过30字）+3条衡量标准，每条标准都能在一周内通过“是否做到/做到几次”来判断。"
        }
      ],
      nextActions: [
        "在两次阅读之间用10分钟写出“成功定义”一句话与3条衡量标准，完成标准：每条标准都带一个可观察信号（例如次数/是否完成/是否记录）。"
      ]
    };
    const sections = buildGuideDetailSections(route, false);
    const visibleText = [
      sections.checkpoints[0].output,
      sections.checkpoints[0].acceptance,
      sections.actions[0].title,
      sections.actions[0].done
    ].join("\n");

    expect(visibleText).toContain("1句成功定义（不超过30字）+3条衡量标准");
    expect(visibleText).toContain("每条标准都能在一周内通过“是否做到/做到几次”来判断");
    expect(visibleText).toContain("在两次阅读之间用10分钟写出“成功定义”一句话与3条衡量标准");
    expect(visibleText).toContain("每条标准都带一个可观察信号（例如次数/是否完成/是否记录）");
    expect(visibleText).not.toContain("...");
    expect(visibleText).not.toContain("…");
  });
});
