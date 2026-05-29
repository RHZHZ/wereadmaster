type MetricSparklineProps = {
  tone?: "green" | "gold" | "neutral";
  values: number[];
};

const VIEWBOX_WIDTH = 112;
const VIEWBOX_HEIGHT = 36;
const PADDING_X = 4;
const PADDING_Y = 4;

export function MetricSparkline({
  tone = "green",
  values
}: MetricSparklineProps) {
  if (values.length < 2) {
    return <div className="stats-tile-sparkline stats-tile-sparkline--empty" aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerWidth = VIEWBOX_WIDTH - PADDING_X * 2;
  const innerHeight = VIEWBOX_HEIGHT - PADDING_Y * 2;
  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? VIEWBOX_WIDTH / 2
        : PADDING_X + (innerWidth * index) / (values.length - 1);
    const y =
      range === 0
        ? VIEWBOX_HEIGHT / 2
        : PADDING_Y + (1 - (value - min) / range) * innerHeight;

    return { x, y };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${VIEWBOX_HEIGHT - PADDING_Y} L ${points[0]?.x ?? 0} ${VIEWBOX_HEIGHT - PADDING_Y} Z`;
  const lastPoint = points[points.length - 1];
  const hasMixedValues = min < 0 && max > 0;
  const baselineY =
    hasMixedValues && range > 0
      ? PADDING_Y + (1 - (0 - min) / range) * innerHeight
      : undefined;

  return (
    <div className={`stats-tile-sparkline stats-tile-sparkline--${tone}`} aria-hidden="true">
      <svg
        className="metric-sparkline"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
      >
        {baselineY !== undefined ? (
          <line
            className="metric-sparkline-baseline"
            x1={PADDING_X}
            y1={baselineY}
            x2={VIEWBOX_WIDTH - PADDING_X}
            y2={baselineY}
          />
        ) : null}
        <path className="metric-sparkline-area" d={areaPath} />
        <path className="metric-sparkline-line" d={linePath} />
        {lastPoint ? (
          <circle
            className="metric-sparkline-dot"
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="3.2"
          />
        ) : null}
      </svg>
    </div>
  );
}
