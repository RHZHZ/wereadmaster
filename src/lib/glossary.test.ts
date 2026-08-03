import { describe, expect, test } from "vitest";
import { BANNED_TERMS, TERMS } from "./glossary";

const EXPECTED_TERMS = {
  bookReview: "书籍复盘",
  readingGuide: "阅读指南",
  readingRoute: "阅读路线",
  statsReview: "周期复盘",
  reportImage: "报告图片",
  bookDecision: "选书决策",
  assistant: "AI 阅读助手",
  outcomes: "成果",
  toOrganize: "待整理",
  organized: "已整理",
  generateBookReview: "生成书籍复盘",
  generateBookDecision: "生成选书决策",
  generateReportImage: "生成报告图片"
} as const;

describe("product glossary", () => {
  test("keeps the approved product terms stable", () => {
    expect(TERMS).toEqual(EXPECTED_TERMS);
  });

  test("maps every unique banned term to a known canonical term", () => {
    const banned = BANNED_TERMS.map((entry) => entry.banned);

    expect(banned.every((value) => value.trim().length > 0)).toBe(true);
    expect(new Set(banned).size).toBe(banned.length);

    for (const entry of BANNED_TERMS) {
      expect(TERMS[entry.useInstead]).toBeTruthy();
    }
  });

  test("does not reuse a banned phrase as a canonical term", () => {
    for (const term of Object.values(TERMS)) {
      for (const { banned } of BANNED_TERMS) {
        expect(term).not.toBe(banned);
      }
    }
  });
});
