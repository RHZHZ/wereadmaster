import type { CSSProperties } from "react";
import monthlyReportArchSceneSrc from "../../../assets/generated/monthly-report-arch-scene.png";
import { PersonaIllustration } from "../../../components/PersonaIllustration";
import { getPersonaVisual } from "../../../lib/persona-visuals";
import {
  buildLifetimeReportStrategyItems,
  type LifetimeReadingReportData,
  type LifetimeReadingReportSeriesPoint
} from "../lifetime-reading-report";

type LifetimeReadingReportWideProps = {
  data: LifetimeReadingReportData;
};

type TrendPoint = {
  x: number;
  y: number;
  source: LifetimeReadingReportSeriesPoint;
};

function buildTrendPoints(series: LifetimeReadingReportSeriesPoint[]): TrendPoint[] {
  const visibleSeries = series.length > 0
    ? series
    : [{ label: "现在", meta: "等待同步", value: 0 }];
  const maxValue = Math.max(...visibleSeries.map((point) => point.value), 1);
  const denominator = Math.max(visibleSeries.length - 1, 1);

  return visibleSeries.map((point, index) => ({
    x: 26 + (index / denominator) * 468,
    y: 174 - (point.value / maxValue) * 126,
    source: point
  }));
}

export function LifetimeReadingReportWide({ data }: LifetimeReadingReportWideProps) {
  const visual = getPersonaVisual(data.persona);
  const personaTitle = data.persona.displayTitle ?? data.persona.label ?? "长期阅读人格";
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const trendPoints = buildTrendPoints(data.yearSeries);
  const peakPoint = trendPoints.reduce<TrendPoint | undefined>((current, point) => {
    if (!current || point.source.value > current.source.value) {
      return point;
    }

    return current;
  }, undefined);
  const polylinePoints = trendPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const strategyItems = buildLifetimeReportStrategyItems(data);

  return (
    <article
      className={`monthly-report-wide lifetime-reading-report-wide is-${visual.tone}`}
      aria-label="长期阅读成果报告预览"
    >
      <span className="monthly-report-wide-corner top-left" aria-hidden="true" />
      <span className="monthly-report-wide-corner bottom-right" aria-hidden="true" />

      <section className="monthly-report-wide-cover lifetime-reading-report-cover">
        <header>
          <span>wxreadmaster 长期复盘</span>
          <h3>
            <span className="monthly-report-wide-title-period">{data.periodAnchor}</span>
            <span className="monthly-report-wide-title-subject">阅读成果</span>
          </h3>
        </header>

        <div className="monthly-report-wide-persona lifetime-reading-report-persona">
          <img src={monthlyReportArchSceneSrc} alt="" draggable={false} />
          <PersonaIllustration visual={visual} />
        </div>

        <footer>
          <strong>
            {visual.code ? `${visual.code} 型读者 · ` : ""}
            {personaTitle.replace(/^[A-Z]{4}\s*型读者\s*[·:：-]\s*/, "")}
          </strong>
          <p>{data.summary}</p>
          <div className="monthly-report-wide-cover-tags" aria-label="长期阅读画像标签">
            {data.keywords.slice(0, 4).map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </footer>
      </section>

      <section className="monthly-report-wide-analysis lifetime-reading-report-analysis" aria-label="长期阅读成果分析">
        <div className="monthly-report-wide-metrics">
          {data.metrics.slice(0, 4).map((metric, index) => (
            <article key={metric.label}>
              <i aria-hidden="true" data-kind={index} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail ? <small>{metric.detail}</small> : null}
            </article>
          ))}
        </div>

        <section className="monthly-report-wide-chart lifetime-reading-report-trend">
          <header>
            <h4>年度投入走势</h4>
            <span>{data.peakYear ? `峰值 ${data.peakYear}` : "等待历史分布"}</span>
          </header>
          <svg viewBox="0 0 520 210" role="img" aria-label="长期阅读年度投入折线图">
            <g className="monthly-report-wide-grid-lines">
              {[44, 82, 120, 158].map((y) => (
                <line key={y} x1="0" x2="520" y1={y} y2={y} />
              ))}
            </g>
            <polyline points={polylinePoints} />
            {trendPoints.map((point) => (
              <circle
                key={point.source.label}
                cx={point.x}
                cy={point.y}
                r={point === peakPoint ? 6 : 4}
              />
            ))}
            {peakPoint ? (
              <>
                <line
                  className="monthly-report-wide-peak-line"
                  x1={peakPoint.x}
                  x2={peakPoint.x}
                  y1="28"
                  y2="184"
                />
                <text x={Math.min(peakPoint.x + 14, 420)} y="42">
                  {peakPoint.source.label} · {peakPoint.source.meta}
                </text>
              </>
            ) : null}
            <g className="monthly-report-wide-axis-labels">
              {trendPoints.map((point, index) => (
                <text key={point.source.label} x={Math.max(0, point.x - 18)} y="204">
                  {index % 2 === 0 || trendPoints.length <= 5 ? point.source.label : ""}
                </text>
              ))}
            </g>
          </svg>
        </section>

        <section className="monthly-report-wide-preferences lifetime-reading-report-structure">
          <div className="monthly-report-wide-donut" aria-hidden="true">
            <span>{topCategory}</span>
          </div>
          <div>
            <h4>稳定分类偏好</h4>
            {data.categories.slice(0, 3).map((item, index) => (
              <article key={item.label}>
                <strong>{item.label}</strong>
                <i style={{ "--bar-width": `${[90, 62, 44][index] ?? 36}%` } as CSSProperties} />
                <span>{item.meta}</span>
              </article>
            ))}
          </div>
        </section>
      </section>

      <aside className="monthly-report-wide-sidebar lifetime-reading-report-sidebar" aria-label="长期书目、作者与建议">
        <section className="monthly-report-wide-books">
          <h4>长期代表书目</h4>
          {data.books.slice(0, 3).map((item, index) => (
            <article key={item.label}>
              <i aria-hidden="true">{index + 1}</i>
              <span aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <small>{item.meta}</small>
              </div>
            </article>
          ))}
        </section>

        <section className="monthly-report-wide-keywords lifetime-reading-report-authors">
          <h4>偏好作者信号</h4>
          <div>
            {data.authors.slice(0, 4).map((item) => (
              <span key={item.label}>
                {item.label}
                {item.meta ? ` · ${item.meta}` : ""}
              </span>
            ))}
          </div>
        </section>

        <section className="monthly-report-wide-advice">
          <i aria-hidden="true" />
          <div>
            <h4>长期阅读策略</h4>
            <ul className="monthly-report-wide-strategy-list">
              {strategyItems.map((item) => (
                <li key={`${item.label}-${item.text}`}>
                  <strong>{item.label}</strong>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </aside>
    </article>
  );
}
