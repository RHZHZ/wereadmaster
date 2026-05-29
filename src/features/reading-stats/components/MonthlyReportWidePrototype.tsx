import type { CSSProperties } from "react";
import monthlyReportArchSceneSrc from "../../../assets/generated/monthly-report-arch-scene.png";
import { PersonaIllustration } from "../../../components/PersonaIllustration";
import { getPersonaVisual } from "../../../lib/persona-visuals";
import {
  formatMonthlyReportPosterPersonaTitle,
  splitMonthlyReportPosterTitle,
} from "../monthly-report-poster";
import type { PeriodReportPosterData } from "../period-report";

type MonthlyReportWidePrototypeProps = {
  data: PeriodReportPosterData;
};

const trendPoints = [
  [0, 88],
  [7, 66],
  [14, 74],
  [21, 46],
  [28, 70],
  [36, 36],
  [44, 64],
  [52, 44],
  [60, 58],
  [68, 12],
  [76, 55],
  [84, 34],
  [92, 68],
  [100, 48]
];

function compactReportLabel(value: string, maxLength = 14): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function MonthlyReportWidePrototype({ data }: MonthlyReportWidePrototypeProps) {
  const visual = getPersonaVisual(data.persona);
  const titleParts = splitMonthlyReportPosterTitle(data.title, data.anchorLabel);
  const personaTitle = formatMonthlyReportPosterPersonaTitle(
    data.persona.displayTitle ?? data.persona.label,
    "本期阅读倾向"
  );
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const secondCategory = data.categories[1]?.label ?? topCategory;
  const focusBook = data.books[0]?.label ?? "本期重点书";
  const suggestion = data.persona.suggestion ?? "下个周期可以补一本系统型主题书，把零散兴趣沉淀成稳定路径。";
  const overviewMetrics = [
    data.metrics[0],
    data.metrics[1],
    { label: "本期峰值", value: "18日" },
    data.metrics[2]
  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));
  const actionItems = [
    `延续「${compactReportLabel(topCategory, 8)}」主线做一次主题复盘。`,
    `补一本「${compactReportLabel(secondCategory, 8)}」相关书，平衡阅读结构。`,
    `围绕《${compactReportLabel(focusBook, 10)}》沉淀 3 条可复用笔记。`
  ];

  return (
    <article className={`monthly-report-wide is-${visual.tone}`} aria-label="16:9 横版阅读报告原型">
      <span className="monthly-report-wide-corner top-left" aria-hidden="true" />
      <span className="monthly-report-wide-corner bottom-right" aria-hidden="true" />

      <section className="monthly-report-wide-cover">
        <header>
          <span>wxreadmaster 阅读报告</span>
          <h3>
            <span className="monthly-report-wide-title-period">{titleParts.period}</span>
            <span className="monthly-report-wide-title-subject">{titleParts.subject}</span>
          </h3>
        </header>
        <div className="monthly-report-wide-persona">
          <img src={monthlyReportArchSceneSrc} alt="" draggable={false} />
          <PersonaIllustration visual={visual} />
        </div>
        <footer>
          <strong>
            {visual.code ? `${visual.code} 型读者 · ` : ""}
            {personaTitle}
          </strong>
          <p>{data.summary}</p>
          <div className="monthly-report-wide-cover-tags" aria-label="阅读画像标签">
            {data.keywords.slice(0, 3).map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </footer>
      </section>

      <section className="monthly-report-wide-analysis" aria-label="阅读分析">
        <div className="monthly-report-wide-metrics">
          {overviewMetrics.map((metric, index) => (
            <article key={metric.label}>
              <i aria-hidden="true" data-kind={index} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>

        <section className="monthly-report-wide-chart">
          <header>
            <h4>阅读趋势</h4>
            <span>阅读时长（分钟）</span>
          </header>
          <svg viewBox="0 0 520 210" role="img" aria-label="阅读趋势折线图原型">
            <g className="monthly-report-wide-grid-lines">
              {[40, 80, 120, 160].map((y) => (
                <line key={y} x1="0" x2="520" y1={y} y2={y} />
              ))}
            </g>
            <polyline points={trendPoints.map(([x, y]) => `${x * 5.2},${y * 1.8}`).join(" ")} />
            {trendPoints.map(([x, y], index) => (
              <circle key={`${x}-${y}`} cx={x * 5.2} cy={y * 1.8} r={index === 9 ? 6 : 4} />
            ))}
            <line className="monthly-report-wide-peak-line" x1="353.6" x2="353.6" y1="22" y2="184" />
            <text x="372" y="42">18日峰值</text>
            <g className="monthly-report-wide-axis-labels">
              <text x="0" y="205">1</text>
              <text x="126" y="205">8</text>
              <text x="252" y="205">15</text>
              <text x="378" y="205">22</text>
              <text x="498" y="205">31</text>
            </g>
          </svg>
        </section>

        <section className="monthly-report-wide-preferences">
          <div className="monthly-report-wide-donut" aria-hidden="true">
            <span>{topCategory}</span>
          </div>
          <div>
            <h4>分类偏好</h4>
            {data.categories.slice(0, 3).map((item, index) => (
              <article key={item.label}>
                <strong>{item.label}</strong>
                <i style={{ "--bar-width": `${[88, 58, 42][index] ?? 36}%` } as CSSProperties} />
                <span>{item.meta}</span>
              </article>
            ))}
          </div>
        </section>
      </section>

      <aside className="monthly-report-wide-sidebar" aria-label="书目与建议">
        <section className="monthly-report-wide-books">
          <h4>重点书目</h4>
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

        <section className="monthly-report-wide-keywords">
          <h4>本期关键词</h4>
          <div>
            {data.keywords.slice(0, 5).map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </section>

        <section className="monthly-report-wide-advice">
          <i aria-hidden="true" />
          <div>
            <h4>AI 阅读建议</h4>
            <p>{suggestion}</p>
            <ol className="monthly-report-wide-advice-list">
              {actionItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </section>
      </aside>
    </article>
  );
}
