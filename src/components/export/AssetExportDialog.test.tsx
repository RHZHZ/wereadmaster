import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetExportDialog } from "./AssetExportDialog";

const commonProps = {
  open: true,
  ariaLabel: "导出报告",
  assetTitle: "导出报告",
  assetDescription: "月度 · 2026 年 7 月",
  onExport: async () => ({
    exportId: "export-1",
    sourceKind: "readingStatsReview" as const,
    sourceId: "monthly-2026-07",
    exportedAt: "2026-08-03T12:00:00+08:00",
    results: []
  }),
  onOpenSettings: () => undefined,
  onClose: () => undefined
};

describe("AssetExportDialog", () => {
  it("renders an accessible readonly web boundary without editable destinations", () => {
    const markup = renderToStaticMarkup(
      <AssetExportDialog {...commonProps} platformMode="webReadonly" />
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="导出报告"');
    expect(markup).toContain("当前为 Web 只读预览");
    expect(markup).toContain("文档导出请在桌面应用中执行");
    expect(markup).not.toContain("更改保存位置");
  });

  it("uses three independent targets and a single submit action", () => {
    const markup = renderToStaticMarkup(
      <AssetExportDialog {...commonProps} platformMode="native" />
    );

    expect(markup).toContain("Markdown");
    expect(markup).toContain("Obsidian");
    expect(markup).toContain("Notion");
    expect(markup).toContain("开始导出");
    expect(markup).not.toContain("Obsidian + Notion");
    expect(markup).not.toContain("更改保存位置");
  });
});
