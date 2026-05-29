import { describe, expect, test } from "vitest";
import { getExportAssetBoundary } from "./export-asset-boundaries";

describe("export asset boundaries", () => {
  test("keeps book review export scoped to existing local reviews", () => {
    const boundary = getExportAssetBoundary("bookReview");

    expect(boundary.summary).toContain("本地已生成");
    expect(boundary.behavior).toContain("不会同步微信读书远端");
    expect(boundary.behavior).toContain("不会自动生成新的 AI 复盘");
    expect(boundary.excludes.join(" ")).toContain("API Key");
  });

  test("documents bulk export sync behavior explicitly", () => {
    const boundary = getExportAssetBoundary("bulkNotes");

    expect(boundary.source).toContain("本地笔记概览");
    expect(boundary.behavior).toContain("只有选择同步策略");
    expect(boundary.excludes).toContain("书签正文");
  });
});

