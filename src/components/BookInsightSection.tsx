import { Lightbulb, MessageSquare, Quote, Sparkles } from "lucide-react";
import { buildBookInsightViewModels } from "../lib/book-insights";
import type { BookAiRepresentativeQuote, BookAiSummary } from "../lib/types";

type BookInsightSectionProps = {
  summary: BookAiSummary;
  onAskInsight?: (draft: string) => void;
};

export function BookInsightSection({ summary, onAskInsight }: BookInsightSectionProps) {
  const insights = buildBookInsightViewModels(summary);

  if (insights.length === 0) {
    return null;
  }

  return (
    <section className="ai-summary-section book-insight-section" aria-label="阅读洞察">
      <div className="book-insight-heading">
        <div>
          <h4>
            <Lightbulb aria-hidden="true" size={18} />
            阅读洞察
          </h4>
          <p>基于关注点、关键观点、代表性摘录和复盘问题组合，不额外调用 AI。</p>
        </div>
        <span>{insights.length} 条</span>
      </div>

      <div className="book-insight-grid">
        {insights.map((insight, index) => (
          <article className="book-insight-card" key={insight.id}>
            <div className="book-insight-card-heading">
              <span>洞察 {index + 1}</span>
              <strong>{insight.title}</strong>
            </div>
            {insight.description ? <p>{insight.description}</p> : null}
            {insight.sourceQuotes.length > 0 ? (
              <div className="book-insight-source-list" aria-label={`${insight.title} 的来源摘录`}>
                <strong>
                  <Quote aria-hidden="true" size={15} />
                  来源摘录
                </strong>
                {insight.sourceQuotes.map((quote) => (
                  <InsightQuote key={`${insight.id}-${quote.quote}-${quote.reason}`} quote={quote} />
                ))}
              </div>
            ) : null}
            {insight.followUpQuestions.length > 0 ? (
              <div className="book-insight-followups">
                <strong>
                  <Sparkles aria-hidden="true" size={15} />
                  可继续追问
                </strong>
                <ul>
                  {insight.followUpQuestions.map((question) => (
                    <li className="book-insight-followup-item" key={`${insight.id}-${question}`}>
                      <span className="book-insight-followup-question">{question}</span>
                      {onAskInsight ? (
                        <button
                          className="text-button book-insight-question-button"
                          type="button"
                          onClick={() =>
                            onAskInsight(buildInsightQuestionDraft(question, insight.title, insight.description))
                          }
                        >
                          <MessageSquare aria-hidden="true" size={14} />
                          问这个问题
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {onAskInsight ? (
              <button
                className="text-button book-insight-ask-button"
                type="button"
                onClick={() => onAskInsight(buildInsightDraft(insight.title, insight.description))}
              >
                <MessageSquare aria-hidden="true" size={14} />
                围绕洞察追问
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function buildInsightDraft(title: string, description: string): string {
  return [
    `围绕这条阅读洞察继续追问：「${title}」。`,
    description ? `洞察说明：${description}` : undefined,
    "请结合当前复盘和来源摘录，说明这条洞察最值得继续展开的方向，并给出 3 个后续问题。"
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildInsightQuestionDraft(question: string, insightTitle: string, insightDescription: string): string {
  return [
    "围绕这个复盘问题继续追问：",
    `「${question}」`,
    "",
    `关联洞察：「${insightTitle}」`,
    ...(insightDescription ? [`洞察说明：${insightDescription}`] : []),
    "",
    "请结合当前复盘、阅读洞察和来源摘录回答，并给出 1 个最值得继续展开的方向。"
  ].join("\n");
}

function InsightQuote({ quote }: { quote: BookAiRepresentativeQuote }) {
  return (
    <blockquote className="book-insight-quote">
      <p>{quote.quote}</p>
      <footer>
        {quote.noteType}
        {quote.chapter ? ` · ${quote.chapter}` : ""}
      </footer>
    </blockquote>
  );
}
