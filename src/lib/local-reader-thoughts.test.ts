import { describe, expect, it } from "vitest";
import {
  createLocalReaderThought,
  readLocalReaderThoughts,
  writeLocalReaderThoughts
} from "./local-reader-thoughts";

describe("local reader thoughts", () => {
  it("reads and writes thoughts scoped by local book id", () => {
    const storage = createMemoryStorage();
    const thought = createLocalReaderThought({
      bookId: "local:demo",
      selectedText: "选中文本",
      note: "我的想法",
      startOffset: 2,
      endOffset: 6,
      now: "100"
    });

    writeLocalReaderThoughts(storage, "local:demo", [thought]);

    expect(readLocalReaderThoughts(storage, "local:demo")).toEqual([thought]);
    expect(readLocalReaderThoughts(storage, "local:other")).toEqual([]);
  });

  it("normalizes malformed thought records", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.thoughts.v1:local%3Ademo": JSON.stringify([
        {
          id: "valid",
          bookId: "local:demo",
          selectedText: "选中文本",
          note: "有效想法",
          startOffset: 1,
          endOffset: 5,
          createdAt: "100"
        },
        {
          id: "missing-note",
          bookId: "local:demo",
          selectedText: "选中文本",
          note: "",
          startOffset: 1,
          endOffset: 5,
          createdAt: "100"
        }
      ])
    });

    expect(readLocalReaderThoughts(storage, "local:demo")).toEqual([
      {
        id: "valid",
        bookId: "local:demo",
        selectedText: "选中文本",
        note: "有效想法",
        startOffset: 1,
        endOffset: 5,
        createdAt: "100"
      }
    ]);
  });

  it("falls back to an empty list for malformed storage", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.thoughts.v1:local%3Ademo": "{"
    });

    expect(readLocalReaderThoughts(storage, "local:demo")).toEqual([]);
  });

  it("deduplicates thoughts by id when storage contains repeated records", () => {
    const storage = createMemoryStorage({
      "wxreadmaster.localReader.thoughts.v1:local%3Ademo": JSON.stringify([
        {
          id: "same-thought",
          bookId: "local:demo",
          selectedText: "旧原文",
          note: "旧想法",
          startOffset: 1,
          endOffset: 3,
          createdAt: "100"
        },
        {
          id: "same-thought",
          bookId: "local:demo",
          selectedText: "新原文",
          note: "新想法",
          startOffset: 4,
          endOffset: 7,
          createdAt: "101"
        }
      ])
    });

    expect(readLocalReaderThoughts(storage, "local:demo")).toEqual([
      {
        id: "same-thought",
        bookId: "local:demo",
        selectedText: "新原文",
        note: "新想法",
        startOffset: 4,
        endOffset: 7,
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
