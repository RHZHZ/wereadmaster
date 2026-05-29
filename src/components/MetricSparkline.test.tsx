import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricSparkline } from "./MetricSparkline";

describe("MetricSparkline", () => {
  it("renders line markup when there are enough points", () => {
    const markup = renderToStaticMarkup(
      <MetricSparkline values={[120, 240, 180, 360, 420]} />
    );

    expect(markup).toContain("metric-sparkline-line");
    expect(markup).toContain("metric-sparkline-dot");
  });

  it("renders empty placeholder when points are insufficient", () => {
    const markup = renderToStaticMarkup(<MetricSparkline values={[120]} />);

    expect(markup).toContain("stats-tile-sparkline--empty");
    expect(markup).not.toContain("metric-sparkline-line");
  });
});
