import type { CSSProperties } from "react";

export type ChartTooltipRow = {
  label: string;
  value: string;
  tone?: "default" | "accent";
};

type ChartTooltipProps = {
  id: string;
  title: string;
  rows: ChartTooltipRow[];
  badge?: string;
  align?: "start" | "center" | "end";
  className?: string;
  style?: CSSProperties;
};

export function ChartTooltip({
  id,
  title,
  rows,
  badge,
  align = "center",
  className,
  style
}: ChartTooltipProps) {
  return (
    <div
      id={id}
      role="tooltip"
      className={`chart-tooltip${className ? ` ${className}` : ""}`}
      data-align={align}
      style={style}
    >
      <div className="chart-tooltip-header">
        <strong className="chart-tooltip-title">{title}</strong>
        {badge ? <span className="chart-tooltip-badge">{badge}</span> : null}
      </div>

      <div className="chart-tooltip-rows">
        {rows.map((row) => (
          <span className="chart-tooltip-row" key={`${row.label}-${row.value}`}>
            <em>{row.label}</em>
            <strong data-tone={row.tone ?? "default"}>{row.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
