import type { ReadingRoute, ReadingRouteBookInput, ReadingRouteBookStep } from "../../lib/types";

export type ReadingRouteContinuity = {
  currentTitle: string;
  nextTitle: string;
  nextMeta: string;
  handoffReason: string;
  switchCondition: string;
  continuationAction: string;
};

export function buildReadingRouteContinuity(
  route: ReadingRoute,
  currentBook: ReadingRouteBookInput | undefined,
  isCrossBookRoute: boolean
): ReadingRouteContinuity | undefined {
  if (!isCrossBookRoute || route.books.length < 2) {
    return undefined;
  }

  const orderedBooks = [...route.books].sort((left, right) => left.order - right.order);
  const currentIndex = findCurrentBookIndex(orderedBooks, currentBook);
  const nextBook = orderedBooks[currentIndex + 1];

  if (!nextBook) {
    return undefined;
  }

  const currentStep = orderedBooks[currentIndex] ?? orderedBooks[0];
  const dependency = route.dependencies.find(
    (item) => item.fromBookId === currentStep.bookId && item.toBookId === nextBook.bookId
  );
  const checkpoint = route.reviewCheckpoints[0];

  return {
    currentTitle: currentStep.title,
    nextTitle: nextBook.title,
    nextMeta: [nextBook.author, nextBook.estimatedEffort].filter(Boolean).join(" · "),
    handoffReason: dependency?.reason || nextBook.basis || "当前节点完成后，按路线继续推进下一本。",
    switchCondition: route.nextActions[0] || checkpoint?.timing || "完成当前书的复盘输出后再切换。",
    continuationAction: `打开《${nextBook.title}》，先按路线里的阅读目的完成第一轮阅读。`
  };
}

function findCurrentBookIndex(books: ReadingRouteBookStep[], currentBook?: ReadingRouteBookInput): number {
  if (!currentBook?.bookId) {
    return 0;
  }

  const index = books.findIndex((book) => book.bookId === currentBook.bookId);
  return index >= 0 ? index : 0;
}
