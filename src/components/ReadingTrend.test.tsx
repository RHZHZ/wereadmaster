import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingTrend } from "./ReadingTrend";

describe("ReadingTrend", () => {
  const buckets = [
    { startTime: toLocalTimestamp(2026, 0, 1), readTimeSeconds: 3600 },
    { startTime: toLocalTimestamp(2026, 1, 1), readTimeSeconds: 5400 },
    { startTime: toLocalTimestamp(2026, 2, 1), readTimeSeconds: 1800 }
  ];

  it("renders bar trend for monthly mode", () => {
    const markup = renderToStaticMarkup(
      <ReadingTrend mode="monthly" buckets={buckets} compare={0.25} />
    );

    expect(markup).toContain("trend-bars");
    expect(markup).toContain("reading-heatmap-grid");
    expect(markup).toContain("reading-heatmap-cell-trigger");
    expect(markup).toContain("trend-peak-badge");
    expect(markup).toContain("trend-column-hit");
    expect(markup).toContain("较上一周期增加 25%");
    expect(markup).not.toContain("trend-line-chart");
  });

  it("renders line trend for annual mode", () => {
    const markup = renderToStaticMarkup(
      <ReadingTrend mode="annually" buckets={buckets} compare={-0.1} />
    );

    expect(markup).toContain("trend-line-chart");
    expect(markup).toContain("trend-line-hotspot");
    expect(markup).toContain("trend-line-peak-ring");
    expect(markup).toContain("较上一周期减少 10%");
    expect(markup).not.toContain("trend-bars");
  });
});

function toLocalTimestamp(year: number, monthIndex: number, day: number): number {
  return Math.floor(new Date(year, monthIndex, day).getTime() / 1000);
}
