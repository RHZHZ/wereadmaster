import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReadingStatsPeriod } from "../../../pages/reading-stats-period";
import { ReportGenerationWizardDialog } from "./ReportGenerationWizardDialog";

describe("ReportGenerationWizardDialog", () => {
  it("starts from an isolated report type selection step", () => {
    const markup = renderToStaticMarkup(
      <ReportGenerationWizardDialog
        cache={{}}
        isDownloading={false}
        open
        reportPeriod={buildReadingStatsPeriod("monthly")}
        onClose={() => undefined}
        onDownload={() => undefined}
        onDownloadLifetime={() => undefined}
        onGenerateReport={() => undefined}
        onSyncReportPeriod={() => undefined}
      />
    );

    expect(markup).toContain("1 选择类型");
    expect(markup).toContain("周报");
    expect(markup).toContain("月报");
    expect(markup).toContain("年报");
    expect(markup).toContain("总计复盘");
    expect(markup).not.toContain("具体月份");
    expect(markup).not.toContain("具体周");
    expect(markup).not.toContain("竖版海报");
    expect(markup).not.toContain("monthly-report-poster-preview-shell");
    expect(markup).not.toContain("暂时不能生成这一期报告");
  });

  it("keeps lifetime review as a selectable report kind instead of a separate dialog branch", () => {
    const markup = renderToStaticMarkup(
      <ReportGenerationWizardDialog
        cache={{}}
        isDownloading={false}
        open
        reportPeriod={buildReadingStatsPeriod("overall")}
        onClose={() => undefined}
        onDownload={() => undefined}
        onDownloadLifetime={() => undefined}
        onGenerateReport={() => undefined}
        onSyncReportPeriod={() => undefined}
      />
    );

    expect(markup).toContain("总计复盘");
    expect(markup).toContain("长期阅读资产沉淀");
    expect(markup).toContain("下一步：确认长期范围");
    expect(markup).not.toContain("当前选择：");
  });
});
