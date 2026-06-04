import { describe, expect, test } from "vitest";
import { buildDailyReadingCard, type DailyReadingCardInput } from "./dashboard-daily-card";

const baseInput: DailyReadingCardInput = {
  hasCredential: true,
  hasShelfData: true,
  hasNotesData: true
};

describe("dashboard daily reading card", () => {
  test("uses the first cached reading report action as the highest priority card", () => {
    expect(
      buildDailyReadingCard({
        ...baseInput,
        reviewActions: ["把最近读完的书整理成一页复盘", "保留固定深度阅读时段"],
        topDecisionTitle: "月亮与六便士",
        reviewItemTitle: "深度工作"
      })
    ).toEqual({
      title: "这周期最值得处理",
      body: "把最近读完的书整理成一页复盘。",
      sourceLabel: "本地阅读报告",
      actionLabel: "查看阅读报告",
      tone: "stats"
    });
  });

  test("falls back from decision to review, recent book, candidate and persona cards", () => {
    expect(
      buildDailyReadingCard({
        ...baseInput,
        topDecisionTitle: "月亮与六便士",
        topDecisionReason: "今天打开详情并确认是否开始"
      })
    ).toMatchObject({
      title: "今天先确认《月亮与六便士》",
      body: "今天打开详情并确认是否开始。",
      sourceLabel: "选书决策缓存",
      actionLabel: "查看决策",
      tone: "decision"
    });

    expect(
      buildDailyReadingCard({
        ...baseInput,
        reviewItemTitle: "代码整洁之道",
        reviewItemMeta: "8 条想法 · 21 条笔记"
      })
    ).toMatchObject({
      title: "今天整理《代码整洁之道》",
      body: "8 条想法 · 21 条笔记，适合整理成结构化复盘。",
      tone: "review"
    });

    expect(
      buildDailyReadingCard({
        ...baseInput,
        recentBookTitle: "深度工作",
        recentBookMeta: "卡尔·纽波特 · 2024-09-10"
      })
    ).toMatchObject({
      title: "继续推进《深度工作》",
      sourceLabel: "最近阅读",
      actionLabel: "打开书籍",
      tone: "book"
    });

    expect(
      buildDailyReadingCard({
        ...baseInput,
        candidateTitle: "原则",
        candidateMeta: "瑞·达利欧 · 管理"
      })
    ).toMatchObject({
      title: "候选池里有《原则》",
      sourceLabel: "本地候选",
      actionLabel: "查看候选",
      tone: "candidate"
    });

    expect(
      buildDailyReadingCard({
        ...baseInput,
        personaSnapshot: "本月更偏向围绕效率主线稳定深读"
      })
    ).toMatchObject({
      title: "今天看一个阅读风格信号",
      body: "本月更偏向围绕效率主线稳定深读。",
      sourceLabel: "本地统计画像",
      actionLabel: "查看统计",
      tone: "persona"
    });
  });

  test("uses concrete empty cards without inventing conclusions", () => {
    expect(buildDailyReadingCard({ ...baseInput, hasCredential: false })).toMatchObject({
      title: "先连接微信读书",
      sourceLabel: "凭据状态",
      actionLabel: "打开设置",
      tone: "empty"
    });

    expect(buildDailyReadingCard({ ...baseInput, hasShelfData: false })).toMatchObject({
      title: "先同步书架缓存",
      sourceLabel: "书架缓存",
      actionLabel: "去书架同步",
      tone: "empty"
    });

    expect(buildDailyReadingCard({ ...baseInput, hasNotesData: false })).toMatchObject({
      title: "先同步笔记样本",
      body: "当前还没有可复盘的本地笔记，先同步后再挑一本书整理。",
      sourceLabel: "笔记概览",
      actionLabel: "同步笔记",
      tone: "empty"
    });
  });
});
