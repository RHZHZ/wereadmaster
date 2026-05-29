import type { LocalBook } from "./local-reader-types";
import { sourceItemKeyFromLocalBook, type SourceItemKey } from "./source-item-keys";

export type LocalReaderAiQuestionRequest = {
  sourceItem: SourceItemKey;
  book: {
    title: string;
    author?: string;
  };
  selection: {
    text: string;
    startOffset: number;
    endOffset: number;
    context?: {
      beforeText?: string;
      afterText?: string;
    };
  };
  question: string;
};

export type LocalReaderAiQuestionAnswer = {
  answer: string;
  keyPoints: string[];
  followUpQuestions: string[];
  generatedAt: string;
  promptVersion: string;
  responseFormat?: "json_schema" | "json_object";
  basisNotice: string;
};

export type LocalReaderAiQuestionResponse = {
  sourceItem: SourceItemKey;
  promptVersion: string;
  inputHash: string;
  providerModel?: string;
  source: "cache" | "generated" | "staleCache" | "empty";
  answer: LocalReaderAiQuestionAnswer;
  cachedUpdatedAt?: string;
  errorMessage?: string;
};

const MAX_SELECTED_TEXT_LENGTH = 2000;
const MAX_QUESTION_TEXT_LENGTH = 600;
const MAX_SELECTION_CONTEXT_CHARS = 1200;

export function createLocalReaderAiQuestionRequest(input: {
  book: Pick<LocalBook, "id" | "title" | "author">;
  selectedText: string;
  question: string;
  startOffset: number;
  endOffset: number;
  content?: string;
}): LocalReaderAiQuestionRequest | undefined {
  const sourceItem = sourceItemKeyFromLocalBook(input.book);
  const selectedText = input.selectedText.trim().slice(0, MAX_SELECTED_TEXT_LENGTH);
  const question = input.question.trim().slice(0, MAX_QUESTION_TEXT_LENGTH);
  const startOffset = normalizeOffset(input.startOffset);
  const endOffset = normalizeOffset(input.endOffset);

  if (!sourceItem || !selectedText || !question || startOffset < 0 || endOffset <= startOffset) {
    return undefined;
  }

  const context = createSelectionContext(input.content, startOffset, endOffset);

  return {
    sourceItem,
    book: {
      title: input.book.title.trim() || "未命名图书",
      ...(input.book.author?.trim() ? { author: input.book.author.trim() } : {})
    },
    selection: {
      text: selectedText,
      startOffset,
      endOffset,
      ...(context ? { context } : {})
    },
    question
  };
}

function normalizeOffset(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : -1;
}

function createSelectionContext(
  content: string | undefined,
  startOffset: number,
  endOffset: number
): LocalReaderAiQuestionRequest["selection"]["context"] | undefined {
  if (!content || startOffset < 0 || endOffset <= startOffset) {
    return undefined;
  }

  const beforeText = content
    .slice(Math.max(0, startOffset - MAX_SELECTION_CONTEXT_CHARS), startOffset)
    .trim()
    .slice(-MAX_SELECTION_CONTEXT_CHARS);
  const afterText = content
    .slice(endOffset, Math.min(content.length, endOffset + MAX_SELECTION_CONTEXT_CHARS))
    .trim()
    .slice(0, MAX_SELECTION_CONTEXT_CHARS);

  if (!beforeText && !afterText) {
    return undefined;
  }

  return {
    ...(beforeText ? { beforeText } : {}),
    ...(afterText ? { afterText } : {})
  };
}
