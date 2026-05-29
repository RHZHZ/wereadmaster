import { describe, expect, it } from "vitest";
import { buildReportGenerationPeriodSelection } from "./report-generation-period-selection";

describe("report generation period selection", () => {
  const now = new Date(2026, 4, 24, 10, 0, 0);

  it("keeps lifetime review anchored to overall", () => {
    const selection = buildReportGenerationPeriodSelection({
      mode: "overall",
      preferredWeekBaseTime: 0,
      selectedMonth: 12,
      selectedYear: 2099,
      now
    });

    expect(selection.period).toEqual({ mode: "overall", baseTime: 0 });
    expect(selection.selectedMonth).toBe(12);
  });

  it("falls back from a future month to the latest available month", () => {
    const selection = buildReportGenerationPeriodSelection({
      mode: "monthly",
      preferredWeekBaseTime: 0,
      selectedMonth: 12,
      selectedYear: 2026,
      now
    });

    expect(selection.period.mode).toBe("monthly");
    expect(new Date(selection.period.baseTime * 1000).getFullYear()).toBe(2026);
    expect(new Date(selection.period.baseTime * 1000).getMonth() + 1).toBe(5);
    expect(selection.selectedMonth).toBe(5);
  });

  it("keeps weekly report generation on a non-future week", () => {
    const selection = buildReportGenerationPeriodSelection({
      mode: "weekly",
      preferredWeekBaseTime: 0,
      selectedMonth: 5,
      selectedYear: 2026,
      now
    });

    expect(selection.period.mode).toBe("weekly");
    expect(new Date(selection.period.baseTime * 1000).getFullYear()).toBe(2026);
    expect(new Date(selection.period.baseTime * 1000).getMonth() + 1).toBe(5);
    expect(new Date(selection.period.baseTime * 1000).getDate()).toBe(18);
  });
});
