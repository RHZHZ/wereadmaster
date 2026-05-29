import { type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import monthlyReportArchSceneSrc from "../../../assets/generated/monthly-report-arch-scene.png";
import { PersonaIllustration } from "../../../components/PersonaIllustration";
import { getPersonaVisual } from "../../../lib/persona-visuals";
import {
  MONTHLY_REPORT_STORY_PAGES,
  formatMonthlyReportPosterPersonaTitle,
  splitMonthlyReportPosterTitle,
  type MonthlyReportPosterItem,
  type MonthlyReportPosterMetric,
  type MonthlyReportStoryPage
} from "../monthly-report-poster";
import type { PeriodReportPosterData } from "../period-report";

type MonthlyReportCardSetProps = {
  activeIndex: number;
  data: PeriodReportPosterData;
  onActiveIndexChange: (index: number) => void;
};

type MonthlyReportStoryContext = {
  actionItems: string[];
  evidence: string[];
  focusBook: string;
  personaTitle: string;
  secondCategory: string;
  suggestion: string;
  titleParts: ReturnType<typeof splitMonthlyReportPosterTitle>;
  topCategory: string;
  visual: ReturnType<typeof getPersonaVisual>;
};

const rhythmBars = [42, 68, 36, 84, 58, 72, 46, 64, 76, 44, 62, 54];

function compactCardText(value: string | undefined, maxLength = 20): string {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function MonthlyReportCardSet({
  activeIndex,
  data,
  onActiveIndexChange
}: MonthlyReportCardSetProps) {
  const visual = getPersonaVisual(data.persona);
  const titleParts = splitMonthlyReportPosterTitle(data.title, data.anchorLabel);
  const personaTitle = formatMonthlyReportPosterPersonaTitle(
    data.persona.displayTitle ?? data.persona.label,
    "本期阅读倾向"
  );
  const topCategory = data.categories[0]?.label ?? data.metrics[2]?.value ?? "阅读";
  const secondCategory = data.categories[1]?.label ?? topCategory;
  const focusBook = data.books[0]?.label ?? "本期重点书";
  const suggestion = data.persona.suggestion ?? "下个周期可以补一条更稳定的阅读主线，把零散兴趣沉淀成可复用笔记。";
  const evidence = data.persona.evidence.length > 0 ? data.persona.evidence : [data.persona.basisNotice];
  const actionItems = [
    `围绕「${compactCardText(topCategory, 8)}」做一次主题复盘。`,
    `补一本「${compactCardText(secondCategory, 8)}」相关书，平衡阅读结构。`,
    `给《${compactCardText(focusBook, 10)}》沉淀 3 条可复用笔记。`
  ];
  const context: MonthlyReportStoryContext = {
    actionItems,
    evidence,
    focusBook,
    personaTitle,
    secondCategory,
    suggestion,
    titleParts,
    topCategory,
    visual
  };
  const activePage = MONTHLY_REPORT_STORY_PAGES[activeIndex] ?? MONTHLY_REPORT_STORY_PAGES[0];

  function showPreviousPage() {
    onActiveIndexChange(activeIndex === 0 ? MONTHLY_REPORT_STORY_PAGES.length - 1 : activeIndex - 1);
  }

  function showNextPage() {
    onActiveIndexChange((activeIndex + 1) % MONTHLY_REPORT_STORY_PAGES.length);
  }

  return (
    <section className={`monthly-report-card-set is-${visual.tone}`} aria-label="轮播阅读报告预览">
      <div className="monthly-report-story-stage">
        <button
          className="monthly-report-story-arrow is-left"
          type="button"
          onClick={showPreviousPage}
          aria-label="查看上一张阅读报告分享图"
        >
          <ChevronLeft aria-hidden="true" size={18} />
        </button>

        <StoryPoster data={data} page={activePage} pageIndex={activeIndex} context={context} />

        <button
          className="monthly-report-story-arrow is-right"
          type="button"
          onClick={showNextPage}
          aria-label="查看下一张阅读报告分享图"
        >
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>

      <aside className="monthly-report-story-rail" aria-label="轮播阅读报告缩略图">
        <div className="monthly-report-story-rail-copy">
          <span>{activeIndex + 1} / {MONTHLY_REPORT_STORY_PAGES.length}</span>
          <strong>{activePage.title}</strong>
          <p>每一页都是可独立分享的阅读报告图，用多页承载完整分析，而不是把一张卡拆成章节。</p>
        </div>

        <div className="monthly-report-story-thumbs">
          {MONTHLY_REPORT_STORY_PAGES.map((page, index) => (
            <button
              key={page.id}
              className={index === activeIndex ? "is-active" : ""}
              type="button"
              aria-current={index === activeIndex ? "page" : undefined}
              aria-label={`查看第 ${index + 1} 张：${page.title}`}
              onClick={() => onActiveIndexChange(index)}
            >
              <span className={`monthly-report-story-thumb-preview is-${page.id}`}>
                <i>{String(index + 1).padStart(2, "0")}</i>
              <b>{page.label}</b>
              </span>
              <strong>{page.title}</strong>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function StoryPoster({
  context,
  data,
  page,
  pageIndex
}: {
  context: MonthlyReportStoryContext;
  data: PeriodReportPosterData;
  page: MonthlyReportStoryPage;
  pageIndex: number;
}) {
  return (
    <article className={`monthly-report-story-card is-${page.id}`} aria-label={`第 ${pageIndex + 1} 张阅读报告分享图：${page.title}`}>
      <StoryFrame page={page} pageIndex={pageIndex}>
        {page.id === "cover" ? <CoverPage context={context} data={data} /> : null}
        {page.id === "rhythm" ? <RhythmPage data={data} /> : null}
        {page.id === "themes" ? <ThemesPage context={context} data={data} /> : null}
        {page.id === "books" ? <BooksPage context={context} books={data.books} /> : null}
        {page.id === "insight" ? <InsightPage context={context} data={data} /> : null}
        {page.id === "action" ? <ActionPage context={context} keywords={data.keywords} /> : null}
      </StoryFrame>
    </article>
  );
}

function StoryFrame({
  children,
  page,
  pageIndex
}: {
  children: ReactNode;
  page: MonthlyReportStoryPage;
  pageIndex: number;
}) {
  return (
    <>
      <header className="monthly-report-story-header">
        <span>wxreadmaster 阅读报告</span>
        <i aria-hidden="true" />
        <small>{String(pageIndex + 1).padStart(2, "0")} / {MONTHLY_REPORT_STORY_PAGES.length}</small>
      </header>
      <div className="monthly-report-story-heading">
        <small>{page.label}</small>
        <h3>{page.title}</h3>
      </div>
      {children}
      <footer className="monthly-report-story-footer">由 wxreadmaster 生成</footer>
    </>
  );
}

function CoverPage({ context, data }: { context: MonthlyReportStoryContext; data: PeriodReportPosterData }) {
  return (
    <>
      <div className="monthly-report-story-cover-title">
        <span>{context.titleParts.period}</span>
        <strong>{context.titleParts.subject}</strong>
      </div>
      <div className="monthly-report-story-visual" aria-hidden="true">
        <img src={monthlyReportArchSceneSrc} alt="" draggable={false} />
        <PersonaIllustration visual={context.visual} />
      </div>
      <section className="monthly-report-story-conclusion">
        <strong>
          {context.visual.code ? `${context.visual.code} 型读者 · ` : ""}
          {context.personaTitle}
        </strong>
        <p>{data.summary}</p>
      </section>
    </>
  );
}

function RhythmPage({ data }: { data: PeriodReportPosterData }) {
  return (
    <>
      <p className="monthly-report-story-lede">
        先看投入节奏：这一周期的阅读强度、活跃天数和代表方向共同决定画像底色。
      </p>
      <div className="monthly-report-story-metric-grid">
        {data.metrics.map((metric) => (
          <MetricTile key={metric.label} metric={metric} />
        ))}
      </div>
      <div className="monthly-report-story-bars" aria-label="阅读节奏示意图">
        {rhythmBars.map((height, index) => (
          <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>
      <p className="monthly-report-story-note">柱形仅作月内节奏表达，帮助快速判断读书投入是否集中。</p>
    </>
  );
}

function ThemesPage({ context, data }: { context: MonthlyReportStoryContext; data: PeriodReportPosterData }) {
  return (
    <>
      <p className="monthly-report-story-lede">
        这一周期注意力最明显地落在「{context.topCategory}」，它决定了这份报告的主要阅读气质。
      </p>
      <div className="monthly-report-story-theme-board">
        <div className="monthly-report-story-donut" aria-hidden="true">
          <span>{compactCardText(context.topCategory, 6)}</span>
        </div>
        <div className="monthly-report-story-theme-list">
          {data.categories.slice(0, 3).map((item, index) => (
            <section key={item.label}>
              <strong>{item.label}</strong>
              <i style={{ "--story-bar-width": `${[88, 62, 42][index] ?? 36}%` } as CSSProperties} />
              <span>{item.meta}</span>
            </section>
          ))}
        </div>
      </div>
      <KeywordCloud keywords={data.keywords.slice(0, 6)} />
    </>
  );
}

function BooksPage({ context, books }: { context: MonthlyReportStoryContext; books: MonthlyReportPosterItem[] }) {
  return (
    <>
      <p className="monthly-report-story-lede">
        「{compactCardText(context.focusBook, 16)}」是这一周期最能代表注意力流向的书目。
      </p>
      <ol className="monthly-report-story-book-list">
        {books.slice(0, 4).map((item, index) => (
          <li key={item.label}>
            <i>{index + 1}</i>
            <span>
              <strong>{item.label}</strong>
              {item.meta ? <small>{item.meta}</small> : null}
            </span>
          </li>
        ))}
      </ol>
      <section className="monthly-report-story-evidence">
        <strong>证据摘录</strong>
        <p>{context.evidence[0]}</p>
      </section>
    </>
  );
}

function InsightPage({ context, data }: { context: MonthlyReportStoryContext; data: PeriodReportPosterData }) {
  return (
    <>
      <section className="monthly-report-story-insight-card">
        <span>AI 结论</span>
        <strong>{data.headline}</strong>
        <p>{data.summary}</p>
      </section>
      <div className="monthly-report-story-insight-grid">
        <section>
          <span>优势</span>
          <p>你能持续围绕「{compactCardText(context.topCategory, 8)}」形成稳定兴趣主线。</p>
        </section>
        <section>
          <span>盲区</span>
          <p>如果长期只读同类内容，视角会变窄，需要少量异质主题做校准。</p>
        </section>
      </div>
    </>
  );
}

function ActionPage({ context, keywords }: { context: MonthlyReportStoryContext; keywords: string[] }) {
  return (
    <>
      <p className="monthly-report-story-advice">{context.suggestion}</p>
      <ol className="monthly-report-story-action-list">
        {context.actionItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <section className="monthly-report-story-question">
        <strong>下期复盘问题</strong>
        <p>这条阅读主线，是在扩展理解，还是只是在重复熟悉的信息舒适区？</p>
      </section>
      <KeywordCloud keywords={keywords.slice(0, 4)} />
    </>
  );
}

function MetricTile({ metric }: { metric: MonthlyReportPosterMetric }) {
  return (
    <section>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
    </section>
  );
}

function KeywordCloud({ keywords }: { keywords: string[] }) {
  return (
    <div className="monthly-report-story-tags" aria-label="本期关键词">
      {keywords.map((keyword, index) => (
        <span key={`${keyword}-${index}`}>{keyword}</span>
      ))}
    </div>
  );
}
