import type { Chapter, ReadingProgress } from "./types";

export function findCurrentChapter(
  chapters: Chapter[],
  progress: Pick<ReadingProgress, "chapterUid">
): Chapter | undefined {
  if (typeof progress.chapterUid !== "number") {
    return undefined;
  }

  return chapters.find((chapter) => chapter.chapterUid === progress.chapterUid);
}

