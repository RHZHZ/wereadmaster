import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewTimelineChart } from "./ReviewTimelineChart";

describe("ReviewTimelineChart", () => {
  const dailyBuckets = [
    { startTime: toLocalTimestamp(2026, 1, 2), readTimeSeconds: 1_200 },
    { startTime: toLocalTimestamp(2026, 1, 5), readTimeSeconds: 3_120 },
    { startTime: toLocalTimestamp(2026, 1, 14), readTimeSeconds: 2_280 }
  ];

  it("renders monthly reading as an area trend", () => {
    const markup = renderToStaticMarkup(<ReviewTimelineChart mode="monthly" buckets={dailyBuckets} />);

    expect(markup).toContain("review-timeline-chart is-monthly");
    expect(markup).toContain("review-timeline-area");
    expect(markup).toContain("月度阅读时间轴");
    expect(markup).not.toContain("reading-heatmap");
  });

  it("renders weekly reading as bars", () => {
    const markup = renderToStaticMarkup(<ReviewTimelineChart mode="weekly" buckets={dailyBuckets} />);

    expect(markup).toContain("review-timeline-chart is-weekly");
    expect(markup).toContain("review-timeline-bar");
    expect(markup).toContain("周度阅读时间轴");
    expect(markup).not.toContain("review-timeline-area");
  });

  it("keeps sparse overall bars visually constrained", () => {
    const markup = renderToStaticMarkup(
      <ReviewTimelineChart
        mode="overall"
        buckets={[{ startTime: toLocalTimestamp(2026, 0, 1), readTimeSeconds: 3_600 }]}
      />
    );

    expect(markup).toContain("review-timeline-chart is-overall");
    expect(markup).toContain('width="66"');
  });

  it("renders an empty state without valid buckets", () => {
    const markup = renderToStaticMarkup(<ReviewTimelineChart mode="monthly" buckets={[]} />);

    expect(markup).toContain("暂无趋势分桶");
    expect(markup).not.toContain("review-timeline-chart");
  });
});

function toLocalTimestamp(year: number, monthIndex: number, day: number): number {
  return Math.floor(new Date(year, monthIndex, day).getTime() / 1000);
}
