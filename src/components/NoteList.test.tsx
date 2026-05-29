import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChapterNoteGroup } from "../lib/types";
import { NoteList } from "./NoteList";

describe("note list chapter labels", () => {
  const groups = [
    {
      chapterUid: 382,
      title: "第一章 童年",
      highlights: [
        {
          bookmarkId: "h1",
          bookId: "b1",
          chapterUid: 382,
          chapterTitle: "第一章 童年",
          markText: "划线内容"
        }
      ],
      thoughts: []
    }
  ] satisfies ChapterNoteGroup[];

  it("shows the chapter title instead of the internal chapter uid", () => {
    const markup = renderToStaticMarkup(<NoteList groups={groups} />);

    expect(markup).toContain("书内章节");
    expect(markup).toContain("第一章 童年");
    expect(markup).not.toContain("章节 382");
  });

  it("keeps the chapter directory collapsed by default", () => {
    const markup = renderToStaticMarkup(<NoteList groups={groups} />);

    expect(markup).toContain("章节目录");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('aria-label="章节快速目录"');
  });
});
