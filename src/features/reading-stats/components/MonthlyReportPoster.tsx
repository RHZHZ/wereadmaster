import monthlyReportArchSceneSrc from "../../../assets/generated/monthly-report-arch-scene.png";
import { PersonaIllustration } from "../../../components/PersonaIllustration";
import { getPersonaVisual } from "../../../lib/persona-visuals";
import {
  formatMonthlyReportPosterPersonaTitle,
  splitMonthlyReportPosterTitle,
} from "../monthly-report-poster";
import type { PeriodReportPosterData } from "../period-report";

type MonthlyReportPosterProps = {
  data: PeriodReportPosterData;
};

export function MonthlyReportPoster({ data }: MonthlyReportPosterProps) {
  const visual = getPersonaVisual(data.persona);
  const titleParts = splitMonthlyReportPosterTitle(data.title, data.anchorLabel);
  const personaTitle = formatMonthlyReportPosterPersonaTitle(
    data.persona.displayTitle ?? data.persona.label,
    "本期阅读倾向"
  );

  return (
    <article className={`monthly-report-poster is-${visual.tone}`} aria-label="阅读报告海报预览">
      <span className="monthly-report-poster-orb top" aria-hidden="true" />
      <span className="monthly-report-poster-orb bottom" aria-hidden="true" />

      <header className="monthly-report-poster-header">
        <span>wxreadmaster 阅读报告</span>
        <i aria-hidden="true" />
        <small>{visual.code ? `${visual.code} 型读者` : "阅读人格"}</small>
      </header>

      <section className="monthly-report-poster-hero">
        <div className="monthly-report-poster-copy">
          <h3>
            <span>{titleParts.period}</span>
            <span>{titleParts.subject}</span>
          </h3>
          <p>{data.summary}</p>
        </div>
        <aside className="monthly-report-poster-persona">
          <span className="monthly-report-poster-kicker">
            {visual.code ? `${visual.code} 型读者` : "阅读人格画像"}
          </span>
          <strong>{personaTitle}</strong>
          <p>{data.persona.suggestion ?? data.persona.basisNotice}</p>
          <img
            className="monthly-poster-arch-scene"
            src={monthlyReportArchSceneSrc}
            alt=""
            draggable={false}
          />
          <div className="monthly-poster-visual" aria-hidden="true">
            <PersonaIllustration visual={visual} />
          </div>
        </aside>
      </section>

      <section className="monthly-report-poster-metrics" aria-label="核心指标">
        <h4>本期阅读概览</h4>
        {data.metrics.map((metric) => (
          <article key={metric.label}>
            <i aria-hidden="true" />
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="monthly-report-poster-grid">
        <div className="monthly-report-poster-list">
          <span className="monthly-report-poster-kicker">本期重点书目</span>
          <ul>
            {data.books.map((item, index) => (
              <li key={item.label}>
                <i aria-hidden="true">{index + 1}</i>
                <span>
                  <strong>{item.label}</strong>
                  {item.meta ? <small>{item.meta}</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="monthly-report-poster-list monthly-report-poster-category">
          <span className="monthly-report-poster-kicker">分类偏好</span>
          <div className="monthly-report-poster-donut" aria-hidden="true">
            <span>{data.categories[0]?.label ?? "阅读"}</span>
          </div>
          <ul>
            {data.categories.map((item) => (
              <li key={item.label}>
                <span>
                  <strong>{item.label}</strong>
                  {item.meta ? <small>{item.meta}</small> : null}
                </span>
              </li>
            ))}
          </ul>
          <section className="monthly-report-poster-keywords" aria-label="本期关键词">
            <span className="monthly-report-poster-kicker">本期关键词</span>
            <div>
              {data.keywords.slice(0, 4).map((keyword) => (
                <em key={keyword}>{keyword}</em>
              ))}
            </div>
          </section>
        </div>
      </section>

      <footer className="monthly-report-poster-footer">由 wxreadmaster 生成</footer>
    </article>
  );
}
