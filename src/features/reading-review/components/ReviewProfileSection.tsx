import { CheckCircle2, Compass, Lightbulb } from "lucide-react";
import { PersonaIllustration } from "../../../components/PersonaIllustration";
import { getPersonaVisual } from "../../../lib/persona-visuals";
import type { ReadingPersona } from "../../../lib/types";
import { ReviewEmptyBlock } from "./ReviewEmptyBlock";
import { ReviewPanelHeading } from "./ReviewPanelHeading";

type ReviewProfileSectionProps = {
  persona: ReadingPersona;
};

export function ReviewProfileSection({ persona }: ReviewProfileSectionProps) {
  const isInsufficient = persona.status === "insufficient";
  const isProvisional = persona.status === "provisional";
  const dimensions = isProvisional ? persona.dimensions.slice(0, 2) : persona.dimensions;
  const visual = getPersonaVisual(persona);
  const evidenceSummary = persona.evidence.slice(0, 2).join("；") || persona.summary || persona.basisNotice;

  return (
    <section className="review-panel" aria-label="阅读人格 MBTI">
      <ReviewPanelHeading
        kicker="阅读人格 MBTI"
        title="本周期更接近哪种阅读状态"
        badge="仅本地统计"
      />
      {isInsufficient ? (
        <ReviewEmptyBlock
          icon={<Compass aria-hidden="true" size={22} />}
          text={persona.summary || "本期阅读样本较少，继续阅读后再生成阅读人格。"}
        />
      ) : (
        <section
          className={`review-profile-card is-${visual.tone}${isProvisional ? " is-provisional" : ""}`}
          aria-label={persona.displayTitle || "阅读人格"}
        >
          <button
            className="review-profile-visual"
            type="button"
            aria-label={visual.ariaLabel}
          >
            <PersonaIllustration visual={visual} />
            <span className="review-profile-visual-tip">
              <b>{visual.code ? `${visual.code} · ${visual.propLabel}` : visual.propLabel}</b>
              <small>{evidenceSummary}</small>
            </span>
          </button>

          <div className="review-profile-head">
            <span className="review-profile-badge">
              {isProvisional ? "本月阅读倾向" : "你的阅读人格"}
            </span>
            <strong>
              {persona.displayTitle}
              {isProvisional ? "（临时）" : ""}
            </strong>
            <small>{isProvisional ? "样本较少，先视为当前倾向。" : "这不是固定人格，而是当前周期侧写。"}</small>
          </div>

          {persona.summary ? <p className="review-profile-summary">{persona.summary}</p> : null}

          {dimensions.length > 0 ? (
            <div className="review-profile-dimensions" aria-label="阅读人格维度">
              {dimensions.map((dimension) => (
                <article key={`${dimension.axis}-${dimension.key}`} className="review-profile-dimension">
                  <div className="review-profile-dimension-head">
                    <span>{dimension.key}</span>
                    <strong>{dimension.label}</strong>
                    <small>{formatDimensionStrength(dimension.strength)}</small>
                  </div>
                  <p>{dimension.basis}</p>
                </article>
              ))}
            </div>
          ) : null}

          {persona.evidence.length > 0 ? (
            <ul className="review-profile-evidence">
              {persona.evidence.map((item, index) => (
                <li key={`${item}-${index}`}>
                  <CheckCircle2 aria-hidden="true" size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {persona.suggestion ? (
            <div className="review-profile-suggestion">
              <Lightbulb aria-hidden="true" size={16} />
              <span>{persona.suggestion}</span>
            </div>
          ) : null}

          <div className="review-profile-footnote">
            <Lightbulb aria-hidden="true" size={16} />
            <span>{persona.basisNotice}</span>
          </div>
        </section>
      )}
    </section>
  );
}

function formatDimensionStrength(value: ReadingPersona["dimensions"][number]["strength"]): string {
  switch (value) {
    case "strong":
      return "倾向较明确";
    case "medium":
      return "倾向稳定";
    default:
      return "倾向较轻";
  }
}
