import { describe, expect, it } from "vitest";
import { findCurrentChapter } from "./book-progress";
import type { Chapter } from "./types";

describe("findCurrentChapter", () => {
  it("returns the chapter matching progress chapterUid", () => {
    expect(findCurrentChapter([chapter(1, "第一章"), chapter(2, "第二章")], { chapterUid: 2 })?.title)
      .toBe("第二章");
  });

  it("returns undefined when progress has no chapterUid", () => {
    expect(findCurrentChapter([chapter(1, "第一章")], {})).toBeUndefined();
  });

  it("returns undefined when chapters do not match", () => {
    expect(findCurrentChapter([chapter(1, "第一章")], { chapterUid: 9 })).toBeUndefined();
  });
});

function chapter(chapterUid: number, title: string): Chapter {
  return {
    bookId: "b1",
    chapterUid,
    chapterIdx: chapterUid,
    title,
    level: 1
  };
}

