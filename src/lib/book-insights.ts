import type { BookAiRepresentativeQuote, BookAiSummary } from "./types";

export type BookInsightViewModel = {
  id: string;
  title: string;
  description: string;
  sourceQuotes: BookAiRepresentativeQuote[];
  followUpQuestions: string[];
};

const DEFAULT_INSIGHT_LIMIT = 4;
const SOURCE_QUOTES_PER_INSIGHT = 2;
const FOLLOW_UPS_PER_INSIGHT = 2;

export function buildBookInsightViewModels(
  summary: Pick<
    BookAiSummary,
    "overview" | "keyIdeas" | "myFocus" | "representativeQuotes" | "reflectionQuestions"
  >,
  limit = DEFAULT_INSIGHT_LIMIT
): BookInsightViewModel[] {
  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) {
    return [];
  }

  const focusItems = uniqueNonEmptyStrings(summary.myFocus);
  const keyIdeas = uniqueNonEmptyStrings(summary.keyIdeas);
  const reflectionQuestions = uniqueNonEmptyStrings(summary.reflectionQuestions);
  const sourceQuotes = summary.representativeQuotes.filter((quote) => quote.quote.trim());
  const titles = (focusItems.length > 0 ? focusItems : keyIdeas).slice(0, safeLimit);

  return titles
    .map((title, index) => {
      const description = buildInsightDescription(title, keyIdeas, summary.overview, index);
      return {
        id: `book-insight-${index + 1}`,
        title,
        description,
        sourceQuotes: pickSourceQuotes(sourceQuotes, index, titles.length),
        followUpQuestions: pickFollowUpQuestions(reflectionQuestions, index)
      };
    })
    .filter((insight) => insight.title || insight.description);
}

function buildInsightDescription(
  title: string,
  keyIdeas: string[],
  overview: string,
  index: number
): string {
  const directIdea = keyIdeas[index];
  if (directIdea && directIdea !== title) {
    return directIdea;
  }

  const fallbackIdea = keyIdeas.find((item) => item !== title);
  if (fallbackIdea) {
    return fallbackIdea;
  }

  return overview.trim();
}

function pickSourceQuotes(
  quotes: BookAiRepresentativeQuote[],
  insightIndex: number,
  insightCount: number
): BookAiRepresentativeQuote[] {
  if (quotes.length === 0 || insightCount <= 0) {
    return [];
  }

  const chunkSize = Math.max(1, Math.ceil(quotes.length / insightCount));
  const start = insightIndex * chunkSize;
  const directChunk = quotes.slice(start, start + SOURCE_QUOTES_PER_INSIGHT);

  if (directChunk.length > 0) {
    return directChunk;
  }

  return [quotes[insightIndex % quotes.length]];
}

function pickFollowUpQuestions(questions: string[], insightIndex: number): string[] {
  if (questions.length === 0) {
    return [];
  }

  const start = insightIndex * FOLLOW_UPS_PER_INSIGHT;
  const directQuestions = questions.slice(start, start + FOLLOW_UPS_PER_INSIGHT);

  if (directQuestions.length > 0) {
    return directQuestions;
  }

  return [questions[insightIndex % questions.length]];
}

function uniqueNonEmptyStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  items.forEach((item) => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

