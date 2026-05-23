import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportFailurePanel } from "./ExportFailurePanel";

describe("ExportFailurePanel", () => {
  it("renders classified error, raw message, recovery hint and preserved context", () => {
    const markup = renderToStaticMarkup(
      <ExportFailurePanel
        ariaLabel="批量导出报告"
        error="导出目录暂时不可写，请稍后重试。"
        contextTitle="当前不会丢失预检结果和导出设置"
        contextDescription="可以直接重试，也可以返回设置调整策略。"
      />
    );

    expect(markup).toContain('aria-label="批量导出报告"');
    expect(markup).toContain("导出目录不可写");
    expect(markup).toContain("当前导出目录暂时无法写入文件。");
    expect(markup).toContain("导出目录暂时不可写，请稍后重试。");
    expect(markup).toContain("请检查导出目录是否存在、是否有写入权限，或稍后重试。");
    expect(markup).toContain("当前不会丢失预检结果和导出设置");
    expect(markup).toContain("可以直接重试，也可以返回设置调整策略。");
  });
});
