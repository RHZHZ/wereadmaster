import { describe, expect, it } from "vitest";
import {
  buildLocalReaderHighlightSegments,
  createLocalReaderHighlight,
  hasLocalReaderHighlightOverlap,
  normalizeLocalReaderSelectionRange,
  readLocalReaderHighlights,
  writeLocalReaderHighlights
} from "./local-reader-highlights";

describe("local reader highlights", () => {
  it("renders stable text and highlight segments without overlapping ranges", () => {
    const first = createLocalReaderHighlight({
      bookId: "local:demo",
      text: "第二段",
      startOffset: 4,
      endOffset: 7,
      tone: "yellow",
      now: "100"
    });
    const overlap = createLocalReaderHighlight({
      bookId: "local:demo",
      text: "段内容",
      startOffset: 6,
      endOffset: 9,
      tone: "blue",
      now: "101"
    });

    expect(buildLocalReaderHighlightSegments("第一段\n第二段内容", [overlap, first])).toEqual([
      { kind: "text", text: "第一段\n" },
      { kind: "highlight", text: "第二段", highlight: first },
      { kind: "text", text: "内容" }
    ]);
  });

  it("reads and writes highlights scoped by local book id", () => {
    const storage = createMemoryStorage();
    const highlight = createLocalReaderHighlight({
      bookId: "local:demo",
      text: "重要句子",
      startOffset: 2,
      endOffset: 6,
      tone: "green",
      now: "100"
    });

    writeLocalReaderHighlights(storage, "local:demo", [highlight]);

    expect(readLocalReaderHighlights(storage, "local:demo")).toEqual([highlight]);
    expect(readLocalReaderHighlights(storage, "local:other")).toEqual([]);
  });

  it("normalizes invalid selection ranges and detects overlaps", () => {
    expect(normalizeLocalReaderSelectionRange(8, 2, 10)).toEqual({
      startOffset: 2,
      endOffset: 8
    });
    expect(normalizeLocalReaderSelectionRange(3, 3, 10)).toBeUndefined();

    const highlight = createLocalReaderHighlight({
      bookId: "local:demo",
      text: "重要句子",
      startOffset: 2,
      endOffset: 6,
      tone: "yellow",
      now: "100"
    });

    expect(hasLocalReaderHighlightOverlap([highlight], 6, 8)).toBe(false);
    expect(hasLocalReaderHighlightOverlap([highlight], 5, 8)).toBe(true);
  });

  it("falls back to an empty list for malformed storage", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.highlights.v1:local%3Ademo": "{"
    });

    expect(readLocalReaderHighlights(storage, "local:demo")).toEqual([]);
  });

  it("deduplicates highlights by id when storage contains repeated records", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.highlights.v1:local%3Ademo": JSON.stringify([
        {
          id: "same-highlight",
          bookId: "local:demo",
          text: "旧划线",
          startOffset: 1,
          endOffset: 3,
          tone: "yellow",
          createdAt: "100"
        },
        {
          id: "same-highlight",
          bookId: "local:demo",
          text: "新划线",
          startOffset: 4,
          endOffset: 7,
          tone: "blue",
          createdAt: "101"
        }
      ])
    });

    expect(readLocalReaderHighlights(storage, "local:demo")).toEqual([
      {
        id: "same-highlight",
        bookId: "local:demo",
        text: "新划线",
        startOffset: 4,
        endOffset: 7,
        tone: "blue",
        createdAt: "101"
      }
    ]);
  });
});

function createMemoryStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    }
  };
}
